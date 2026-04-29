#!/usr/bin/env tsx
/**
 * Comprimeix PDFs grans de la taula Documents d'Airtable amb ghostscript.
 *
 * Mercurio té un límit de 15MB total de documents per cas. Alguns escanejos
 * (passaports, antecedents) poden ser 5-10MB cada un. Aquest script descarrega
 * cada PDF de la taula Documents > THRESHOLD, el comprimeix a 150dpi qualitat
 * lectura (gs -dPDFSETTINGS=/ebook), i si l'estalvi val la pena (>10%), buida
 * el camp d'attachment i re-puja la versió comprimida.
 *
 * Idempotent: PDFs ja optimitzats mostren <10% de reducció en passades
 * subsegüents, així que es salten automàticament.
 *
 * USAGE:
 *   AIRTABLE_TOKEN=patXXX tsx scripts/optimize-airtable-pdfs.ts        # dry-run
 *   AIRTABLE_TOKEN=patXXX tsx scripts/optimize-airtable-pdfs.ts --apply # aplica
 *
 * OPCIONS:
 *   --apply              Sobreescriu els originals (default: dry-run)
 *   --threshold-mb=1.0   Mida mínima per processar (default 1MB)
 *   --min-reduction=10   % mínim de reducció per re-pujar (default 10)
 *   --limit=N            Processa només els primers N candidats (debug)
 *   --record=recXXX      Processa només aquest record id (debug)
 *
 * REQUERIMENTS:
 *   - ghostscript instal·lat (Mac: `brew install ghostscript`)
 *   - Token Airtable amb scopes: data.records:read, data.records:write
 *     Crear a https://airtable.com/create/tokens, restringir a la base.
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ─── Config ──────────────────────────────────────────────────────────
const TOKEN = process.env.AIRTABLE_TOKEN ?? "";
const BASE_ID = "appWuXncpGWaFTR4M";
const TABLE_ID = "tbl4rihesCRul0KLB"; // Documents
const ATTACHMENT_FIELD_ID = "fld8V3dOHiCjBOp2w"; // Fitxer
// REFERENCIA_FIELD_ID intencionadament NO usat als logs — el camp primary
// d'Airtable conté noms reals (p.ex. "Pasaporte - Ahmed") i aquests logs
// són públics (repo open-source). Loguem només el record ID (recXXX), que
// és opac sense accés a la base.

const argFlag = (n: string) => process.argv.includes(`--${n}`);
const argVal = (n: string, def: string) =>
  process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? def;

const APPLY = argFlag("apply");
const THRESHOLD_MB = parseFloat(argVal("threshold-mb", "1.0"));
const MIN_REDUCTION_PCT = parseFloat(argVal("min-reduction", "10"));
const LIMIT = parseInt(argVal("limit", "0"), 10) || Infinity;
const SINGLE_RECORD = argVal("record", "");

if (!TOKEN || TOKEN === "patFAKE_local_test_only") {
  console.error("❌ AIRTABLE_TOKEN missing or fake.");
  console.error("   export AIRTABLE_TOKEN=patXXX  # crea-ho a airtable.com/create/tokens");
  console.error("   Scopes: data.records:read + data.records:write, base appWuXncpGWaFTR4M");
  process.exit(1);
}

// Verifica que gs hi és
try {
  execSync("gs --version", { stdio: "pipe" });
} catch {
  console.error("❌ ghostscript no instal·lat. Mac: `brew install ghostscript`");
  process.exit(1);
}

// Detecta el binari de ImageMagick — Mac homebrew: `magick` (v7).
// Ubuntu/Debian: `convert` (v6) per defecte. Mateixos flags, diferent nom.
function detectMagick(): string | null {
  for (const cmd of ["magick", "convert"]) {
    try {
      execSync(`${cmd} --version`, { stdio: "pipe" });
      return cmd;
    } catch {
      /* try next */
    }
  }
  return null;
}
const MAGICK_CMD = detectMagick();
if (!MAGICK_CMD) {
  console.warn("⚠️  ImageMagick no detectat — només es farà servir gs (estalvi més modest).");
}

// ─── Types ───────────────────────────────────────────────────────────
interface Attachment {
  id: string;
  url: string;
  filename: string;
  size: number;
  type: string;
}
interface Record {
  id: string;
  fields: { [k: string]: unknown };
}

// ─── Helpers ─────────────────────────────────────────────────────────
function bytes(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "MB";
  if (n >= 1e3) return (n / 1e3).toFixed(0) + "KB";
  return n + "B";
}

