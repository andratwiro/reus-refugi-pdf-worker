/**
 * Fill the Anexo II — Modelo de certificado de vulnerabilidad (EX-32) PDF.
 *
 * Plantilla: assets/A2_certificado_vulnerabilidad.pdf
 *   - Ja ve amb dades d'entitat (Texto145-149), segell visual i Casilla 53
 *     (Tercer Sector) marcada. Aquestes les redibuixem manualment a partir
 *     del /V del template — Strategy A no manté l'AcroForm.
 *   - Camps a omplir del sol·licitant: Texto150-158.
 *   - Altres factors (text lliure): Texto159.
 *   - Data d'emissió (avui): Texto161.
 *   - Casillas 54-64: factors de vulnerabilitat (11 opcions, 1:1 amb multipleSelect).
 *   - Casilla 65: es marca automàticament si "Altres factors" té contingut.
 *   - Texto162-164 (DIR3): ja estan al /Fm1 / page content del template, no toquem.
 *
 * Renderitzat universal — Strategy A (ple flatten manual):
 *
 * Iteracions prèvies (vegeu commit history 2026-04-27):
 *   1. NeedAppearances=false → Chrome/Firefox/Drive no mostraven Casillas
 *      marcades.
 *   2. form.flatten() amb /P rebuild → flatten produeix XObjects malformats
 *      i regenera appearances en posicions errònies.
 *   3. Bypass flatten + manual draw + delete /AP + remove from /Annots →
 *      pdf-lib's save() amb updateFieldAppearances:true (per defecte) DUPLICA
 *      cada widget tocat: una còpia al /AcroForm /Fields amb la nostra /V i
 *      /F=2 (Hidden), una altra còpia al page /Annots amb /AP regenerat i
 *      /V buit. Adobe/Preview llegeixen /Fields i veuen /F=2 → no renderitzen
 *      el widget → només la nostra drawText es veu (correcte). Chrome/Firefox/
 *      Drive/Samsung llegeixen /Annots i renderitzen el /AP regenerat A SOBRE
 *      de la nostra drawText → text doble.
 *
 * Strategy A: ELIMINEM l'AcroForm completament del PDF resultant. El document
 * passa a ser purament estàtic (no editable), idèntic per a tots els visors:
 *
 *   1. Llegim els widget annotations DIRECTAMENT del /Annots de cada pàgina
 *      (bypass form.getFields() — pdf-lib clona els dicts per a la seva
 *      representació interna del form, fent que widget.dict no coincideixi
 *      amb el dict que viu al /Annots de la pàgina; per això havia fallat
 *      la resolució de pàgina al codi previ).
 *   2. Per a cada widget de tipus /Tx amb valor (record-provided OR /V del
 *      template), drawText al rect del widget a la pàgina correcta.
 *   3. Per a cada checkbox amb /AS=/Yes (record OR template prechecked),
 *      drawRectangle ple ~120% del rect (overpinta el frame buit que ve
 *      a /Fm1 page 1, o al page content stream a page 2).
 *   4. Eliminem /AcroForm del catalog i buidem /Annots de cada pàgina.
 *   5. save({ updateFieldAppearances: false }) — no hi ha res a regenerar.
 *
 * Trade-off: PDF no editable post-generació. Doble win:
 *   - Renderitza idèntic a tot arreu.
 *   - El destinatari no pot editar el certificat (signat).
 */

import {
  PDFDocument,
  PDFName,
  PDFArray,
  PDFDict,
  PDFRef,
  PDFString,
  PDFHexString,
  PDFNumber,
  StandardFonts,
  rgb,
} from "pdf-lib";
import {
  ANEXO2_AIRTABLE_FIELDS as A,
  ANEXO2_PDF_FIELDS as P,
  VULNERABILITAT_CASILLA,
  ANEXO2_OTROS_CASILLA,
} from "./mappings";

type AirtableRecordLike = { id: string; fields: Record<string, unknown> };

interface WidgetInfo {
  pageIndex: number;
  name: string;
  type: "text" | "check" | "other";
  rect: { x: number; y: number; w: number; h: number };
  templateValue: string; // /V on the template (text content, or /Yes / /Off for checkboxes)
}

const FONT_SIZE = 10;

