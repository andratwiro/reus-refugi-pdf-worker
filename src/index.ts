/**
 * Cloudflare Worker: PDF generation + Gmail draft proxy per al projecte
 * Reus Refugi.
 *
 * Rutes:
 *   POST /generate     — dossier EX-31 o EX-32 d'un cas (taula Casos)
 *   POST /anexo2       — certificat de vulnerabilitat (Informes de Vulnerabilitat)
 *   POST /gmail-draft  — proxy a Google Apps Script per crear drafts (evita el 302 de GAS)
 */

import { AirtableClient, AirtableRecord } from "./airtable";
import { fillSection5Page, getTemplateInfo, mergePdfWithInserts } from "./fillPdf";
import { fillAnexo2Pdf, anexo2Filename } from "./anexo2";
import { CASOS } from "./mappings";
import { airtableToMercurio, getFormulario, type AirtableCase } from "./mercurio/mapping";
import { USERSCRIPT_TEMPLATE } from "./mercurio/userscriptCode";

const USERSCRIPT_VERSION = "1.1.0";

export interface Env {
  // Secrets
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

    // ─── Mercurio routes ────────────────────────────────────────
    if (request.method === "OPTIONS" && url.pathname.startsWith("/mercurio")) {
      return corsPreflight(request);
    }
    if (request.method === "GET" && url.pathname === "/mercurio.user.js") {
      return handleUserscript(request, env);
    }
    if (request.method === "GET" && url.pathname === "/mercurio/cases") {
      return handleMercurioCases(request, env);
    }
    if (request.method === "GET" && url.pathname === "/mercurio/payload") {
      return handleMercurioPayload(request, env);
    }

    return json({ error: "Not found" }, 404);
  },
};

// ─── /generate (existing) ───────────────────────────────────────────────────

async function handleGenerate(request: Request, env: Env): Promise<Response> {
  if (!checkAuth(request, env)) return unauthorized();

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
    const record = await airtable.getRecord(tableId, body.recordId);

    const viaLegal = getStrFromField(record.fields, CASOS.viaLegal);
    const { templateFile, section5TemplateFile, formCode, fill } =
      getTemplateInfo(viaLegal);

    const codi = getStrFromField(record.fields, CASOS.codi) || record.id;
    const filename = `${codi}_${formCode}.pdf`;

    const simultaneousIds = getSimultaneousApplicantIds(record);
    const simultaneousMembers =
      simultaneousIds.length > 0
        ? await airtable.getRecords(tableId, simultaneousIds)
        : [];

    const firstDependent = simultaneousMembers[0];
    const extraDependents = simultaneousMembers.slice(1);

    const signatureBytes = await fetchSignaturePng(record);

    const templateResp = await env.ASSETS.fetch(`https://placeholder/${templateFile}`);
    if (!templateResp.ok) {
      throw new Error(`Failed to load template ${templateFile}: ${templateResp.status}`);
    }
    const templateBytes = await templateResp.arrayBuffer();

    let filledBytes = await fill(templateBytes, record, {
      firstDependent,
      signatureBytes,
    });

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

// ─── /anexo2 ────────────────────────────────────────────────────────────────

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
    // Read the record BY FIELD ID (default) — noms de camp poden canviar.
    const record = await airtable.getRecord(tableId, body.recordId);

    const templateResp = await env.ASSETS.fetch(
      "https://placeholder/A2_certificado_vulnerabilidad.pdf",
    );
    if (!templateResp.ok) {
      throw new Error(`Failed to load anexo II template: ${templateResp.status}`);
    }
    const templateBytes = await templateResp.arrayBuffer();

    const pdfBytes = await fillAnexo2Pdf(templateBytes, record);
    const filename = anexo2Filename(record);

    await airtable.clearAttachmentField(tableId, body.recordId, pdfField);
    await airtable.uploadAttachment({
      recordId: body.recordId,
      fieldIdOrName: pdfField,
      filename,
      contentType: "application/pdf",
      bytes: pdfBytes,
    });

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

// ─── /gmail-draft ───────────────────────────────────────────────────────────

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

// ─── Mercurio handlers ──────────────────────────────────────────────────────

const ALLOWED_CORS_ORIGINS = [
  "https://mercurio.delegaciondelgobierno.gob.es",
  "http://localhost:3001",
];

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin") ?? "";
  const allow = ALLOWED_CORS_ORIGINS.includes(origin) ? origin : ALLOWED_CORS_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function corsPreflight(request: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

function corsJson(data: unknown, request: Request, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(request) },
  });
}

/**
 * GET /mercurio.user.js — serveix el userscript de producció amb @updateURL
 * apuntant a si mateix. Tampermonkey detectarà actualitzacions automàtiques.
 *
 * Aquesta ruta NO requereix auth — qualsevol pot baixar el userscript. El que
 * requereix auth són les crides /mercurio/cases i /mercurio/payload (el secret
 * va embedded al userscript).
 */