async function airtable(method: string, path: string, body?: unknown): Promise<any> {
  const resp = await fetch(`https://api.airtable.com/v0${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) {
    throw new Error(`Airtable ${method} ${path} → ${resp.status}: ${await resp.text()}`);
  }
  return resp.json();
}

async function listAllDocuments(): Promise<Record[]> {
  const out: Record[] = [];
  let offset: string | undefined;
  do {
    const params = new URLSearchParams();
    params.set("pageSize", "100");
    params.set("returnFieldsByFieldId", "true"); // accés per ID al codi
    if (offset) params.set("offset", offset);
    const data = await airtable("GET", `/${BASE_ID}/${TABLE_ID}?${params}`);
    out.push(...data.records);
    offset = data.offset;
  } while (offset);
  return out;
}

async function clearAttachmentField(recordId: string): Promise<void> {
  await airtable("PATCH", `/${BASE_ID}/${TABLE_ID}/${recordId}`, {
    fields: { [ATTACHMENT_FIELD_ID]: [] },
  });
}

async function uploadAttachment(
  recordId: string,
  filename: string,
  bytes: Buffer,
): Promise<void> {
  // Endpoint dedicat per a binari. NO és api.airtable.com sino content.*.
  const url = `https://content.airtable.com/v0/${BASE_ID}/${recordId}/${ATTACHMENT_FIELD_ID}/uploadAttachment`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contentType: "application/pdf",
      file: bytes.toString("base64"),
      filename,
    }),
  });
  if (!resp.ok) {
    throw new Error(`uploadAttachment ${resp.status}: ${await resp.text()}`);
  }
}

/**
 * Provem dues estratègies i triem la que redueix més:
 *
 *  A) ImageMagick rasteritzat (120dpi · JPEG q60)
 *     Brutal per a scans 300dpi (els passaports d'iR-ADV típics: 9.7MB→1.3MB).
 *     Però infla PDFs amb text vectorial pur (no rasteritza eficientment),
 *     així que cal comparar abans d'aplicar.
 *
 *  B) Ghostscript /ebook (150dpi · downsampling automàtic)
 *     Conserva text vectorial, comprimeix imatges. Útil per PDFs híbrids
 *     (text + scan). Estalvi modest (10-30%).
 *
 * El millor de A i B es retorna; si cap baixa del threshold, retornem null.
 */
function compressBest(inPath: string, baseOutPath: string): { bytes: Buffer; method: string } | null {
  const candidates: Array<{ bytes: Buffer; method: string }> = [];

  // Timeouts agressius — alguns PDFs corruptes o massa grans poden penjar
  // magick/gs indefinidament. 60s és més que suficient per a 50MB.
  const EXEC_OPTS = { stdio: "pipe" as const, timeout: 60_000, killSignal: "SIGKILL" as const };

  // A) ImageMagick rasteritzat (si està disponible)
  if (MAGICK_CMD) {
    try {
      const aPath = baseOutPath + ".magick.pdf";
      execSync(
        `${MAGICK_CMD} -density 120 "${inPath}" -compress jpeg -quality 60 "${aPath}"`,
        EXEC_OPTS,
      );
      candidates.push({ bytes: readFileSync(aPath), method: `${MAGICK_CMD}:120dpi/q60` });
    } catch (e) {
      // Pot fallar per policy.xml d'Ubuntu (PDF blocked per CVE 2018) o PDFs corruptes.
    }
  }

  // B) Ghostscript /ebook
  try {
    const bPath = baseOutPath + ".gs.pdf";
    execSync(
      `gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/ebook ` +
        `-dNOPAUSE -dBATCH -dQUIET -dDetectDuplicateImages=true ` +
        `-sOutputFile="${bPath}" "${inPath}"`,
      EXEC_OPTS,
    );
    candidates.push({ bytes: readFileSync(bPath), method: "gs:/ebook" });
  } catch (e) {
    // ignore
  }

  if (candidates.length === 0) return null;
  // Tria el més petit
  candidates.sort((a, b) => a.bytes.length - b.bytes.length);
  return candidates[0];
}

