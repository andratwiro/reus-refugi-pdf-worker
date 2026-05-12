/**
 * Test E2E del merge d'adjunts per al cas RR-069-CINDY-MORALES.
 *
 * El record "PERMANENCIA" d'aquest cas té 3 PDFs (padró + línia telefònica +
 * vol KLM). Aquest script:
 *   1. Descarrega els 3 PDFs via les URLs signades d'Airtable.
 *   2. Crida mergeToPdf — la mateixa funció que el Worker fa servir.
 *   3. Escriu el resultat a output/cindy-permanencia-merged.pdf.
 *   4. Verifica: # pàgines total == suma de pàgines de cada input.
 *
 * Run: npx tsx mock/test/test-merge-cindy.ts
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { mergeToPdf, type MergeInput } from "../../src/mercurio/mergeDocs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(__dirname, "output");

// URLs i metadades extretes via Airtable MCP, cas recPpWkyuDz227REu,
// document recTjwKHGQ04e2SDw (PERMANENCIA).
const INPUTS = [
  {
    filename: "Certificado Padron Cindy.pdf",
    mimetype: "application/pdf",
    expectedSize: 115110,
    url: "https://v5.airtableusercontent.com/v3/u/53/53/1778623200000/_rMvZURWZ058Ju9s8fGDew/ebIQRpr-gS064wbVGFePFMr38R5-gmSFgtQcwtFNIhUgxCglAa6XKEheavO7YULL7zWte1Abh7knmycxJLu8soaRn4Xi72Hb3sXzFkzL0-QdCdxxWaKKFRZB5K3pAivgpOWJC3xGOVt_3WmVq3YUX2uY0fv67wxCwv-DtdqaE8s04lhVv_3pRBI8sbvZ8EgR/octBMTRpNNhXdWq12KULQmmxYHKVEwjO0FXvuJMZZh0",
  },
  {
    filename: "Cindy prueba permanencia linea telefonica dic-abril.pdf",
    mimetype: "application/pdf",
    expectedSize: 680857,
    url: "https://v5.airtableusercontent.com/v3/u/53/53/1778623200000/KPPezKuZHgyInlbA09a3vA/QHecLj_pOEf-c7kpCRbxLR7uy1BC9j1BfTp4KMhLKLbWB9DU-UJXQm-Wm1q2T33BLfXQT8mBlJJGRoJ9lTwtwi-9gll6nh351p2r7Keb5LCeqdEk3VirzqlKE7SY2WuSLuyHrHZ1BQLCNF9dAb34_-H1UJlkfV7lKEO6MCe2li2EnBL6D2xi_Or9fppz3LUhZ22MM7-qc85FrGAZMTVrnw/nCbPTvmVLEyfcHKpywcjCinL3Hz6WGWLwQiuN23n708",
  },
  {
    filename: "KLM Royal Dutch Airlines - Book flights online - KLM CO.pdf",
    mimetype: "application/pdf",
    expectedSize: 96608,
    url: "https://v5.airtableusercontent.com/v3/u/53/53/1778623200000/NxFrquSz_c_2N764jURJVg/engA45YJrcW05SxeZ6PaQWlvj1MwAK01-nUutMm4AUFJ0lnJB8kc1rowh2oWBiQZ-PZ1mRQqM8nNiuCODojl55bBBSqZsNpPloIgD7VxoQkQpG_dnBze8l7LFW6DzmFtXYowleObbgIm21ufTzDaSfWT9K6AJZD2MaDgaptHvODZCYgLvT7LWD8MHPm-E4wmbsMIyjUHlM-F0FbioaEoEg/HVgR33I5ivqR8YmiS6bzsJKZymjWSNg2MUG-pKGvTHk",
  },
];

async function countPages(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return doc.getPageCount();
}

async function main() {
  console.log("→ Cas: RR-069-CINDY-MORALES, document PERMANENCIA");
  console.log(`→ ${INPUTS.length} adjunts a fusionar\n`);

  const inputs: MergeInput[] = [];
  let totalInputPages = 0;
  let totalInputBytes = 0;

  for (const i of INPUTS) {
    process.stdout.write(`  ↓ ${i.filename} ... `);
    const r = await fetch(i.url);
    if (!r.ok) {
      console.log(`FAIL ${r.status}`);
      throw new Error(`download failed: ${r.status}`);
    }
    const bytes = new Uint8Array(await r.arrayBuffer());
    const pages = await countPages(bytes);
    totalInputPages += pages;
    totalInputBytes += bytes.byteLength;
    console.log(`${bytes.byteLength} bytes, ${pages} pàgines`);
    if (Math.abs(bytes.byteLength - i.expectedSize) > 1024) {
      console.log(`    ⚠️  mida diferent de l'esperada (${i.expectedSize})`);
    }
    inputs.push({ bytes, filename: i.filename, mimetype: i.mimetype });
  }

  console.log(`\n  total entrada: ${totalInputBytes} bytes, ${totalInputPages} pàgines\n`);

  const t0 = performance.now();
  const merged = await mergeToPdf(inputs);
  const ms = (performance.now() - t0).toFixed(1);

  const mergedPages = await countPages(merged);
  console.log(`✓ Merge OK — ${ms}ms`);
  console.log(`  sortida: ${merged.byteLength} bytes, ${mergedPages} pàgines`);

  if (mergedPages !== totalInputPages) {
    console.log(`\n✗ ERROR: el PDF resultant té ${mergedPages} pàgines, esperaven ${totalInputPages}`);
    process.exit(1);
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const outPath = resolve(OUTPUT_DIR, "cindy-permanencia-merged.pdf");
  writeFileSync(outPath, merged);
  console.log(`\n→ Escrit a: ${outPath}`);
  console.log("  obre-ho amb Preview per inspeccionar visualment.");
}

main().catch((e) => {
  console.error("\n✗ Test FAIL:", e);
  process.exit(1);
});