function handleUserscript(request: Request, env: Env): Response {
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  const body = USERSCRIPT_TEMPLATE
    .replaceAll("__WORKER_URL__", baseUrl)
    .replaceAll("__VERSION__", USERSCRIPT_VERSION)
    // SHARED_SECRET embedded — voluntari instal·la i ja funciona. Threat model:
    // RECEX entity de confiança + Cloudflare audit logs.
    .replaceAll("__SHARED_SECRET__", env.SHARED_SECRET);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=300",  // 5min — Tampermonkey re-comprova diàriament igualment
    },
  });
}

/**
 * GET /mercurio/cases?q=text — cerca casos a la taula Casos d'Airtable.
 * Cerca per Nom, 1r cognom, 2n cognom, ID Cas (case-insensitive substring).
 */
async function handleMercurioCases(request: Request, env: Env): Promise<Response> {
  if (!checkAuth(request, env)) return unauthorized(corsHeaders(request));
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();

  const at = new AirtableClient(env.AIRTABLE_TOKEN, env.AIRTABLE_BASE_ID);
  // Llegim per NAMES (no IDs) perquè el mapper compartit treballa per nom.
  const records = await at.listRecords(env.CASOS_TABLE_ID, {
    byFieldId: false,
    maxRecords: 200,
  });

  const matches = [];
  for (const r of records) {
    const f = r.fields as Record<string, any>;
    const nom = String(f["Nom"] ?? "").trim();
    const cog1 = String(f["1r cognom"] ?? "").trim();
    const cog2 = String(f["2n cognom"] ?? "").trim();
    const idCas = String(f["ID Cas"] ?? "");
    const passaport = String(f["Núm. passaport"] ?? "");
    const haystack = `${nom} ${cog1} ${cog2} ${idCas} ${passaport}`.toLowerCase();
    if (q && !haystack.includes(q)) continue;

    const viaLegalRaw = f["Via legal"];
    const viaLegal = typeof viaLegalRaw === "string"
      ? viaLegalRaw
      : (viaLegalRaw && typeof viaLegalRaw === "object" && "name" in viaLegalRaw)
        ? String((viaLegalRaw as { name: string }).name)
        : "";

    const formulario = getFormulario({ id: r.id, fields: { "Via legal": viaLegal } });
    matches.push({
      id: r.id,
      idCas,
      nom,
      cognom1: cog1,
      cognom2: cog2,
      viaLegal,
      formulario,
    });
  }

  // Ordena per nom asc i limita a 30
  matches.sort((a, b) => (a.cognom1 + a.nom).localeCompare(b.cognom1 + b.nom));
  return corsJson({ q, total: matches.length, cases: matches.slice(0, 30) }, request);
}

/**
 * GET /mercurio/payload?caso=recXXX — retorna el payload de 144 camps mapejat.
 * Si el cas és un dependent (té "Referent familiar"), llegeix també el
 * referent per construir els camps `rea*`.
 */
async function handleMercurioPayload(request: Request, env: Env): Promise<Response> {
  if (!checkAuth(request, env)) return unauthorized(corsHeaders(request));
  const url = new URL(request.url);
  const recordId = url.searchParams.get("caso");
  if (!recordId || !/^rec[A-Za-z0-9]{14}$/.test(recordId)) {
    return corsJson({ error: "missing or invalid 'caso' param" }, request, 400);
  }

  const at = new AirtableClient(env.AIRTABLE_TOKEN, env.AIRTABLE_BASE_ID);
  // Llegim per NAMES (mapper compartit treballa per nom)
  const rec = await at.getRecord(env.CASOS_TABLE_ID, recordId, { byFieldId: false });
  const recAsCase: AirtableCase = { id: rec.id, fields: rec.fields as any };

  // Si té "Referent familiar" (link), llegim el referent per als camps rea*
  let refRec: AirtableCase | undefined;
  const referentLinks = (rec.fields as any)["Referent familiar"] as Array<{ id: string }> | string[] | undefined;
  if (Array.isArray(referentLinks) && referentLinks.length > 0) {
    const refId = typeof referentLinks[0] === "string"
      ? (referentLinks[0] as string)
      : (referentLinks[0] as { id: string }).id;
    if (refId && /^rec[A-Za-z0-9]{14}$/.test(refId)) {
      const r = await at.getRecord(env.CASOS_TABLE_ID, refId, { byFieldId: false });
      refRec = { id: r.id, fields: r.fields as any };
    }
  }

  const payload = airtableToMercurio(recAsCase, undefined, refRec);
  const formulario = getFormulario(recAsCase);

  return corsJson({
    caso: recordId,
    idCas: (rec.fields as any)["ID Cas"],
    formulario,
    payload,
  }, request);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function checkAuth(request: Request, env: Env): boolean {
  const auth = request.headers.get("Authorization") || "";
  return auth === `Bearer ${env.SHARED_SECRET}`;
}

function unauthorized(extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
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
