/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  AIRTABLE AUTOMATION SCRIPT — Generar Dossier (POST /generate)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Copia aquest codi a l'Airtable Automation que es dispara pel botó.
 *
 * SETUP A AIRTABLE (fes-ho un cop):
 *
 *  1. A la taula Casos, crea un camp tipus "Button"
 *     - Etiqueta: "🔘 Generar dossier"
 *     - Action: "Run script" (triggera l'automation)
 *
 *  2. Automations → Create automation "Generar dossier"
 *     - Trigger: "When a button is clicked"
 *     - Table: Casos
 *     - Button: el camp que has creat
 *
 *  3. Add action: "Run script"
 *     - Input variables:
 *         recordId   → Airtable record ID (usa {recordId} del trigger)
 *     - Script: enganxa el codi de sota
 *
 *  4. Constants al script:
 *     - WORKER_URL      → https://reus-refugi-pdf-worker.<subdomain>.workers.dev
 *     - SHARED_SECRET   → el mateix string que vas posar al Worker via
 *                          `npx wrangler secret put SHARED_SECRET`
 *
 *  5. Test: clica el botó en un cas, hauria d'aparèixer un PDF al camp
 *     "Dossier generat" en ~5-10 segons.
 *
 *  IMPORTANT: si modifiques aquest fitxer al repo, recorda copiar-lo
 *  manualment al script de l'Airtable Automation — no hi ha sync automàtic.
 *
 * ─────────────────────────────────────────────────────────────────────────
 */

// ⚠️  Canvia aquests dos valors abans de desar ⚠️
const WORKER_URL = "https://reus-refugi-pdf-worker.YOUR-SUBDOMAIN.workers.dev";
const SHARED_SECRET = "PASTE-THE-SAME-SECRET-YOU-SET-IN-WRANGLER";

const inputConfig = input.config();
const recordId = inputConfig.recordId;

if (!recordId) {
  throw new Error("No recordId provided by the button trigger");
}

console.log(`Generating dossier for record: ${recordId}`);

const result = await callWorkerWithRetry(`${WORKER_URL}/generate`, SHARED_SECRET, { recordId });

console.log(`✅ Dossier generat: ${result.filename} (${result.sizeBytes} bytes)`);
output.set("filename", result.filename);
output.set("sizeBytes", result.sizeBytes);

// ─────────────────────────────────────────────────────────────────────────
//  callWorkerWithRetry — retry transparent en 429 / 5xx / non-JSON.
//
//  Backoff: 2s, 4s, 8s (3 retries màxim). Cobreix el lockout de 30s
//  d'Airtable per burst (5 req/sec per base) i els Cloudflare 524
//  intermitents.
// ─────────────────────────────────────────────────────────────────────────
async function callWorkerWithRetry(url, secret, body) {
  const delays = [2000, 4000, 8000];
  let lastErr;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await callWorker(url, secret, body);
    } catch (err) {
      lastErr = err;
      const msg = String(err.message || err);
      const retryable =
        / HTTP 429\b/.test(msg) ||
        / HTTP 5\d\d\b/.test(msg) ||
        /non-JSON/.test(msg) ||
        /empty body/.test(msg) ||
        /Network error/.test(msg);
      if (!retryable || attempt === delays.length) throw err;
      console.log(`Retry ${attempt + 1}/${delays.length} in ${delays[attempt]}ms — ${msg}`);
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
  throw lastErr;
}

// ─────────────────────────────────────────────────────────────────────────
//  callWorker — POST JSON i parseja la resposta amb missatges d'error útils.
//
//  Per què cal: Airtable Scripting fa `await response.json()` i si el cos
//  no és JSON (Cloudflare 1xxx HTML error page, timeout, body buit, etc.)
//  fallava amb "JSON.parse: unexpected character at line 1 column 1" i
//  perdíem la causa real. Aquí llegim text → parsegem amb try/catch →
//  re-llencem amb el contingut real perquè es vegi al log de l'Automation.
// ─────────────────────────────────────────────────────────────────────────
async function callWorker(url, secret, body) {
  // POST "simple" sense preflight CORS — Content-Type text/plain + secret
  // dins el body. Veure airtable-extension-anexo2.js pel detall.
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ ...body, secret }),
    });
  } catch (err) {
    throw new Error(`Network error calling worker: ${err.message || err}`);
  }

  const text = await response.text();

  if (!text) {
    throw new Error(
      `Worker returned empty body (HTTP ${response.status} ${response.statusText}). ` +
        `Likely Cloudflare timeout or worker crash — check Workers logs.`,
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const snippet = text.slice(0, 300).replace(/\s+/g, " ").trim();
    throw new Error(
      `Worker returned non-JSON (HTTP ${response.status}). ` +
        `First 300 chars: ${snippet}`,
    );
  }

  if (!response.ok || !parsed.ok) {
    const detail = parsed.error || parsed.message || response.statusText;
    throw new Error(`Worker error (HTTP ${response.status}): ${detail}`);
  }

  return parsed;
}
