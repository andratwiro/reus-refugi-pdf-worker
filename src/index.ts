/**
 * Cloudflare Worker: genera el dossier (EX-31 o EX-32) d'un cas i l'adjunta
 * a la fila d'Airtable.
 *
 * Flux:
 *   Airtable button → Scripting extension → POST /generate
 *     → Worker valida el shared secret
 *     → Fetch del record d'Airtable
 *     → Decideix EX-31 o EX-32 segons "Via legal" (via getTemplateInfo)
 *     → Detecta membres familiars simultanis (Cas referent / Casos vinculats)
 *     → Carrega el template PDF principal + (si cal) els records dels membres
 *     → Omple el formulari principal (secció 5 buida)
 *     → Per cada membre simultani, omple una pàgina insert de secció 5
 *     → Fusiona inserts dins del PDF principal just després de pàgina 2
 *     → Neteja el camp d'attachment (replace semantics)
 *     → Puja el PDF final a Airtable
 *     → Retorna 200 amb {ok, filename, formCode, inserts}
 */

import { AirtableClient, AirtableRecord } from "./airtable";
import { fillSection5Page, getTemplateInfo, mergePdfWithInserts } from "./fillPdf";
import { CASOS } from "./mappings";

export interface Env {
  // Secrets (wrangler secret put)
  AIRTABLE_TOKEN: string;
  SHARED_SECRET: string;

  // Vars (wrangler.toml)
  AIRTABLE_BASE_ID: string;
  CASOS_TABLE_ID: string;
  DOSSIER_FIELD_ID: string;

  // Static assets binding
  ASSETS: Fetcher;
}

interface GenerateRequest {
  recordId: string;
  baseId?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (request.method === "GET" && url.pathname === "/") {
      return json({ ok: true, service: "reus-refugi-pdf-worker" });
    }

    // Main endpoint
    if (request.method === "POST" && url.pathname === "/generate") {
      return handleGenerate(request, env);
    }

    return json({ error: "Not found" }, 404);
  },
};

async function handleGenerate(request: Request, env: Env): Promise<Response> {
  // 1. Auth: validate Bearer token
  const auth = request.headers.get("Authorization") || "";
  const expected = `Bearer ${env.SHARED_SECRET}`;
  if (auth !== expected) {
    return json({ error: "Unauthorized" }, 401);
  }

  // 2. Parse body
  let body: GenerateRequest;
  try {
    body = (await request.json()) as GenerateRequest;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  if (!body.recordId || !body.recordId.startsWith("rec")) {
    return json({ error: "Missing or invalid recordId" }, 400);
  }

  const baseId = body.baseId || env.AIRTABLE_BASE_ID;
  const tableId = env.CASOS_TABLE_ID;
  const fieldId = env.DOSSIER_FIELD_ID;

  const airtable = new AirtableClient(env.AIRTABLE_TOKEN, baseId);

  try {
    // 3. Fetch case data from Airtable
    const record = await airtable.getRecord(tableId, body.recordId);

    // 4. Decide which form to generate based on "Via legal"
    const viaLegal = getStrFromField(record.fields, CASOS.viaLegal);
    const { templateFile, section5TemplateFile, formCode, fill } =
      getTemplateInfo(viaLegal);

    // Build filename from case code + form code (e.g., RR-2026-002-GONZALEZ_EX31.pdf)
    const codi = getStrFromField(record.fields, CASOS.codi) || record.id;
    const filename = `${codi}_${formCode}.pdf`;

    // 5. Resolve simultaneous family members (if any)
    const simultaneousIds = getSimultaneousApplicantIds(record);
    const simultaneousMembers =
      simultaneousIds.length > 0
        ? await airtable.getRecords(tableId, simultaneousIds)
        : [];

    // 6. Load main PDF template from bundled static assets
    const templateResp = await env.ASSETS.fetch(`https://placeholder/${templateFile}`);
    if (!templateResp.ok) {
      throw new Error(`Failed to load template ${templateFile}: ${templateResp.status}`);
    }
    const templateBytes = await templateResp.arrayBuffer();

    // 7. Fill the main PDF (section 5 stays blank — populated via inserts)
    let filledBytes = await fill(templateBytes, record);

    // 8. If family case, fill and merge section 5 inserts
    if (simultaneousMembers.length > 0) {
      const insertResp = await env.ASSETS.fetch(
        `https://placeholder/${section5TemplateFile}`,
      );
      if (!insertResp.ok) {
        throw new Error(
          `Failed to load section 5 template ${section5TemplateFile}: ${insertResp.status}`,
        );
      }
      const insertTemplateBytes = await insertResp.arrayBuffer();

      const insertBytesList = await Promise.all(
        simultaneousMembers.map((m) =>
          fillSection5Page(insertTemplateBytes, m, formCode),
        ),
      );

      // Section 5 lives on page 2 (index 1) in both EX-31 and EX-32,
      // so inserts go immediately after index 1.
      filledBytes = await mergePdfWithInserts(filledBytes, insertBytesList, 1);
    }

    // 9. Clear existing attachments (replace semantics)
    await airtable.clearAttachmentField(tableId, body.recordId, fieldId);

    // 10. Upload the generated PDF
    await airtable.uploadAttachment({
      recordId: body.recordId,
      fieldIdOrName: fieldId,
      filename,
      contentType: "application/pdf",
      bytes: filledBytes,
    });

    return json({
      ok: true,
      recordId: body.recordId,
      filename,
      formCode,
      viaLegal,
      inserts: simultaneousMembers.length,
      sizeBytes: filledBytes.length,
    });
  } catch (err) {
    console.error("generate error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: message }, 500);
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Read a field as string. Airtable returns singleSelect as {id, name, color},
 * so we extract the name when applicable.
 */
function getStrFromField(fields: Record<string, unknown>, fieldId: string): string {
  const v = fields[fieldId];
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && "name" in (v as object)) {
    return String((v as { name: string }).name);
  }
  return String(v);
}

/**
 * Decideix la llista de sol·licitants simultanis (record IDs) que s'han
 * d'inserir com a secció 5 del dossier d'aquest cas.
 *
 * - Si el cas és PRINCIPAL (té `Casos vinculats`): retorna els dependents.
 * - Si el cas és DEPENDENT (té `Cas referent`): retorna el principal (1 ID).
 * - Si el cas és INDIVIDUAL: retorna llista buida.
 *
 * Els dos camps són `multipleRecordLinks` a Airtable, que arriben com a
 * array d'strings (IDs) quan es fa el get amb `returnFieldsByFieldId=true`.
 */
function getSimultaneousApplicantIds(record: AirtableRecord): string[] {
  const f = record.fields;

  const vinculats = f[CASOS.casosVinculats];
  if (Array.isArray(vinculats) && vinculats.length > 0) {
    return vinculats.filter((x): x is string => typeof x === "string");
  }

  const referent = f[CASOS.casReferent];
  if (Array.isArray(referent) && referent.length > 0) {
    return referent.filter((x): x is string => typeof x === "string");
  }

  return [];
}
