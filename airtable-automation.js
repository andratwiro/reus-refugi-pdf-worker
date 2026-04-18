/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  AIRTABLE AUTOMATION SCRIPT — Generar Dossier
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
 *  4. Secrets al script (configura al pas "Run script"):
 *     - WORKER_URL      → https://reus-refugi-pdf-worker.<subdomain>.workers.dev
 *     - SHARED_SECRET   → el mateix string que vas posar al Worker via
 *                          `npx wrangler secret put SHARED_SECRET`
 *
 *  5. Test: clica el botó en un cas, hauria d'aparèixer un PDF al camp
 *     "Dossier generat" en ~5-10 segons.
 *
 * ─────────────────────────────────────────────────────────────────────────
 */

// ⚠️  Canvia aquests dos valors abans de desar ⚠️
const WORKER_URL = "https://reus-refugi-pdf-worker.YOUR-SUBDOMAIN.workers.dev";
const SHARED_SECRET = "PASTE-THE-SAME-SECRET-YOU-SET-IN-WRANGLER";

// Llegeix recordId del trigger del botó
const inputConfig = input.config();
const recordId = inputConfig.recordId;

if (!recordId) {
  throw new Error("No recordId provided by the button trigger");
}

console.log(`Generating dossier for record: ${recordId}`);

const response = await fetch(`${WORKER_URL}/generate`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${SHARED_SECRET}`,
  },
  body: JSON.stringify({ recordId }),
});

const result = await response.json();

if (!response.ok || !result.ok) {
  console.error("Worker returned error:", result);
  throw new Error(`Failed to generate dossier: ${result.error || response.statusText}`);
}

console.log(`✅ Dossier generat: ${result.filename} (${result.sizeBytes} bytes)`);
output.set("filename", result.filename);
output.set("sizeBytes", result.sizeBytes);
