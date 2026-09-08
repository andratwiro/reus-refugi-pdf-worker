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
 *   --target-mb=5        Si la compressió no hi entra, escala density/quality
 *                        fins baixar-hi (default 5MB — marge sota els 6MB
 *                        de Mercurio)
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
// Objectiu de mida: si la 1a passada de compressió no hi entra, s'escala a
// density/quality més baixos fins a aconseguir-ho. 5MB deixa marge sota el
// límit de 6MB/fitxer de Mercurio.
const TARGET_MB = parseFloat(argVal("target-mb", "5"));

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

async function uploadAttachment(
  recordId: string,
  filename: string,
  contentType: string,
  bytes: Buffer,
): Promise<string> {
  // Endpoint dedicat per a binari. NO és api.airtable.com sino content.*.
  const url = `https://content.airtable.com/v0/${BASE_ID}/${recordId}/${ATTACHMENT_FIELD_ID}/uploadAttachment`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contentType,
      file: bytes.toString("base64"),
      filename,
    }),
  });
  if (!resp.ok) {
    throw new Error(`uploadAttachment ${resp.status}: ${await resp.text()}`);
  }
  // La resposta porta el record sencer; l'adjunt nou és l'últim del camp.
  const data = await resp.json();
  const list = (data?.fields?.[ATTACHMENT_FIELD_ID] as Attachment[] | undefined) ?? [];
  const added = list[list.length - 1]?.id;
  if (!added) throw new Error(`uploadAttachment: resposta sense id d'adjunt`);
  return added;
}

/** Deixa al camp NOMÉS els adjunts indicats (per id), en aquest ordre. */
async function keepOnlyAttachments(recordId: string, ids: string[]): Promise<void> {
  await airtable("PATCH", `/${BASE_ID}/${TABLE_ID}/${recordId}`, {
    fields: { [ATTACHMENT_FIELD_ID]: ids.map((id) => ({ id })) },
  });
}

/**
 * Compta pàgines d'un PDF amb ghostscript. Retorna -1 si no es pot llegir.
 */
function pdfPageCount(path: string): number {
  try {
    const out = execSync(
      `gs -q -dNODISPLAY -dNOSAFER -c "(${path}) (r) file runpdfbegin pdfpagecount = quit"`,
      { stdio: "pipe", timeout: 60_000 },
    ).toString().trim();
    const n = parseInt(out.split(/\s+/).pop() ?? "", 10);
    return Number.isFinite(n) ? n : -1;
  } catch {
    return -1;
  }
}

/**
 * Cobertura de tinta per pàgina (% C+M+Y+K, renderitzat a 20dpi amb el
 * device `ink_cov` de gs). 0 = pàgina totalment blanca. Retorna null si gs
 * no pot renderitzar el fitxer.
 */
function pageInk(path: string): number[] | null {
  try {
    const out = execSync(`gs -q -o - -sDEVICE=ink_cov -r20 "${path}"`, {
      stdio: "pipe",
      timeout: 120_000,
    }).toString();
    const rows = out
      .split("\n")
      .filter((l) => /CMYK OK\s*$/.test(l))
      .map((l) => l.trim().split(/\s+/).slice(0, 4).reduce((a, v) => a + parseFloat(v), 0));
    return rows.length > 0 ? rows : null;
  } catch {
    return null;
  }
}

// Llindars de la guarda anti-pàgines-en-blanc. Incident 2026-05: gs va
// produir PDFs d'1 pàgina BUIDA (2202 bytes) per a dos documents (passaport
// + proves de permanència) i el script els va pujar perquè eren la variant
// "més petita". Una pàgina buida de gs pesa ~2.2KB; una pàgina escanejada
// real, fins i tot a 72dpi/q35, pesa >15KB.
const MIN_BYTES_PER_PAGE = 5000;
// Una pàgina de l'original amb més d'aquest % de tinta que a la sortida
// queda per sota de BLANK_INK_PCT s'ha perdut → rebutgem la variant.
const CONTENT_INK_PCT = 0.2;
const BLANK_INK_PCT = 0.02;

/**
 * Comprova que la versió comprimida és plausible abans de substituir
 * l'original: mateix nombre de pàgines, mida mínima per pàgina i cap pàgina
 * que tingués contingut a l'original i surti en blanc.
 * Retorna null si és acceptable, o el motiu del rebuig.
 */
