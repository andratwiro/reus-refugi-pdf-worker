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
import { CASOS, ENTITAT_REUS_REFUGI_BASE, type EntitatConfig } from "./mappings";
import { airtableToMercurio, getFormulario, type AirtableCase, type PresentadorConfig } from "./mercurio/mapping";
import { USERSCRIPT_TEMPLATE } from "./mercurio/userscriptCode";

const USERSCRIPT_VERSION = "1.4.4";

export interface Env {
  // Secrets
  AIRTABLE_TOKEN: string;
  SHARED_SECRET: string;
  GAS_WEBAPP_URL: string;
  GAS_SHARED_SECRET: string;

  // Presentador config (secrets — dades personals del representant acreditat
  // de l'entitat. Configurar via `npx wrangler secret put PRESENTADOR_*`).
  PRESENTADOR_NOMBRE: string;
  PRESENTADOR_NIE: string;
  PRESENTADOR_TIPODOC: string; // 'NF' | 'NV' | 'PA'
  PRESENTADOR_MOBIL: string;
  PRESENTADOR_EMAIL: string;

  // Entitat — dades PII del representant legal. Configurar via
  // `npx wrangler secret put REPRESENTANT_*`.
  REPRESENTANT_NOM: string;
  REPRESENTANT_DNI: string;
  REPRESENTANT_TITOL: string;

  // GitHub Actions dispatch — usat per /optimize/dispatch quan Airtable
  // dispara una Automation després de pujar un PDF nou. PAT amb scope
  // `workflow` (o `actions:write` pels fine-grained tokens).
  GITHUB_TOKEN?: string;
  GITHUB_OWNER?: string;
  GITHUB_REPO?: string;

  // Public vars (wrangler.toml)
  AIRTABLE_BASE_ID: string;
  CASOS_TABLE_ID: string;
  DOSSIER_FIELD_ID: string;
  INFORMES_VULN_TABLE_ID: string;
  INFORMES_VULN_PDF_FIELD: string;
  INFORMES_VULN_GENERATED_AT_FIELD: string;

  // Assets binding
  ASSETS: Fetcher;

  // KV namespace amb el segell de l'entitat i la firma del representant
  // (PNG bytes amb keys "entity-stamp" i "representative-signature").
  // Optional: si el binding no està configurat al wrangler.toml o les
  // keys no existeixen, el certificat A2 es genera sense aquells elements.
  // Vegeu src/private/README.md per a setup.
  PRIVATE_BINARIES?: KVNamespace;
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

    // ─── CORS preflight per a totes les rutes ──────────────────────
    // Endpoints com /anexo2, /generate, /gmail-draft i /mercurio/* es
    // criden des de contexts browser (Airtable Scripting Extensions,
    // Mercurio userscript) que envien preflight OPTIONS abans del POST.
    if (request.method === "OPTIONS") {
      return corsPreflight(request);
    }

    // ─── Mercurio routes ────────────────────────────────────────
    if (request.method === "GET" && url.pathname === "/mercurio.user.js") {
      return handleUserscript(request, env);
    }
    if (request.method === "GET" && url.pathname === "/mercurio/cases") {
      return handleMercurioCases(request, env);
    }
    if (request.method === "GET" && url.pathname === "/mercurio/payload") {
      return handleMercurioPayload(request, env);
    }
    if (request.method === "GET" && url.pathname === "/mercurio/documents") {
      return handleMercurioDocuments(request, env);
    }
    if (request.method === "GET" && url.pathname === "/mercurio/document") {
      return handleMercurioDocument(request, env);
    }
    if (request.method === "POST" && url.pathname === "/optimize/dispatch") {
      return handleOptimizeDispatch(request, env);
    }

    return json({ error: "Not found" }, 404);
  },
};

// ─── /generate (existing) ───────────────────────────────────────────────────

