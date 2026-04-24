/**
 * Cloudflare Worker: PDF generation + Gmail draft proxy per al projecte
 * Reus Refugi.
 *
 * Rutes:
 *   POST /generate     — dossier EX-31 o EX-32 d'un cas (taula Casos)
 *   POST /anexo2       — certificat de vulnerabilitat (Informes Vulnerabilitat Express)
 *   POST /gmail-draft  — proxy a Google Apps Script per crear drafts (evita el 302 de GAS)
 */

import { AirtableClient, AirtableRecord } from "./airtable";
import { fillSection5Page, getTemplateInfo, mergePdfWithInserts } from "./fillPdf";
import { fillAnexo2Pdf, anexo2Filename } from "./anexo2";
import { CASOS } from "./mappings";

export interface Env {
  // Secrets (via `wrangler secret put` o dashboard)
  AIRTABLE_TOKEN: string;
  SHARED_SECRET: string;
  GAS_WEBAPP_URL: string;
  GAS_SHARED_SECRET: string;

  // Public vars (wrangler.toml)
  AIRTABLE_BASE_ID: string;
  CASOS_TABLE_ID: string;
  DOSSIER_FIELD_ID: string;
  INFORMES_VULN_TABLE_ID: string;
  INFORMES_VULN_PDF_FIELD: string;
  INFORMES_VULN_GENERATED_AT_FIELD: string;

  // Assets binding
  ASSETS: Fetcher;
}

interface GenerateRequest {
  recordId: string;
  baseId?: string;
}

interface Anexo2Request {
  recordId: string;
}

interface GmailDraftRequest {
  to?: string;
  subject?: string;
  bodyText?: string;
  attachmentUrl?: string;
  filename?: string;
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

    if (request.method === "POST" && url.pathname === "/anexo2") {
      return handleAnexo2(request, env);
    }

    if (request.method === "POST" && url.pathname === "/gmail-draft") {
      return handleGmailDraft(request, env);
    }

    return json({ error: "Not found" }, 404);
  },
};

// ─── /generate (existing — dossier EX-31/EX-32) ─────────────────────────────

async function handleGenerate(request: Request, env: Env): Promise<Response> {
  // 1. Auth
  if (!checkAuth(request, env)) return unauthorized();

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

// ─── /anexo2 (new — certificat de vulnerabilitat express) ───────────────────

async function handleAnexo2(request: Request, env: Env): Promise<Response> {
  if (!checkAuth(request, env)) return unauthorized();

  let body: Anexo2Request;
  try {
    body = (await request.json()) as Anexo2Request;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  if (!body.recordId || !body.recordId.startsWith("rec")) {
    return json({ error: "Missing or invalid recordId" }, 400);
  }

  const tableId = env.INFORMES_VULN_TABLE_ID;
  const pdfField = env.INFORMES_VULN_PDF_FIELD;
  const generatedAtField = env.INFORMES_VULN_GENERATED_AT_FIELD;
  const airtable = new AirtableClient(env.AIRTABLE_TOKEN, env.AIRTABLE_BASE_ID);

  try {
    // 1. Fetch record BY NAME (field IDs not wired yet for this table)
    const record = await airtable.getRecord(tableId, body.recordId, { byFieldId: false });

    // 2. Load plantilla
    const templateResp = await env.ASSETS.fetch(
      "https://placeholder/A2_certificado_vulnerabilidad.pdf",
    );
    if (!templateResp.ok) {
      throw new Error(`Failed to load anexo II template: ${templateResp.status}`);
    }
    const templateBytes = await templateResp.arrayBuffer();

    // 3. Fill
    const pdfBytes = await fillAnexo2Pdf(templateBytes, record);
    const filename = anexo2Filename(record);

    // 4. Clear + upload (replace semantics)
    await airtable.clearAttachmentField(tableId, body.recordId, pdfField);
    await airtable.uploadAttachment({
      recordId: body.recordId,
      fieldIdOrName: pdfField,
      filename,
      contentType: "application/pdf",
      bytes: pdfBytes,
    });

    // 5. Stamp "Generat el" with now() in ISO (Airtable will render in Europe/Madrid via col config)
    await airtable.updateField(
      tableId,
      body.recordId,
      generatedAtField,
      new Date().toISOString(),
    );

    return json({
      ok: true,
      recordId: body.recordId,
      filename,
      sizeBytes: pdfBytes.length,
    });
  } catch (err) {
    console.error("anexo2 error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: message }, 500);
  }
}

// ─── /gmail-draft (new — proxy a Google Apps Script) ────────────────────────

async function handleGmailDraft(request: Request, env: Env): Promise<Response> {
  if (!checkAuth(request, env)) return unauthorized();

  let body: GmailDraftRequest;
  try {
    body = (await request.json()) as GmailDraftRequest;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  if (!body.to || !body.attachmentUrl) {
    return json({ error: "Missing 'to' or 'attachmentUrl'" }, 400);
  }

  if (!env.GAS_WEBAPP_URL || !env.GAS_SHARED_SECRET) {
    return json({ error: "GAS not configured (missing GAS_WEBAPP_URL or GAS_SHARED_SECRET)" }, 500);
  }

  try {
    // Cloudflare Workers fetch() follows 302 redirects by default,
    // which is exactly why we need this proxy (Airtable Scripting can't follow).
    const gasResp = await fetch(env.GAS_WEBAPP_URL, {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: body.to,
        subject: body.subject ?? "",
        bodyText: body.bodyText ?? "",
        attachmentUrl: body.attachmentUrl,
        filename: body.filename ?? "document.pdf",
        secret: env.GAS_SHARED_SECRET,
      }),
    });

    const text = await gasResp.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      // GAS returned HTML (typical error page) — surface it
      return json(
        {
          ok: false,
          error: `GAS did not return JSON (status ${gasResp.status})`,
          rawResponse: text.slice(0, 500),
        },
        502,
      );
    }

    return new Response(JSON.stringify(parsed, null, 2), {
      status: gasResp.ok ? 200 : gasResp.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("gmail-draft error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: `GAS fetch failed: ${message}` }, 502);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function checkAuth(request: Request, env: Env): boolean {
  const auth = request.headers.get("Authorization") || "";
  return auth === `Bearer ${env.SHARED_SECRET}`;
}

function unauthorized(): Response {
  return json({ error: "Unauthorized" }, 401);
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