function rejectReason(
  inPages: number,
  inInk: number[] | null,
  outPath: string,
  outBytes: number,
): string | null {
  const outPages = pdfPageCount(outPath);
  if (outPages < 1) return `sortida il·legible (${outPages} pàgines)`;
  if (inPages > 0 && outPages !== inPages) return `pàgines ${inPages} → ${outPages}`;
  if (outBytes / outPages < MIN_BYTES_PER_PAGE)
    return `${bytes(outBytes)} per ${outPages} pàg. (< ${MIN_BYTES_PER_PAGE}B/pàg — probablement en blanc)`;
  const outInk = pageInk(outPath);
  if (!outInk) return `no es pot renderitzar la sortida`;
  if (inInk) {
    for (let i = 0; i < Math.min(inInk.length, outInk.length); i++) {
      if (inInk[i] > CONTENT_INK_PCT && outInk[i] < BLANK_INK_PCT)
        return `pàgina ${i + 1} surt en blanc (tinta ${inInk[i].toFixed(2)}% → ${outInk[i].toFixed(3)}%)`;
    }
  }
  return null;
}

/**
 * Comprimeix un PDF i retorna la variant més petita. Dues estratègies:
 *
 *  A) ImageMagick rasteritzat — ESCALAT. Comença suau (120dpi/q60) i, si el
 *     resultat encara passa de `targetBytes`, baixa density+quality per
 *     nivells (100/q50 → 90/q42 → 72/q35) fins que hi entri o s'esgotin.
 *     Brutal per a scans 300dpi (passaports típics: 25MB→2.9MB).
 *
 *  B) Ghostscript /ebook — conserva text vectorial, comprimeix imatges.
 *     Útil per PDFs híbrids (text + scan). Estalvi modest (10-30%).
 *
 * Es retorna la variant més petita de totes les provades; null si cap
 * compressor ha funcionat.
 */
function compressBest(
  inPath: string,
  baseOutPath: string,
  targetBytes: number,
): { bytes: Buffer; method: string } | null {
  const candidates: Array<{ bytes: Buffer; method: string; path: string }> = [];

  // Timeout generós — escanejos molt grans (50MB+) amb diverses passades de
  // magick poden trigar. El workflow té timeout-minutes:15 de marge.
  const EXEC_OPTS = { stdio: "pipe" as const, timeout: 120_000, killSignal: "SIGKILL" as const };

  const smallest = () =>
    candidates.reduce((a, b) => (b.bytes.length < a.bytes.length ? b : a));

  // B) Ghostscript /ebook
  try {
    const bPath = baseOutPath + ".gs.pdf";
    // -dPDFSTOPONERROR: si el PDF té errors, gs ha de FALLAR, no continuar
    // en silenci i escriure pàgines a mitges o buides.
    execSync(
      `gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/ebook ` +
        `-dNOPAUSE -dBATCH -dQUIET -dPDFSTOPONERROR -dDetectDuplicateImages=true ` +
        `-sOutputFile="${bPath}" "${inPath}"`,
      EXEC_OPTS,
    );
    candidates.push({ bytes: readFileSync(bPath), method: "gs:/ebook", path: bPath });
  } catch (e: any) {
    const err = (e?.stderr?.toString() ?? e?.message ?? "").trim().split("\n").slice(-2).join(" | ");
    console.log(`\x1b[90m      gs ha fallat: ${err.slice(0, 120)}\x1b[0m`);
  }

  // A) ImageMagick rasteritzat, escalat. Parem tan bon punt una variant
  // entra dins el target — no cal degradar més la qualitat del necessari.
  if (MAGICK_CMD) {
    const TIERS: Array<[number, number]> = [[120, 60], [100, 50], [90, 42], [72, 35]];
    for (const [density, quality] of TIERS) {
      try {
        const aPath = `${baseOutPath}.magick-${density}-${quality}.pdf`;
        execSync(
          `${MAGICK_CMD} -density ${density} "${inPath}" -compress jpeg -quality ${quality} "${aPath}"`,
          EXEC_OPTS,
        );
        candidates.push({ bytes: readFileSync(aPath), method: `${MAGICK_CMD}:${density}dpi/q${quality}`, path: aPath });
      } catch (e) {
        // Pot fallar per policy.xml d'Ubuntu (PDF blocked per CVE 2018) o PDFs corruptes.
      }
      if (candidates.length > 0 && smallest().bytes.length <= targetBytes) break;
    }
  }

  // Guarda de seguretat: descartem qualsevol variant sospitosa (pàgines
  // perdudes o en blanc) ABANS de triar la més petita. Incident 2026-05:
  // gs va tornar 1 pàgina buida (2202 bytes) per a dos documents i, sent
  // la variant "més petita", es va pujar a Airtable substituint l'original.
  const inPages = pdfPageCount(inPath);
  const inInk = pageInk(inPath);
  // Si gs no pot renderitzar l'original (o el veu tot blanc), CAP variant
  // derivada de gs/magick és fiable — magick també delega en gs per a PDF.
  if (!inInk || inInk.every((v) => v < BLANK_INK_PCT)) {
    console.log(`\x1b[33m      gs no renderitza l'original (${inInk ? "tot en blanc" : "error"}) — mantenim original\x1b[0m`);
    return null;
  }
  const valid = candidates.filter((c) => {
    const reason = rejectReason(inPages, inInk, c.path, c.bytes.length);
    if (reason) console.log(`\x1b[33m      rebutjat ${c.method}: ${reason}\x1b[0m`);
    return !reason;
  });
  if (valid.length === 0) return null;
  valid.sort((a, b) => a.bytes.length - b.bytes.length);
  return valid[0];
}