async function handleGenerate(request: Request, env: Env): Promise<Response> {
  if (!checkAuth(request, env)) return unauthorized(corsHeaders(request));

  let body: GenerateRequest;
  try {
    body = (await request.json()) as GenerateRequest;
  } catch {
    return corsJson({ error: "Invalid JSON body" }, request, 400);
  }
  if (!body.recordId || !body.recordId.startsWith("rec")) {
    return corsJson({ error: "Missing or invalid recordId" }, request, 400);
  }

  const baseId = body.baseId || env.AIRTABLE_BASE_ID;
  const tableId = env.CASOS_TABLE_ID;
  const fieldId = env.DOSSIER_FIELD_ID;
  const airtable = new AirtableClient(env.AIRTABLE_TOKEN, baseId);

  const entitat = buildEntitat(env);
  if (!entitat) {
    return corsJson(
      { error: "REPRESENTANT_* secrets not configured. See README → Setup." },
      request,
      500,
    );
  }

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
      entitat,
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

    return corsJson({
      ok: true,
      recordId: body.recordId,
      filename,
      formCode,
      viaLegal,
      simultaneousApplicants: simultaneousMembers.length,
      extraInserts: extraDependents.length,
      signed: Boolean(signatureBytes),
      sizeBytes: filledBytes.length,
    }, request);
  } catch (err) {
    console.error("generate error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return corsJson({ ok: false, error: message }, request, 500);
  }
}

// ─── /anexo2 ────────────────────────────────────────────────────────────────

async function handleAnexo2(request: Request, env: Env): Promise<Response> {
  if (!checkAuth(request, env)) return unauthorized(corsHeaders(request));

  let body: Anexo2Request;
  try {
    body = (await request.json()) as Anexo2Request;
  } catch {
    return corsJson({ error: "Invalid JSON body" }, request, 400);
  }
  if (!body.recordId || !body.recordId.startsWith("rec")) {
    return corsJson({ error: "Missing or invalid recordId" }, request, 400);
  }

  const tableId = env.INFORMES_VULN_TABLE_ID;
  const pdfField = env.INFORMES_VULN_PDF_FIELD;
  const generatedAtField = env.INFORMES_VULN_GENERATED_AT_FIELD;
  const airtable = new AirtableClient(env.AIRTABLE_TOKEN, env.AIRTABLE_BASE_ID);

  const entitat = buildEntitat(env);
  if (!entitat) {
    return corsJson(
      { error: "REPRESENTANT_* secrets not configured. See README → Setup." },
      request,
      500,
    );
  }

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

    const [entityStampPng, representativeSignaturePng] = await Promise.all([
      env.PRIVATE_BINARIES?.get("entity-stamp", "arrayBuffer") ?? null,
      env.PRIVATE_BINARIES?.get("representative-signature", "arrayBuffer") ?? null,
    ]);

    const pdfBytes = await fillAnexo2Pdf(templateBytes, record, {
      entitat,
      entityStampPng,
      representativeSignaturePng,
    });
    const filename = anexo2Filename(record);

    // One combined PATCH: clear attachment field + set timestamp. Saves an
    // Airtable API call (now 2 hits to api.airtable.com per /anexo2 instead
    // of 3 — important under the 5 req/sec per-base limit when 6-8 voluntaris
    // cliquen alhora). Si l'upload següent falla, el timestamp queda al
    // moment de la generació intentada — acceptable, sobreescrit al re-click.
    await airtable.updateFields(tableId, body.recordId, {
      [pdfField]: [],
      [generatedAtField]: new Date().toISOString(),
    });
    await airtable.uploadAttachment({
      recordId: body.recordId,
      fieldIdOrName: pdfField,
      filename,
      contentType: "application/pdf",
      bytes: pdfBytes,
    });

    return corsJson({
      ok: true,
      recordId: body.recordId,
      filename,
      sizeBytes: pdfBytes.length,
    }, request);
  } catch (err) {
    console.error("anexo2 error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return corsJson({ ok: false, error: message }, request, 500);
  }
}

// ─── /gmail-draft ───────────────────────────────────────────────────────────

