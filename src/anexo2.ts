/**
 * Fill the Anexo II — Modelo de certificado de vulnerabilidad PDF.
 *
 * Plantilla: assets/A2_certificado_vulnerabilidad.pdf
 *   Aquest és el PDF buit oficial del Ministeri (descarregat directament
 *   d'inclusion.gob.es). NO té camps AcroForm — és un PDF estàtic generat
 *   des d'un Word document. Pintem totes les dades a coordenades absolutes
 *   definides a `anexo2-coords.ts` (extretes una vegada del PDF fillable
 *   amb scripts/extract-anexo2-coords.ts).
 *
 *   El template no conté cap dada específica de Reus Refugi (segell, NIF,
 *   adreça, etc.). Tot ve injectat a runtime des d'`EntitatConfig` (mappings.ts
 *   + env secrets) i dels binaris privats a src/private/*.png.
 *
 * Camps que pintem:
 *   §1 Entitat — Texto145 (nom), 146 (NIF), 147 (RECEX), 148 (domicili),
 *      149 (telèfon/email), Casilla 52 o 53 segons E.tipusEntitat.
 *   §2 Sol·licitant — Texto150 (nom), 151 (numDoc), 152 (data naixement),
 *      153 (nacionalitat), 154 (domicili), 155 (telèfon), 156 (localitat),
 *      157 (CP), 158 (província).
 *   §3 Vulnerabilitat — Casillas 54-64 segons multipleSelect d'Airtable;
 *      Texto159 + Casilla 65 si "altres factors" té contingut.
 *   §4 Data — Texto161 amb la data d'avui (Europe/Madrid).
 *   §5 Signatura — al rect "Signature" de page 2 dibuixem el segell de
 *      l'entitat + la firma del representant (PNG opcionals; si no
 *      existeixen, s'omet sense fallar).
 */

import {
  PDFDocument,
  StandardFonts,
  rgb,
} from "pdf-lib";
import {
  ANEXO2_COORDS,
  type AnexoIIWidgetCoord,
} from "./anexo2-coords";
import {
  ANEXO2_AIRTABLE_FIELDS as A,
  ANEXO2_PDF_FIELDS as P,
  ANEXO2_TIPUS_ENTITAT_CASILLA,
  ANEXO2_OTROS_CASILLA,
  VULNERABILITAT_CASILLA,
  type EntitatConfig,
} from "./mappings";

type AirtableRecordLike = { id: string; fields: Record<string, unknown> };

export interface FillAnexo2Options {
  entitat: EntitatConfig;
  /**
   * PNG bytes del segell de l'entitat. A producció vénen empotrats al bundle
   * del worker via `[[rules]] type="Data"` (vegeu wrangler.toml + index.ts).
   * Si null/undefined, no es pinta segell — el certificat surt sense rúbrica.
   */
  entityStampPng?: ArrayBuffer | Uint8Array | null;
  /**
   * PNG bytes de la firma manuscrita del representant legal. Mateix mecanisme
   * que entityStampPng. Si null/undefined, no es pinta firma.
   */
  representativeSignaturePng?: ArrayBuffer | Uint8Array | null;
}

const FONT_SIZE = 10;
const SIGNATURE_KEY = "Signature";