// ─── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log(
    `\n📄 Optimize Airtable PDFs · ${APPLY ? "APPLY" : "DRY-RUN"} · threshold ${THRESHOLD_MB}MB · target ${TARGET_MB}MB · min-reduction ${MIN_REDUCTION_PCT}%\n`,
  );

  console.log(`📚 Llegint records de Documents…`);
  const records = await listAllDocuments();
  console.log(`   ${records.length} records totals\n`);

  // Mida total dels PDFs adjunts d'un record (per filtrar i ordenar). Per
  // a multi-attachment, Mercurio acaba rebent un PDF fusionat de tots →
  // la mida que importa és la suma, no la del primer adjunt.
  const pdfTotal = (r: Record): number => {
    const atts = (r.fields[ATTACHMENT_FIELD_ID] as Attachment[]) ?? [];
    return atts.filter((a) => a.type?.includes("pdf")).reduce((s, a) => s + a.size, 0);
  };

  const candidates = records
    .filter((r) => {
      if (SINGLE_RECORD) return r.id === SINGLE_RECORD;
      return pdfTotal(r) > THRESHOLD_MB * 1e6;
    })
    .sort((a, b) => pdfTotal(b) - pdfTotal(a))
    .slice(0, LIMIT);

  console.log(`🔍 ${candidates.length} candidats (PDF total > ${THRESHOLD_MB}MB)`);

  const tmpDir = mkdtempSync(join(tmpdir(), "airtable-opt-"));
  let totalBefore = 0;
  let totalAfter = 0;
  interface Upload { bytes: Buffer; filename: string; contentType: string; method: string }
  const toApply: Array<{
    record: Record;
    uploads: Upload[];
    before: number;
    after: number;
  }> = [];

  for (const r of candidates) {
    const atts = (r.fields[ATTACHMENT_FIELD_ID] as Attachment[]) ?? [];
    const recBefore = atts.reduce((s, a) => s + a.size, 0);
    const label = atts.length === 1 ? "1 fitxer" : `${atts.length} fitxers`;
    process.stdout.write(`  ${r.id} (${label}) ${bytes(recBefore).padStart(7)} → `);

    const uploads: Upload[] = [];
    let recAfter = 0;
    let anyCompressed = false;
    let recordFailed = false;
    const perFileLog: string[] = [];

    for (let i = 0; i < atts.length; i++) {
      const att = atts[i];
      // Download amb retry — URLs signades d'Airtable poden 5xx sota burst.
      let inBuf: Buffer;
      try {
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
        inBuf = Buffer.from(await dl.arrayBuffer());
      } catch (e: any) {
        // Si fallem a descarregar QUALSEVOL adjunt, abortem el record
        // sencer — millor no aplicar res que substituir parcialment.
        console.log(`\x1b[31mERROR\x1b[0m descàrrega ${att.filename}: ${e.message?.slice(0, 60) ?? e}`);
        recordFailed = true;
        break;
      }

      const isPdf = att.type?.includes("pdf");
      const contentType = att.type ?? "application/octet-stream";

      // No-PDF o PDF petit: mantenim l'original tal qual.
      if (!isPdf || inBuf.length < THRESHOLD_MB * 1e6) {
        uploads.push({ bytes: inBuf, filename: att.filename, contentType, method: "kept" });
        recAfter += inBuf.length;
        continue;
      }

      // Comprimim aquest PDF.
      const inPath = join(tmpDir, `${r.id}-${i}.pdf`);
      const outPath = join(tmpDir, `${r.id}-${i}.opt`);
      writeFileSync(inPath, inBuf);
      const best = compressBest(inPath, outPath, TARGET_MB * 1e6);

      if (!best) {
        uploads.push({ bytes: inBuf, filename: att.filename, contentType: "application/pdf", method: "no-compressor" });
        recAfter += inBuf.length;
        continue;
      }

      const reductionPct = (1 - best.bytes.length / inBuf.length) * 100;
      if (reductionPct < MIN_REDUCTION_PCT) {
        // Estalvi insuficient en aquest fitxer — mantenim original.
        uploads.push({ bytes: inBuf, filename: att.filename, contentType: "application/pdf", method: `kept (-${reductionPct.toFixed(0)}%)` });
        recAfter += inBuf.length;
      } else {
        uploads.push({ bytes: best.bytes, filename: att.filename, contentType: "application/pdf", method: best.method });
        recAfter += best.bytes.length;
        anyCompressed = true;
        perFileLog.push(`      ${att.filename}: ${bytes(inBuf.length)} → ${bytes(best.bytes.length)}  -${reductionPct.toFixed(0)}%  ${best.method}`);
      }
    }

    if (recordFailed) continue;

    totalBefore += recBefore;
    totalAfter += recAfter;

    if (!anyCompressed) {
      console.log(`\x1b[90mskip\x1b[0m  cap fitxer amb prou estalvi`);
      continue;
    }

    const recReductionPct = (1 - recAfter / recBefore) * 100;
    const overTarget = recAfter > TARGET_MB * 1e6;
    console.log(
      `\x1b[32m${bytes(recAfter).padStart(7)}\x1b[0m  -${recReductionPct.toFixed(0)}%` +
        (overTarget ? `  \x1b[33m⚠ encara > ${TARGET_MB}MB\x1b[0m` : ""),
    );
    if (atts.length > 1) for (const ln of perFileLog) console.log(ln);
    toApply.push({ record: r, uploads, before: recBefore, after: recAfter });

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
    const label = t.uploads.length === 1 ? "1 fitxer" : `${t.uploads.length} fitxers`;
    process.stdout.write(`  ${t.record.id} (${label}) `);
    // MAI esborrem l'original abans de tenir la versió nova pujada: primer
    // pugem els N adjunts (s'afegeixen al camp), i només si TOTS han pujat
    // deixem al camp els nous. Si alguna pujada falla, retirem els nous
    // pujats a mitges i l'original queda intacte.
    const oldIds = ((t.record.fields[ATTACHMENT_FIELD_ID] as Attachment[]) ?? []).map((a) => a.id);
    const newIds: string[] = [];
    try {
      for (const u of t.uploads) {
        newIds.push(await uploadAttachment(t.record.id, u.filename, u.contentType, u.bytes));
        // Pause to respect Airtable's 5 req/sec per-base limit.
        await new Promise((r) => setTimeout(r, 250));
      }
      await keepOnlyAttachments(t.record.id, newIds);
      console.log(`\x1b[32m✅\x1b[0m  ${bytes(t.before)} → ${bytes(t.after)}`);
      applied++;
    } catch (e: any) {
      console.log(`\x1b[31m❌\x1b[0m ${e.message?.slice(0, 100) ?? e}`);
      failed++;
      if (newIds.length > 0) {
        try {
          await keepOnlyAttachments(t.record.id, oldIds);
          console.log(`     revertit: original intacte (${oldIds.length} adjunts)`);
        } catch (e2: any) {
          console.log(`     ⚠ no s'ha pogut netejar els adjunts parcials: ${e2.message?.slice(0, 80)}`);
        }
      }
    }
  }

  rmSync(tmpDir, { recursive: true });
  console.log(`\n✨ Aplicat: ${applied} OK · ${failed} errors`);
}

main().catch((e) => {
  console.error("\n💥", e);
  process.exit(1);
});
