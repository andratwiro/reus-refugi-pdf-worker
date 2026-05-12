/**
 * Test E2E batch: fusiona TOTS els Documents multi-fitxer reals d'Airtable
 * i escriu cada PDF combinat a output/merged-samples/ per inspecció visual.
 *
 * Llegeix /tmp/multi-docs.jsonl (un objecte JSON per línia amb {id, ref, atts[]}).
 * Run: npx tsx mock/test/test-merge-batch.ts
 */

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { mergeToPdf, UnsupportedFormatError, type MergeInput } from "../../src/mercurio/mergeDocs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(__dirname, "output", "merged-samples");

interface Att {
  id: string;
  url: string;
  filename: string;
  size: number;
  type: string;
}

interface DocRow {
  id: string;
  ref: string;
  atts: Att[];
}

function sanitize(s: string) {
  return s.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 80);
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

async function countPages(bytes: Uint8Array): Promise<number | null> {
  try {
    const d = await PDFDocument.load(bytes, { ignoreEncryption: true });
    return d.getPageCount();
  } catch { return null; }
}

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const raw = readFileSync("/tmp/multi-docs.jsonl", "utf8");
  const rows: DocRow[] = raw.trim().split("\n").map((l) => JSON.parse(l));

  console.log(`→ ${rows.length} Documents multi-fitxer a fusionar\n`);
  const results: Array<{ doc: string; ok: boolean; note: string }> = [];

  for (const row of rows) {
    const refSafe = sanitize(row.ref || row.id);
    const outName = `${row.id}__${refSafe}.pdf`;
    process.stdout.write(`  ${row.atts.length} fitxers → ${row.ref.padEnd(45)} ... `);

    try {
      const inputs: MergeInput[] = [];
      let totalIn = 0;
      for (const a of row.atts) {
        const bytes = await fetchBytes(a.url);
        totalIn += bytes.byteLength;
        inputs.push({ bytes, filename: a.filename, mimetype: a.type ?? "application/octet-stream" });
      }
      const merged = await mergeToPdf(inputs);
      const pages = await countPages(merged);
      writeFileSync(resolve(OUTPUT_DIR, outName), merged);
      console.log(`✓ ${merged.byteLength} bytes, ${pages ?? "?"} pàg`);
      results.push({ doc: row.id, ok: true, note: `${pages} pàg, ${merged.byteLength}B (${totalIn}B in)` });
    } catch (e) {
      const msg = e instanceof UnsupportedFormatError ? e.message : String(e);
      console.log(`✗ ${msg}`);
      results.push({ doc: row.id, ok: false, note: msg });
    }
  }

  const ok = results.filter((r) => r.ok).length;
  console.log(`\n→ ${ok}/${results.length} fusions OK`);
  console.log(`→ Output: ${OUTPUT_DIR}/`);
  if (results.some((r) => !r.ok)) {
    console.log(`\nErrors:`);
    for (const r of results.filter((x) => !x.ok)) console.log(`  ${r.doc}: ${r.note}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
