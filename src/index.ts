/**
 * Cloudflare Worker: genera el dossier EX-32 d'un cas i l'adjunta a la fila.
 *
 * Flux:
 *   Airtable button → Automation script → POST /generate
 *     → Worker valida el shared secret
 *     → Fetch del record d'Airtable
 *     → Neteja el camp d'attachment (replace semantics)
 *     → Carrega el template PDF des dels static assets
 *     → Omple els camps (decision tree a fillPdf.ts)
 *     → Puja el PDF a Airtable via uploadAttachment
 *     → Retorna 200 amb {ok: true, filename}
 */

import { AirtableClient } from "./airtable";
import { fillCasPdf } from "./fillPdf";
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

    // Build filename from case code + surname
    const codi = getStr(record.fields, CASOS.codi) || record.id;
    const filename = `${codi}_EX32.pdf`;

    // 4. Load PDF template from bundled static assets
    const templateResp = await env.ASSETS.fetch("https://placeholder/EX32_oficial.pdf");
    if (!templateResp.ok) {
      throw new Error(`Failed to load template PDF: ${templateResp.status}`);
    }
    const templateBytes = await templateResp.arrayBuffer();

    // 5. Fill the PDF using the decision tree
    const filledBytes = await fillCasPdf(templateBytes, record);

    // 6. Clear existing attachments (replace semantics)
    await airtable.clearAttachmentField(tableId, body.recordId, fieldId);

    // 7. Upload the generated PDF
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

function getStr(fields: Record<string, unknown>, fieldId: string): string {
  const v = fields[fieldId];
  if (typeof v === "string") return v;
  return "";
}