async function handleGmailDraft(request: Request, env: Env): Promise<Response> {
  if (!checkAuth(request, env)) return unauthorized(corsHeaders(request));

  let body: GmailDraftRequest;
  try {
    body = (await request.json()) as GmailDraftRequest;
  } catch {
    return corsJson({ error: "Invalid JSON body" }, request, 400);
  }
  if (!body.to || !body.attachmentUrl) {
    return corsJson({ error: "Missing 'to' or 'attachmentUrl'" }, request, 400);
  }

  if (!env.GAS_WEBAPP_URL || !env.GAS_SHARED_SECRET) {
    return corsJson({ error: "GAS not configured (missing GAS_WEBAPP_URL or GAS_SHARED_SECRET)" }, request, 500);
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
      return corsJson(
        {
          ok: false,
          error: `GAS did not return JSON (status ${gasResp.status})`,
          rawResponse: text.slice(0, 500),
        },
        request,
        502,
      );
    }

    return new Response(JSON.stringify(parsed, null, 2), {
      status: gasResp.ok ? 200 : gasResp.status,
      headers: { "Content-Type": "application/json", ...corsHeaders(request) },
    });
  } catch (err) {
    console.error("gmail-draft error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return corsJson({ ok: false, error: `GAS fetch failed: ${message}` }, request, 502);
  }
}

// ─── Mercurio handlers ──────────────────────────────────────────────────────

const ALLOWED_CORS_ORIGINS = [
  "https://mercurio.delegaciondelgobierno.gob.es",
  "http://localhost:3001",
  "https://airtable.com",
  "https://app.airtable.com",
];
// Airtable Scripting Extensions corren en iframes sandboxed amb subdomain
// dinàmic. Reflectim l'Origin si fa match d'algun d'aquests patrons.
const AIRTABLE_ORIGIN_PATTERNS = [
  /^https:\/\/[a-z0-9-]+\.airtableblocks\.com$/,
  /^https:\/\/[a-z0-9-]+\.airtableusercontent\.com$/,
];

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin") ?? "";
  const isAllowed =
    ALLOWED_CORS_ORIGINS.includes(origin) ||
    AIRTABLE_ORIGIN_PATTERNS.some((re) => re.test(origin));
  const allow = isAllowed ? origin : ALLOWED_CORS_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

    // Filtre estat: amaguem casos amb estat 'Presentada' del llistat —
    // ja són tancats i no cal tornar-los a tocar des de Mercurio. El
    // voluntari els pot tornar a veure si cal canviant Estat manualment.
    const estatRaw = f["Estat"];
    const estatName = typeof estatRaw === "string"
      ? estatRaw
      : (estatRaw && typeof estatRaw === "object" && "name" in estatRaw)
        ? String((estatRaw as { name: string }).name)
        : "";
    if (/presentada/i.test(estatName)) continue;

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

  const presentador = buildPresentador(env);
  if (!presentador) {
    return corsJson(
      { error: "PRESENTADOR_* secrets not configured. See README → Setup." },
      request,
      500,
    );
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

  const payload = airtableToMercurio(recAsCase, presentador, refRec);
  const formulario = getFormulario(recAsCase);

  return corsJson({
    caso: recordId,
    idCas: (rec.fields as any)["ID Cas"],
    formulario,
    payload,
  }, request);
}

// ─── Documents (upload de PDFs a Mercurio des del userscript) ──────────────

// Constants per la taula `Documents` d'Airtable. NO hi ha tableId al wrangler.toml
// — l'API d'Airtable accepta el nom de taula a l'URL igual que un ID, així que
// fem servir el nom literal. Si Rob un dia renombra la taula, swap aquí.
//
// Schema esperat:
//   Casos.Documents              → multipleRecordLinks → Documents.id
//   Documents.Fitxers            → multipleAttachments (1 fitxer per record)
//   Documents."Mercurio tipus document" → singleSelect amb la taxonomia
//                                   alineada al <select> de Mercurio:
//                                   Pasaporte, Antecedentes penales, Tasa,
//                                   Permanencia, Documentación vía legal, Otros
const DOCUMENTS_TABLE = "Documents";
const DOCS_LINK_FIELD_ON_CASOS = "Documents";
const DOCS_ATTACHMENT_FIELD = "Fitxer";
const DOCS_TYPE_FIELD = "Mercurio tipus document";

