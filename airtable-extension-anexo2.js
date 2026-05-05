/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  AIRTABLE SCRIPTING EXTENSION — Generar Informe de Vulnerabilitat
 *  POST /anexo2
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Aquest script viu a una Scripting Extension d'una Dashboard d'Airtable
 * (el que es veu com "Dashboard 1 → generar"). El voluntari selecciona una
 * fila de la taula `Informes de Vulnerabilitat` i el script crida el Worker
 * per generar el PDF.
 *
 * Diferent de `airtable-automation.js`:
 *   - Aquell és una Automation (button → run script).
 *   - Aquest és una Scripting Extension (UI interactiva al dashboard).
 *
 * SETUP:
 *  1. Dashboard → Add an extension → Scripting
 *  2. Edit code → enganxa aquest codi
 *  3. Constants WORKER_URL i SHARED_SECRET (valors de wrangler)
 *  4. Run → seleccionar fila → genera el PDF
 *
 *  IMPORTANT: si modifiques aquest fitxer al repo, recorda copiar-lo
 *  manualment a l'extensió — no hi ha sync automàtic.
 *
 * ─────────────────────────────────────────────────────────────────────────
 */

// ⚠️  Canvia aquests dos valors abans de desar ⚠️
const WORKER_URL = "https://reus-refugi-pdf-worker.YOUR-SUBDOMAIN.workers.dev";
const SHARED_SECRET = "PASTE-THE-SAME-SECRET-YOU-SET-IN-WRANGLER";

const TABLE_NAME = "Informes de Vulnerabilitat";

const table = base.getTable(TABLE_NAME);
const record = await input.recordAsync("Selecciona fila", table);
if (!record) {
  output.text("Cap fila seleccionada.");
  return;
}

output.markdown(`⏳ Generant informe per **${record.name}**...`);

const result = await callWorkerWithRetry(`${WORKER_URL}/anexo2`, SHARED_SECRET, {
  recordId: record.id,
});

output.markdown(`✅ **${result.filename}** (${result.sizeBytes} bytes)`);

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
      output.markdown(`⏳ Reintent ${attempt + 1}/${delays.length} en ${delays[attempt]/1000}s...`);
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
  throw lastErr;
}

// ─────────────────────────────────────────────────────────────────────────
//  callWorker — POST JSON i parseja la resposta amb missatges d'error útils.
//
//  Per què cal: feien `await response.json()` directament i si el cos no
//  era JSON (Cloudflare 1xxx HTML error page, timeout 524, body buit per
//  fetch avortat...) saltava "SyntaxError: JSON.parse: unexpected character
//  at line 1 column 1" sense pista de la causa real. Aquí llegim text →
//  parsegem amb try/catch → re-llencem amb el contingut real perquè es
//  vegi al panell d'error de l'extensió.
//
//  Possibles causes intermitents per /anexo2 (per record):
//   - Bursts paral·lels de voluntaris → 429 d'Airtable + 30s retry > timeout
//     del fetch del browser de l'extensió.
//   - Worker excedeix CPU/wall-time per renders pesats.
//   - Cloudflare Worker cold start + 524.
// ─────────────────────────────────────────────────────────────────────────
async function callWorker(url, secret, body) {
  // POST "simple" — no dispara CORS preflight perquè:
  //  - Content-Type: text/plain (els 3 valors "simples" són text/plain,
  //    application/x-www-form-urlencoded i multipart/form-data)
  //  - cap Authorization header (Authorization sempre dispara preflight)
  //
  // El secret va dins el body JSON. Necessari per a Scripting Extensions
  // de Dashboards d'Airtable, on el sandbox de l'iframe rebutja preflights
  // cap a *.workers.dev silenciosament → fetch() rejecta amb NetworkError
  // indistingible d'un DNS fail.
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
