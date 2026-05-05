/**
 * Test harness offline per a l'Anexo II.
 *
 * Carrega la template, construeix un registre mock amb dades realistes
 * (cas Taoufiq del bug actual), genera el PDF amb fillAnexo2Pdf(), i el
 * renderitza a PNG amb diferents engines per a verificació visual.
 *
 * Engines:
 *   - poppler (pdftoppm)   → comportament similar a Chrome/Drive/Linux
 *   - poppler cairo        → variant alternativa
 *   - ghostscript (gs)     → engine independent (Adobe-like)
 *
 * Si totes 3 mostren el mateix correctament, és força segur que la
 * pràctica totalitat de visors ho mostraran bé.
 *
 * Run:
 *   cd mock && npx tsx anexo2-render-test.ts
 */

import { promises as fs } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fillAnexo2Pdf } from "../src/anexo2.js";
import { ENTITAT_REUS_REFUGI_BASE, type EntitatConfig } from "../src/mappings.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const TEMPLATE = path.join(REPO_ROOT, "assets/A2_certificado_vulnerabilidad.pdf");
const STAMP = path.join(REPO_ROOT, "src/private/entity-stamp.png");
const SIGNATURE = path.join(REPO_ROOT, "src/private/representative-signature.png");
const OUT_DIR = path.join(__dirname, "anexo2-test-out");

// Cas real del bug: Taoufiq Elhayani (IV-022). Valors agafats del screenshot
// que Rob ha compartit. Camps que no es veuen al screenshot els deixem buits
// o amb defaults raonables.
const MOCK_RECORD = {
  id: "recTAOUFIQ123456",
  fields: {
    fldkwRL1btyKBJIGM: "Taoufiq Elhayani",          // nom
    fldoyGzPjQ5jwIMck: "Passaport",                  // tipusDoc (no usat al fill, només per completesa)
    flduSnTZLHPP0NMTb: "GS7695056",                  // numDoc (passaport)
    fldJ5bd3Xniot5RFt: "2000-12-09",                 // dataNaixement (ISO)
    fldhIVVLGHCYVZfdn: "Marroc",                     // nacionalitat
    fldDRwjyqRITqmAUZ: "Avinguda Barcelona 9 p03 puerta 30", // domicili
    fldX8zuPpEZromBfh: "+34604245258",               // telefon
    fldntiT4dQi7Usn2Q: "Reus",                       // localitat
    fldbxRqfIXg8la2az: "43201",                      // cp
    fld7VvSakBt59Xrkj: "",                           // provincia (template té "Tarragona" default)
    fld36a7AAARLJUKlE: "info@reusrefugi.cat",        // email (no usat al PDF)
    fldmv1XoELN9E1KR7: [                             // factors (multipleSelect)
      { id: "selQPZ0N6xMPRXuWo", name: "Aïllament social o manca de xarxa de suport" },
      { id: "selcVnJ4wTgGkjjPr", name: "Víctima de discriminació o exclusió social" },
      { id: "selWderpMATkL57L9", name: "Manca d'ingressos suficients" },
      { id: "selLHNuj87FGMBesr", name: "Dificultat d'accés a l'ocupació" },
    ],
  },
};

async function readBytes(file: string): Promise<ArrayBuffer | null> {
  try {
    const buf = await fs.readFile(file);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  console.log("→ Loading template:", TEMPLATE);
  const templateBytes = (await readBytes(TEMPLATE))!;
  const stampBytes = await readBytes(STAMP);
  const signatureBytes = await readBytes(SIGNATURE);
  console.log(`→ Stamp:     ${stampBytes ? `${stampBytes.byteLength} bytes` : "MISSING"}`);
  console.log(`→ Signature: ${signatureBytes ? `${signatureBytes.byteLength} bytes` : "MISSING"}`);

  // Mock entitat: usa les dades públiques + valors de placeholder PII per testing
  const entitat: EntitatConfig = {
    ...ENTITAT_REUS_REFUGI_BASE,
    representantNom: "REPRESENTANT TEST",
    representantDni: "00000000T",
    representantTitol: "PRESIDENT",
  };

  console.log("→ Calling fillAnexo2Pdf with mock record (Taoufiq)…");
  const filledBytes = await fillAnexo2Pdf(templateBytes, MOCK_RECORD, {
    entitat,
    entityStampPng: stampBytes,
    representativeSignaturePng: signatureBytes,
  });

  await fs.mkdir(OUT_DIR, { recursive: true });
  const pdfPath = path.join(OUT_DIR, "anexo2-test.pdf");
  await fs.writeFile(pdfPath, filledBytes);
  console.log(`→ PDF written: ${pdfPath} (${filledBytes.length} bytes)`);

  // Render with multiple engines
  const renders = [
    {
      name: "poppler (pdftoppm)",
      cmd: `pdftoppm -png -r 200 -f 1 -l 1 "${pdfPath}" "${path.join(OUT_DIR, "poppler")}"`,
      output: path.join(OUT_DIR, "poppler-1.png"),
    },
    {
      name: "poppler cairo (pdftocairo)",
      cmd: `pdftocairo -png -r 200 -f 1 -l 1 "${pdfPath}" "${path.join(OUT_DIR, "cairo")}"`,
      output: path.join(OUT_DIR, "cairo-1.png"),
    },
    {
      name: "ghostscript",
      cmd: `gs -dNOPAUSE -dBATCH -sDEVICE=png16m -r120 -dFirstPage=1 -dLastPage=1 -sOutputFile="${path.join(OUT_DIR, "gs.png")}" "${pdfPath}" >/dev/null 2>&1`,
      output: path.join(OUT_DIR, "gs.png"),
    },
  ];

  for (const r of renders) {
    console.log(`→ Rendering with ${r.name}…`);
    try {
      execSync(r.cmd, { stdio: "inherit" });
      const stat = await fs.stat(r.output);
      console.log(`  ✅ ${r.output} (${stat.size} bytes)`);
    } catch (err) {
      console.error(`  ❌ ${r.name} failed:`, err instanceof Error ? err.message : err);
    }
  }

  console.log("\nDone. Inspect PNGs at:", OUT_DIR);
}

main().catch((err) => {
  console.error("Test harness failed:", err);
  process.exit(1);
});
