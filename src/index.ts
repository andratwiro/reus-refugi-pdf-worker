/**
 * Cloudflare Worker: genera el dossier (EX-31 o EX-32) d'un cas i l'adjunta
 * a la fila d'Airtable.
 *
 * Flux:
 *   Airtable button → Scripting extension → POST /generate
 *     → Worker valida el shared secret
 *     → Fetch del record d'Airtable
 *     → Descàrrega de la signatura digital (si existeix)
 *     → Decideix EX-31 o EX-32 segons "Via legal"
 *     → Detecta membres familiars simultanis
 *     → Omple el formulari principal (+ primer dependent a pàgina 2 secció 5)
 *       (+ signatura a pàgines 2/4/5 si s'ha capturat)
 *     → Per membres familiars 2..N, genera inserts i fusiona després de pàgina 2
 *     → Puja el PDF final a Airtable
 */

import { AirtableClient, AirtableRecord } from "./airtable";
import { fillSection5Page, getTemplateInfo, mergePdfWithInserts } from "./fillPdf";
import { CASOS } from "./mappings";

export interface Env {
  AIRTABLE_TOKEN: string;
  SHARED_SECRET: string;
  AIRTABLE_BASE_ID: string;
  CASOS_TABLE_ID: string;
  DOSSIER_FIELD_ID: string;
  ASSETS: Fetcher;
}

interface GenerateRequest {
  recordId: string;
  baseId?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return json({ ok: true, service: "reus-refugi-pdf-worker" });
    }

    if (request.method === "POST" && url.pathname === "/generate") {
      return handleGenerate(request, env);
    }

    return json({ error: "Not found" }, 404);
  },
};

async function handleGenerate(request: Request, env: Env): Promise<Response> {
  // 1. Auth
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
    // 3. Fetch the case
    const record = await airtable.getRecord(tableId, body.recordId);

    // 4. Decide template based on "Via legal"
    const viaLegal = getStrFromField(record.fields, CASOS.viaLegal);
    const { templateFile, section5TemplateFile, formCode, fill } =
      getTemplateInfo(viaLegal);

    const codi = getStrFromField(record.fields, CASOS.codi) || record.id;
    const filename = `${codi}_${formCode}.pdf`;

    // 5. Resolve simultaneous family members (principal's dependents OR dependent's principal)
    const simultaneousIds = getSimultaneousApplicantIds(record);
    const simultaneousMembers =
      simultaneousIds.length > 0
        ? await airtable.getRecords(tableId, simultaneousIds)
        : [];

    // Rule (a) — Airtable order: first member goes on main page 2; rest on inserts.
    const firstDependent = simultaneousMembers[0];
    const extraDependents = simultaneousMembers.slice(1);

    // 6. Fetch signature PNG if the case has one
    const signatureBytes = await fetchSignaturePng(record);

    // 7. Load main template
    const templateResp = await env.ASSETS.fetch(`https://placeholder/${templateFile}`);
    if (!templateResp.ok) {
      throw new Error(`Failed to load template ${templateFile}: ${templateResp.status}`);
    }
    const templateBytes = await templateResp.arrayBuffer();

    // 8. Fill main — with first dependent (if any) and signature (if any)
    let filledBytes = await fill(templateBytes, record, {
      firstDependent,
      signatureBytes,
    });

    // 9. Generate + merge inserts for remaining dependents (2..N)
    if (extraDependents.length > 0) {
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
        extraDependents.map((m) =>
          fillSection5Page(insertTemplateBytes, m, formCode),
        ),
      );
      filledBytes = await mergePdfWithInserts(filledBytes, insertBytesList, 1);
    }

    // 10. Clear prev attachment + upload new
    await airtable.clearAttachmentField(tableId, body.recordId, fieldId);
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
      simultaneousApplicants: simultaneousMembers.length,
      extraInserts: extraDependents.length,
      signed: Boolean(signatureBytes),
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
 * Returns the list of simultaneously-processing family member record IDs
 * that should be referenced in section 5 of this case's dossier.
 *
 *   - Principal (has `Casos vinculats`): returns the dependent IDs.
 *   - Dependent (has `Cas referent`): returns the principal ID (1 element).
 *   - Individual: returns [].
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

/**
 * If the record has a Firma digital attachment, download its PNG bytes.
 * Returns undefined when the field is empty or the fetch fails — in which
 * case the firma boxes on the generated PDF are left blank.
 *
 * Airtable attachment URLs are time-limited signed URLs generated at the
 * moment of the `getRecord` call, so we download immediately.
 */
async function fetchSignaturePng(
  record: AirtableRecord,
): Promise<Uint8Array | undefined> {
  const attachments = record.fields[CASOS.firmaDigital];
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return undefined;
  }
  const first = attachments[0] as { url?: string; type?: string };
  if (!first || typeof first.url !== "string") {
    return undefined;
  }
  try {
    const resp = await fetch(first.url);
    if (!resp.ok) {
      console.error(`Signature fetch failed: ${resp.status} ${resp.statusText}`);
      return undefined;
    }
    const buf = await resp.arrayBuffer();
    return new Uint8Array(buf);
  } catch (err) {
    console.error("Signature fetch error:", err);
    return undefined;
  }
}