export async function fillAnexo2Pdf(
  templateBytes: ArrayBuffer,
  record: AirtableRecordLike,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(templateBytes);
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const f = record.fields;

  // Sobreescriptures del registre (Airtable). Si no hi ha valor, el text
  // pre-omplert al template preval (per a Texto145-149 entitat, Texto158
  // "Tarragona", etc.).
  const textOverrides = new Map<string, string>();
  const checkOverrides = new Set<string>();

  const setText = (name: string, value: string): void => {
    if (value) textOverrides.set(name, value);
  };

  // Secció 2 — Dades del sol·licitant
  setText(P.nom, strOf(f[A.nom]));
  setText(P.numDoc, strOf(f[A.numDoc]));
  setText(P.dataNaixement, formatIsoDate(f[A.dataNaixement]));
  setText(P.nacionalitat, strOf(f[A.nacionalitat]));
  setText(P.domicili, strOf(f[A.domicili]));
  setText(P.telefon, strOf(f[A.telefon]));
  setText(P.localitat, strOf(f[A.localitat]));
  setText(P.cp, strOf(f[A.cp]));
  setText(P.provincia, strOf(f[A.provincia]));

  // Secció 3 — Circumstàncies de vulnerabilitat
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
      if (casilla) checkOverrides.add(casilla);
    }
  }

  const altresFactors = A.altresFactors ? strOf(f[A.altresFactors]).trim() : "";
  if (altresFactors) {
    setText(P.altresFactors, altresFactors);
    checkOverrides.add(ANEXO2_OTROS_CASILLA);
  }

  // Data
  setText(P.dataAvui, todayInMadrid());

  // ── Recórrer els widget annotations directament des de /Annots ──────────
  const widgets = collectWidgets(pdfDoc);
  const pages = pdfDoc.getPages();

  for (const w of widgets) {
    const page = pages[w.pageIndex];
    if (!page) continue;
    if (w.type === "text") {
      const value = textOverrides.get(w.name) ?? w.templateValue;
      if (!value) continue;
      page.drawText(value, {
        x: w.rect.x + 3,
        y: w.rect.y + (w.rect.h - FONT_SIZE) / 2 + 1,
        size: FONT_SIZE,
        font: helvetica,
        color: rgb(0, 0, 0),
        maxWidth: w.rect.w - 6,
      });
    } else if (w.type === "check") {
      const checked =
        checkOverrides.has(w.name) || w.templateValue === "Yes";
      if (!checked) continue;
      // Marca ~120% del rect — el frame buit ve dibuixat a /Fm1 (page 1)
      // o al page content stream (page 2) i té fill blanc; sense
      // l'expansió, el blanc tapa la nostra marca.
      const padX = w.rect.w * 0.1;
      const padY = w.rect.h * 0.1;
      page.drawRectangle({
        x: w.rect.x - padX,
        y: w.rect.y - padY,
        width: w.rect.w + padX * 2,
        height: w.rect.h + padY * 2,
        color: rgb(0, 0, 0),
      });
    }
  }

  // ── Eliminar AcroForm + tots els widget annotations ─────────────────────
  // Fa el PDF estàtic i no editable. Cap visor pot rederitzar /AP que ja no
  // existeix; només el contingut estàtic de la pàgina + les nostres draws.
  pdfDoc.catalog.delete(PDFName.of("AcroForm"));
  for (const page of pages) {
    page.node.set(PDFName.of("Annots"), pdfDoc.context.obj([]));
  }

  return await pdfDoc.save({ updateFieldAppearances: false });
}

/**
 * Recorre el /Annots de cada pàgina i extreu els widget annotations en
 * brut (sense passar per la representació de form de pdf-lib, que clona
 * dicts i ens trenca la correspondència widget↔pàgina).
 */
function collectWidgets(pdfDoc: PDFDocument): WidgetInfo[] {
  const out: WidgetInfo[] = [];
  const pages = pdfDoc.getPages();

  for (let i = 0; i < pages.length; i++) {
    const annots = pages[i].node.lookup(PDFName.of("Annots"));
    if (!(annots instanceof PDFArray)) continue;
    for (let k = 0; k < annots.size(); k++) {
      const item = annots.get(k);
      const dict = item instanceof PDFRef ? pdfDoc.context.lookup(item) : item;
      if (!(dict instanceof PDFDict)) continue;
      const subtype = dict.lookup(PDFName.of("Subtype"));
      if (!(subtype instanceof PDFName) || subtype.asString() !== "/Widget") {
        continue;
      }

      const name = decodePdfString(dict.lookup(PDFName.of("T")));
      if (!name) continue;

      const rectArr = dict.lookup(PDFName.of("Rect"));
      if (!(rectArr instanceof PDFArray) || rectArr.size() < 4) continue;
      const r0 = numFrom(rectArr.get(0));
      const r1 = numFrom(rectArr.get(1));
      const r2 = numFrom(rectArr.get(2));
      const r3 = numFrom(rectArr.get(3));
      if (r0 === null || r1 === null || r2 === null || r3 === null) continue;
      const rect = {
        x: Math.min(r0, r2),
        y: Math.min(r1, r3),
        w: Math.abs(r2 - r0),
        h: Math.abs(r3 - r1),
      };

      const ft = dict.lookup(PDFName.of("FT"));
      const ftStr = ft instanceof PDFName ? ft.asString() : "";
      let type: WidgetInfo["type"] = "other";
      let templateValue = "";
      const vEntry = dict.lookup(PDFName.of("V"));
      if (ftStr === "/Tx") {
        type = "text";
        templateValue = decodePdfString(vEntry);
      } else if (ftStr === "/Btn") {
        type = "check";
        if (vEntry instanceof PDFName) {
          templateValue = vEntry.asString() === "/Yes" ? "Yes" : "Off";
        } else {
          templateValue = "Off";
        }
      }

      out.push({ pageIndex: i, name, type, rect, templateValue });
    }
  }
  return out;
}

function decodePdfString(v: unknown): string {
  if (v instanceof PDFString) return v.decodeText();
  if (v instanceof PDFHexString) return v.decodeText();
  return "";
}

function numFrom(v: unknown): number | null {
  if (v instanceof PDFNumber) return v.asNumber();
  return null;
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