// ─── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log(
    `\n📄 Optimize Airtable PDFs · ${APPLY ? "APPLY" : "DRY-RUN"} · threshold ${THRESHOLD_MB}MB · min-reduction ${MIN_REDUCTION_PCT}%\n`,
  );

  console.log(`📚 Llegint records de Documents…`);
  const records = await listAllDocuments();
  console.log(`   ${records.length} records totals\n`);

  const candidates = records
    .filter((r) => {
      if (SINGLE_RECORD && r.id !== SINGLE_RECORD) return false;
      const atts = r.fields[ATTACHMENT_FIELD_ID] as Attachment[] | undefined;
      const f = atts?.[0];
      if (!f || !f.type?.includes("pdf")) return false;
      if (!SINGLE_RECORD && f.size < THRESHOLD_MB * 1e6) return false;
      return true;
    })
    .sort((a, b) => {
      const sa = (a.fields[ATTACHMENT_FIELD_ID] as Attachment[])[0].size;
      const sb = (b.fields[ATTACHMENT_FIELD_ID] as Attachment[])[0].size;
      return sb - sa;
    })
    .slice(0, LIMIT);

  console.log(`🔍 ${candidates.length} candidats (PDF > ${THRESHOLD_MB}MB)`);

  const tmpDir = mkdtempSync(join(tmpdir(), "airtable-opt-"));
  let totalBefore = 0;
  let totalAfter = 0;
  const toApply: Array<{
    record: Record;
    bytes: Buffer;
    filename: string;
    before: number;
    after: number;
  }> = [];

  for (const r of candidates) {
    const att = (r.fields[ATTACHMENT_FIELD_ID] as Attachment[])[0];
    process.stdout.write(`  ${r.id} ${bytes(att.size).padStart(7)} → `);

    try {
      // Retry-once amb backoff 1s — les URLs signades de Airtable a vegades
      // donen "fetch failed" sota burst (potser anti-burst del CDN).
      let dl: Response | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          dl = await fetch(att.url);
          if (dl.ok) break;
          if (attempt === 0) await new Promise((r) => setTimeout(r, 1000));
        } catch (e) {
          if (attempt === 1) throw e;
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      if (!dl || !dl.ok) throw new Error(`download ${dl?.status ?? "fetch failed"}`);
      const inBuf = Buffer.from(await dl.arrayBuffer());
      const inPath = join(tmpDir, r.id + ".pdf");
      const outPath = join(tmpDir, r.id + ".opt.pdf");
      writeFileSync(inPath, inBuf);

      const best = compressBest(inPath, outPath);
      if (!best) {
        console.log(`\x1b[31mERROR\x1b[0m no compressors available`);
        continue;
      }

      const reductionPct = (1 - best.bytes.length / inBuf.length) * 100;
      totalBefore += inBuf.length;
      totalAfter += best.bytes.length;

      if (reductionPct < MIN_REDUCTION_PCT) {
        // Si totes dues fan créixer, comptem com a "no estalvi"
        totalAfter -= best.bytes.length;
        totalAfter += inBuf.length;
        console.log(
          `\x1b[90mskip\x1b[0m  best ${best.method} → ${bytes(best.bytes.length).padStart(7)} (only ${reductionPct >= 0 ? "-" : "+"}${Math.abs(reductionPct).toFixed(0)}%)`,
        );
        continue;
      }

      console.log(
        `\x1b[32m${bytes(best.bytes.length).padStart(7)}\x1b[0m  -${reductionPct.toFixed(0)}%  ${best.method}`,
      );
      toApply.push({
        record: r,
        bytes: best.bytes,
        filename: att.filename,
        before: inBuf.length,
        after: best.bytes.length,
      });
    } catch (e: any) {
      console.log(`\x1b[31mERROR\x1b[0m ${e.message?.slice(0, 80) ?? e}`);
    }
    // Pause mínima entre records — evita burst patterns que disparen el
    // anti-CDN d'Airtable (URLs signades tornen 5xx sota càrrega ràpida).
    await new Promise((r) => setTimeout(r, 300));
  }

  const totalSavedBytes = totalBefore - totalAfter;
  const totalSavedPct = totalBefore > 0 ? (totalSavedBytes / totalBefore) * 100 : 0;
  console.log(
    `\n📊 Total processat: ${bytes(totalBefore)} → ${bytes(totalAfter)}  (estalvi ${bytes(totalSavedBytes)}, -${totalSavedPct.toFixed(0)}%)`,
  );
  console.log(
    `   ${toApply.length} de ${candidates.length} amb prou estalvi per re-pujar (>${MIN_REDUCTION_PCT}%)`,
  );

  if (!APPLY) {
    console.log(`\n💡 Dry-run. Per aplicar de veritat:`);
    console.log(`   AIRTABLE_TOKEN=$AIRTABLE_TOKEN tsx scripts/optimize-airtable-pdfs.ts --apply`);
    rmSync(tmpDir, { recursive: true });
    return;
  }

  if (toApply.length === 0) {
    console.log(`\n✨ Res a aplicar.`);
    rmSync(tmpDir, { recursive: true });
    return;
  }

  console.log(`\n📤 Aplicant ${toApply.length} substitucions…`);
  let applied = 0;
  let failed = 0;
  for (const t of toApply) {
    process.stdout.write(`  ${t.record.id} `);
    try {
      // Patró Worker existent: clear field + upload nou. uploadAttachment
      // afegiria al camp; per sobreescriure cal el clear primer.
      await clearAttachmentField(t.record.id);
      await uploadAttachment(t.record.id, t.filename, t.bytes);
      console.log(`\x1b[32m✅\x1b[0m  ${bytes(t.before)} → ${bytes(t.after)}`);
      applied++;
    } catch (e: any) {
      console.log(`\x1b[31m❌\x1b[0m ${e.message?.slice(0, 100) ?? e}`);
      failed++;
    }
    // Pause to respect Airtable's 5 req/sec per-base limit (each substitution
    // takes 2 calls — clear + upload — so 250ms = ~4 ops/sec is safe).
    await new Promise((r) => setTimeout(r, 250));
  }

  rmSync(tmpDir, { recursive: true });
  console.log(`\n✨ Aplicat: ${applied} OK · ${failed} errors`);
}

main().catch((e) => {
  console.error("\n💥", e);
  process.exit(1);
});