interface AirtableAttachment {
  id?: string;
  url: string;
  filename: string;
  size: number;
  type: string;
}

/**
 * GET /mercurio/documents?caso=recXXX
 *
 * Retorna la llista de documents del cas, amb les categories canòniques
 * (label exacte de la taxonomia d'Airtable) perquè el userscript faci match
 * contra el `<select id="docAdjuntarAdjuntos">` del DOM.
 *
 * `downloadUrl` apunta a `/mercurio/document?caso=...&attId=...` d'aquest mateix
 * Worker — el voluntari MAI veu URLs Airtable signades. Avantatges: les URLs
 * Airtable expiren ~2h i una sessió Mercurio pot trigar més; a més centralitzem
 * audit logs al Worker.
 */
async function handleMercurioDocuments(request: Request, env: Env): Promise<Response> {
  if (!checkAuth(request, env)) return unauthorized(corsHeaders(request));
  const url = new URL(request.url);
  const caso = url.searchParams.get("caso");
  if (!caso || !/^rec[A-Za-z0-9]{14}$/.test(caso)) {
    return corsJson({ error: "missing or invalid 'caso' param" }, request, 400);
  }

  const at = new AirtableClient(env.AIRTABLE_TOKEN, env.AIRTABLE_BASE_ID);
  // byFieldId:false perquè els camps Documents/Fitxers/"Mercurio tipus document"
  // no tenen IDs hardcoded al projecte (a diferència de Casos).
  const casoRec = await at.getRecord(env.CASOS_TABLE_ID, caso, { byFieldId: false });

  const links = (casoRec.fields as Record<string, unknown>)[DOCS_LINK_FIELD_ON_CASOS];
  const linkIds: string[] = Array.isArray(links)
    ? (links as Array<string | { id: string }>).map((l) => typeof l === "string" ? l : l.id).filter(Boolean)
    : [];

  const baseUrl = `${url.protocol}//${url.host}`;
  const idCas = (casoRec.fields as Record<string, unknown>)["ID Cas"] ?? null;

  if (linkIds.length === 0) {
    return corsJson({ caso, idCas, documents: [] }, request);
  }

  // Fetch paral·lel — el AirtableClient.getRecords ja ho fa amb retry 429
  let docRecs;
  try {
    docRecs = await Promise.all(
      linkIds.map((id) => at.getRecord(DOCUMENTS_TABLE, id, { byFieldId: false })),
    );
  } catch (err) {
    console.error("documents fetch error:", err);
    return corsJson({ error: String(err instanceof Error ? err.message : err) }, request, 500);
  }

  const documents = [];
  for (const d of docRecs) {
    const f = d.fields as Record<string, unknown>;
    const atts = f[DOCS_ATTACHMENT_FIELD];
    if (!Array.isArray(atts) || atts.length === 0) continue; // sense fitxer adjunt — saltem
    const att = atts[0] as AirtableAttachment; // assumim 1 fitxer per record
    const cat = f[DOCS_TYPE_FIELD];
    const mercurioCategory = typeof cat === "string"
      ? cat
      : (cat && typeof cat === "object" && "name" in cat)
        ? String((cat as { name: string }).name)
        : "";

    documents.push({
      airtableId: d.id,
      filename: att.filename,
      mimetype: att.type ?? "application/octet-stream",
      mercurioCategory,
      sizeBytes: att.size,
      // attId == record id de la taula Documents (no l'attachment.id intern d'Airtable).
      // Fem servir record id perquè és estable i està indexat per la nostra
      // validació security al GET /mercurio/document.
      downloadUrl: `${baseUrl}/mercurio/document?caso=${encodeURIComponent(caso)}&attId=${encodeURIComponent(d.id)}`,
    });
  }

  return corsJson({ caso, idCas, documents }, request);
}