export async function fillAnexo2Pdf(
  templateBytes: ArrayBuffer,
  record: AirtableRecordLike,
  options: FillAnexo2Options,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(templateBytes);
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pages = pdfDoc.getPages();
  const f = record.fields;
  const E = options.entitat;

  // Les coordenades vénen del PDF original de Reus Refugi (que tenia widgets
  // AcroForm — rectangles que cobrien la línia "_______" del template).
  // Sense els rectangles, els nostres dibuixos col·loquen el text damunt de
  // la línia, no per sobre. Pujar 3-4 punts compensa això i deixa el text
  // assentat just per damunt de la línia underscored, com es renderitza un
  // PDF governamental imprès.
  const TEXT_BASELINE_OFFSET = 5;

  const drawTextAt = (key: string, value: string): void => {
    if (!value) return;
    const c = ANEXO2_COORDS[key];
    if (!c || c.type !== "text") return;
    const page = pages[c.page];
    if (!page) return;
    page.drawText(value, {
      x: c.x + 3,
      y: c.y + TEXT_BASELINE_OFFSET,
      size: FONT_SIZE,
      font: helvetica,
      color: rgb(0, 0, 0),
      maxWidth: c.w - 6,
    });
  };

  const drawCheckAt = (key: string): void => {
    const c = ANEXO2_COORDS[key];
    if (!c || c.type !== "check") return;
    const page = pages[c.page];
    if (!page) return;
    // El glyph "X" d'Helvetica Bold a una mida igual a l'alçada del box queda
    // visualment ben centrat amb aquests offsets — calibrats pel PDF generat
    // a producció. Amplada/alçada del rect dels checkboxes ronda 6.3 × 7.7 pt.
    const size = Math.max(c.w, c.h) + 2;
    page.drawText("X", {
      x: c.x + c.w / 2 - size * 0.27,
      y: c.y + c.h / 2 - size * 0.32,
      size,
      font: helveticaBold,
      color: rgb(0, 0, 0),
    });
  };

  // ── §1 Entitat ─────────────────────────────────────────────────────────
  drawTextAt(P.entitatNom, E.nom);
  drawTextAt(P.entitatNif, E.nif);
  drawTextAt(P.entitatRecex, E.recexNum);
  drawTextAt(P.entitatDomicili, composeAddressOneLine(E));
  drawTextAt(
    P.entitatTelEmail,
    [E.telefon, E.email].filter((s) => s && s.trim()).join(" / "),
  );
  drawCheckAt(ANEXO2_TIPUS_ENTITAT_CASILLA[E.tipusEntitat]);

  // ── §2 Sol·licitant ────────────────────────────────────────────────────
  drawTextAt(P.nom, strOf(f[A.nom]));
  drawTextAt(P.numDoc, strOf(f[A.numDoc]));
  drawTextAt(P.dataNaixement, formatIsoDate(f[A.dataNaixement]));
  drawTextAt(P.nacionalitat, strOf(f[A.nacionalitat]));
  drawTextAt(P.domicili, strOf(f[A.domicili]));
  drawTextAt(P.telefon, strOf(f[A.telefon]));
  drawTextAt(P.localitat, strOf(f[A.localitat]));
  drawTextAt(P.cp, strOf(f[A.cp]));
  drawTextAt(P.provincia, strOf(f[A.provincia]));

  // ── §3 Circumstàncies de vulnerabilitat ────────────────────────────────
  const factors = f[A.factors];
  if (Array.isArray(factors)) {
    for (const raw of factors) {
      const key =
        typeof raw === "string"
          ? raw
          : typeof raw === "object" && raw !== null
            ? "id" in raw && typeof (raw as { id: unknown }).id === "string"
              ? (raw as { id: string }).id
              : "name" in raw &&
                  typeof (raw as { name: unknown }).name === "string"
                ? (raw as { name: string }).name
                : ""
            : "";
      if (!key) continue;
      const casilla = VULNERABILITAT_CASILLA[key];
      if (casilla) drawCheckAt(casilla);
    }
  }

  const altresFactors = A.altresFactors ? strOf(f[A.altresFactors]).trim() : "";
  if (altresFactors) {
    drawTextAt(P.altresFactors, altresFactors);
    drawCheckAt(ANEXO2_OTROS_CASILLA);
  }

  // ── §4 Data ────────────────────────────────────────────────────────────
  drawTextAt(P.dataAvui, todayInMadrid());

  // ── §5 Signatura ───────────────────────────────────────────────────────
  // El widget "Signature" del PDF original era un signature field; aquí no
  // tenim AcroForm però utilitzem les seves coordenades com a centre de la
  // zona on s'estampa el segell + la firma del representant.
  const sigBox = ANEXO2_COORDS[SIGNATURE_KEY];
  if (sigBox) {
    await drawStampAndSignature(
      pdfDoc,
      pages[sigBox.page],
      sigBox,
      options.entityStampPng,
      options.representativeSignaturePng,
    );
  }

  return await pdfDoc.save();
}

// ─────────────────────────────────────────────────────────────────────────────
//  Sub-helpers
// ─────────────────────────────────────────────────────────────────────────────

async function drawStampAndSignature(
  pdfDoc: PDFDocument,
  page: ReturnType<PDFDocument["getPages"]>[number],
  box: AnexoIIWidgetCoord,
  stampBytes: ArrayBuffer | Uint8Array | null | undefined,
  signatureBytes: ArrayBuffer | Uint8Array | null | undefined,
): Promise<void> {
  // Stamp: dibuixat a l'esquerra del box, ample ~150pt (proporcional). El
  // segell visual normalment ocupa més espai del que la zona Signature té,
  // així que hi posem un offset negatiu en X i el centrem verticalment al
  // box.
  if (stampBytes && byteLength(stampBytes) > 0) {
    const stamp = await pdfDoc.embedPng(toUint8(stampBytes));
    const stampW = 150;
    const stampH = stampW * (stamp.height / stamp.width);
    page.drawImage(stamp, {
      x: box.x - 80,
      y: box.y + (box.h - stampH) / 2,
      width: stampW,
      height: stampH,
    });
  }

  // Signature: dibuixada a sobre / al costat dret del segell, dins el box
  // amb una mica de bleed.
  if (signatureBytes && byteLength(signatureBytes) > 0) {
    const sig = await pdfDoc.embedPng(toUint8(signatureBytes));
    const sigW = box.w + 20;
    const sigH = sigW * (sig.height / sig.width);
    page.drawImage(sig, {
      x: box.x - 5,
      y: box.y + (box.h - sigH) / 2,
      width: sigW,
      height: sigH,
    });
  }
}

function byteLength(b: ArrayBuffer | Uint8Array): number {
  return b instanceof Uint8Array ? b.byteLength : b.byteLength;
}

function toUint8(b: ArrayBuffer | Uint8Array): Uint8Array {
  return b instanceof Uint8Array ? b : new Uint8Array(b);
}

function composeAddressOneLine(E: EntitatConfig): string {
  return [
    `${E.domiciliCarrer} ${E.domiciliNum}`.trim(),
    E.domiciliPis,
    E.localitat,
    E.cp,
    E.provincia,
  ]
    .filter((s) => s && s.trim().length > 0)
    .join(", ");
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function strOf(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object" && v !== null && "name" in (v as object)) {
    return String((v as { name: unknown }).name || "");
  }
  return "";
}

/** "2026-04-25" o "2026-04-25T00:00:00.000Z" → "25/04/2026". */
function formatIsoDate(v: unknown): string {
  const s = typeof v === "string" ? v : "";
  const match = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return "";
  return `${match[3]}/${match[2]}/${match[1]}`;
}

/** Today in Europe/Madrid as "DD/MM/YYYY". */
function todayInMadrid(): string {
  const formatter = new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  return formatter.format(new Date());
}

/** Build a filesystem-safe filename from the applicant name. */
export function anexo2Filename(record: AirtableRecordLike): string {
  const nom = strOf(record.fields[A.nom]);
  const safe = nom
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "_");
  const base = safe || record.id;
  return `A2_${base}.pdf`;
}