/**
 * GET /mercurio/document?caso=recXXX&attId=recYYY
 *
 * Proxy de bytes. Validem que recYYY (record a `Documents`) està enllaçat al
 * recXXX (Casos.Documents) — sense això, qualsevol amb el SHARED_SECRET podria
 * descarregar arbitràriament documents de la base coneixent recIds.
 *
 * Retornem amb `Content-Disposition` perquè el userscript pugui llegir el
 * filename del header (i ho compari amb tabla_datos_adj per pre-check de
 * duplicats si calgués).
 */
async function handleMercurioDocument(request: Request, env: Env): Promise<Response> {
  if (!checkAuth(request, env)) return unauthorized(corsHeaders(request));
  const url = new URL(request.url);
  const caso = url.searchParams.get("caso");
  const attId = url.searchParams.get("attId");
  if (!caso || !attId || !/^rec[A-Za-z0-9]{14}$/.test(caso) || !/^rec[A-Za-z0-9]{14}$/.test(attId)) {
    return corsJson({ error: "missing or invalid 'caso' / 'attId' param" }, request, 400);
  }

  const at = new AirtableClient(env.AIRTABLE_TOKEN, env.AIRTABLE_BASE_ID);

  // Security: verifica que el doc pertany al cas (els record id Airtable són
  // 14 chars alfanumèrics — no es poden endevinar, però amb un secret compartit
  // tot vol auditoria). Sense aquesta crida, un voluntari maliciós podria
  // demanar `/mercurio/document?attId=<qualsevol>` i exfiltrar.
  let casoRec;
  try {
    casoRec = await at.getRecord(env.CASOS_TABLE_ID, caso, { byFieldId: false });
  } catch (err) {
    console.error("document caso lookup error:", err);
    return corsJson({ error: `caso ${caso} not found` }, request, 404);
  }
  const links = (casoRec.fields as Record<string, unknown>)[DOCS_LINK_FIELD_ON_CASOS];
  const linkIds: string[] = Array.isArray(links)
    ? (links as Array<string | { id: string }>).map((l) => typeof l === "string" ? l : l.id).filter(Boolean)
    : [];
  if (!linkIds.includes(attId)) {
    return corsJson({ error: `document ${attId} not linked to caso ${caso}` }, request, 403);
  }

  let docRec;
  try {
    docRec = await at.getRecord(DOCUMENTS_TABLE, attId, { byFieldId: false });
  } catch (err) {
    console.error("document record lookup error:", err);
    return corsJson({ error: `document ${attId} not found` }, request, 404);
  }
  const atts = (docRec.fields as Record<string, unknown>)[DOCS_ATTACHMENT_FIELD];
  if (!Array.isArray(atts) || atts.length === 0) {
    return corsJson({ error: `document ${attId} has no attachment` }, request, 404);
  }
  const att = atts[0] as AirtableAttachment;

  // Descarrega bytes via URL signada Airtable (server-side fetch — el voluntari
  // mai veu aquesta URL).
  const fileResp = await fetch(att.url);
  if (!fileResp.ok) {
    return corsJson({ error: `airtable download failed: ${fileResp.status}` }, request, 502);
  }
  const bytes = await fileResp.arrayBuffer();

  // Filename: escape per evitar injection al header. RFC 6266 valor entre
  // cometes amb backslash-escape de " i \. La majoria de filenames Airtable
  // són ASCII safe (PDFs amb noms simples), però defensem.
  const safeName = att.filename.replace(/[\\"]/g, "_");
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": att.type ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safeName}"`,
      ...corsHeaders(request),
    },
  });
}

// ─── /optimize/dispatch ─────────────────────────────────────────────────────
//
// Endpoint cridat des d'una Airtable Automation quan es puja un PDF a la
// taula Documents. Dispara el workflow `optimize-pdfs.yml` de GitHub Actions
// que executa scripts/optimize-airtable-pdfs.ts (gs+ImageMagick al runner).
//
// Setup Airtable Automation:
//   Trigger:  When record is created/updated  →  Documents (taula)
//   Filter:   "Fitxer" is not empty
//   Action:   Send webhook
//             URL    = https://<worker>/optimize/dispatch
//             Method = POST
//             Header = Authorization: Bearer <SHARED_SECRET>
//             Body   = (qualsevol cosa, no es parseja)
//
// El workflow té concurrency=1, així que múltiples dispatches en burst
// s'encuen i el segon no troba res a fer (idempotència de l'script).
//
// Setup PAT GitHub:
//   1. Crear fine-grained PAT a https://github.com/settings/tokens?type=beta
//      Scope: Actions = Read & write, restringit al repo.
//   2. `npx wrangler secret put GITHUB_TOKEN`
//   3. Editar wrangler.toml [vars] amb GITHUB_OWNER + GITHUB_REPO
//      (o passar com a env al deploy).
async function handleOptimizeDispatch(request: Request, env: Env): Promise<Response> {
  if (!checkAuth(request, env)) return unauthorized(corsHeaders(request));

  const ghToken = env.GITHUB_TOKEN;
  const owner = env.GITHUB_OWNER ?? "andratwiro";
  const repo = env.GITHUB_REPO ?? "reus-refugi-pdf-worker";
  const workflow = "optimize-pdfs.yml";

  if (!ghToken) {
    return corsJson(
      { error: "GITHUB_TOKEN not configured. See /optimize/dispatch JSDoc." },
      request,
      500,
    );
  }

  try {
    const resp = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ghToken}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          // GitHub API requereix User-Agent.
          "User-Agent": "reus-refugi-pdf-worker",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({ ref: "main" }),
      },
    );

    if (!resp.ok) {
      const body = await resp.text();
      console.error(`GitHub dispatch failed ${resp.status}:`, body);
      return corsJson(
        { error: `GitHub dispatch ${resp.status}`, detail: body.slice(0, 300) },
        request,
        502,
      );
    }
    // GitHub respon 204 sense body en èxit.
    return corsJson({ ok: true, dispatched: workflow, owner, repo }, request);
  } catch (err) {
    console.error("optimize/dispatch error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return corsJson({ ok: false, error: message }, request, 500);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function checkAuth(request: Request, env: Env): boolean {
  const auth = request.headers.get("Authorization") || "";
  return auth === `Bearer ${env.SHARED_SECRET}`;
}

/**
 * Build PresentadorConfig from env secrets. Returns null if any required
 * field is missing — el handler retorna 500 amb missatge clar.
 */
function buildPresentador(env: Env): PresentadorConfig | null {
  const { PRESENTADOR_NOMBRE, PRESENTADOR_NIE, PRESENTADOR_TIPODOC, PRESENTADOR_MOBIL, PRESENTADOR_EMAIL } = env;
  if (!PRESENTADOR_NOMBRE || !PRESENTADOR_NIE || !PRESENTADOR_TIPODOC || !PRESENTADOR_MOBIL || !PRESENTADOR_EMAIL) {
    return null;
  }
  return {
    nombre: PRESENTADOR_NOMBRE,
    nie: PRESENTADOR_NIE,
    tipoDoc: PRESENTADOR_TIPODOC as PresentadorConfig["tipoDoc"],
    mobil: PRESENTADOR_MOBIL,
    email: PRESENTADOR_EMAIL,
  };
}

/**
 * Build EntitatConfig combining public registry data (ENTITAT_REUS_REFUGI_BASE)
 * with PII fields from env secrets. Returns null if any PII secret is missing.
 */
function buildEntitat(env: Env): EntitatConfig | null {
  const { REPRESENTANT_NOM, REPRESENTANT_DNI, REPRESENTANT_TITOL } = env;
  if (!REPRESENTANT_NOM || !REPRESENTANT_DNI || !REPRESENTANT_TITOL) {
    return null;
  }
  return {
    ...ENTITAT_REUS_REFUGI_BASE,
    representantNom: REPRESENTANT_NOM,
    representantDni: REPRESENTANT_DNI,
    representantTitol: REPRESENTANT_TITOL,
  };
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
