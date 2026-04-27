/**
 * Fill the Anexo II — Modelo de certificado de vulnerabilidad (EX-32) PDF.
 *
 * Plantilla: assets/A2_certificado_vulnerabilidad.pdf
 *   - Ja ve amb dades d'entitat (Texto145-149), segell visual i Casilla 53
 *     (Tercer Sector) marcada. NO tocar aquests camps.
 *   - Camps a omplir del sol·licitant: Texto150-158.
 *   - Altres factors (text lliure): Texto159.
 *   - Data d'emissió (avui): Texto161.
 *   - Casillas 54-64: factors de vulnerabilitat (11 opcions, 1:1 amb multipleSelect).
 *   - Casilla 65: es marca automàticament si "Altres factors" té contingut.
 *   - Texto162-164 (DIR3): deixar buits — ja estan impresos al peu.
 *
 * Lectura d'Airtable: per FIELD ID (returnFieldsByFieldId=true). Les opcions
 * del multipleSelect es matchen tant per option ID com per name (vegeu
 * VULNERABILITAT_CASILLA al mappings.ts).
 *
 * Flatten al final: la plantilla original (PyPDF2+reportlab) genera
 * appearance streams pels checkboxes que Chrome/Firefox/Samsung/Drive
 * NO renderitzen — només Apple Preview / Adobe que regeneren al vol.
 * flatten() regenera els streams una vegada amb pdf-lib i els bake-eja
 * com a contingut de pàgina, garantint visibilitat universal. Trade-off:
 * el PDF resultant no és editable post-generació, acceptable perquè
 * és un certificat signat (RECEX 2026-04-27 — vegeu commit history).
 */

import { PDFDocument, PDFName, PDFArray, PDFDict, PDFRef } from "pdf-lib";
import {
  ANEXO2_AIRTABLE_FIELDS as A,
  ANEXO2_PDF_FIELDS as P,
  VULNERABILITAT_CASILLA,
  ANEXO2_OTROS_CASILLA,
} from "./mappings";

type AirtableRecordLike = { id: string; fields: Record<string, unknown> };

export async function fillAnexo2Pdf(
  templateBytes: ArrayBuffer,
  record: AirtableRecordLike,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(templateBytes);
  const form = pdfDoc.getForm();
  const f = record.fields;

  const setText = (name: string, value: string): void => {
    if (!value) return; // no clobberem defaults de la plantilla amb cadenes buides
    try { form.getTextField(name).setText(value); } catch { /* skip missing */ }
  };
  const check = (name: string): void => {
    try { form.getCheckBox(name).check(); } catch { /* skip missing */ }
  };

  // ── Secció 2 — Dades del sol·licitant ─────────────────────────────────────
  setText(P.nom, strOf(f[A.nom]));
  setText(P.numDoc, strOf(f[A.numDoc]));
  setText(P.dataNaixement, formatIsoDate(f[A.dataNaixement]));
  setText(P.nacionalitat, strOf(f[A.nacionalitat]));
  setText(P.domicili, strOf(f[A.domicili]));
  setText(P.telefon, strOf(f[A.telefon]));
  setText(P.localitat, strOf(f[A.localitat]));
  setText(P.cp, strOf(f[A.cp]));
  setText(P.provincia, strOf(f[A.provincia])); // plantilla té "Tarragona" default; només sobreescriu si hi ha valor

  // ── Secció 3 — Circumstàncies de vulnerabilitat ──────────────────────────
  const factors = f[A.factors];
  if (Array.isArray(factors)) {
    for (const raw of factors) {
      // Airtable pot retornar strings (names) o {id, name, color}. Provem tots dos.
      const key =
        typeof raw === "string"
          ? raw
          : (typeof raw === "object" && raw !== null
              ? (("id" in raw && typeof (raw as { id: unknown }).id === "string"
                  ? (raw as { id: string }).id
                  : ("name" in raw && typeof (raw as { name: unknown }).name === "string"
                      ? (raw as { name: string }).name
                      : "")))
              : "");
      if (!key) continue;
      const casilla = VULNERABILITAT_CASILLA[key];
      if (casilla) check(casilla);
    }
  }

  // Text lliure "Otros (especificar)" → Texto159 + Casilla 65.
  // Si A.altresFactors és buit (field ID encara no capturat), saltem aquesta part.
  const altresFactors = A.altresFactors ? strOf(f[A.altresFactors]).trim() : "";
  if (altresFactors) {
    setText(P.altresFactors, altresFactors);
    check(ANEXO2_OTROS_CASILLA);
  }

  // ── Fecha (avui, Europe/Madrid) ──────────────────────────────────────────
  setText(P.dataAvui, todayInMadrid());

  // ── Flatten — visibilitat universal a TOTS els visors ────────────────────
  // Anteriorment forçàvem NeedAppearances=false per a que els visors usessin
  // els appearance streams generats per pdf-lib. Funcionava a Adobe i Apple
  // Preview, però Chrome / Firefox / Samsung PDF / Google Drive no renderitzen
  // les Casillas 54-64 com a marcades — el data dictionary té el valor "Yes"
  // però l'appearance stream del checkbox no es mostra (regeneració al vol
  // falla a aquesta plantilla PyPDF2+reportlab, o l'On state appearance és
  // buit/incorrecte).
  //
  // flatten() resol això de forma definitiva (regenera streams + bake-eja
  // com a contingut de pàgina + elimina fields). Trade-off: el PDF ja no
  // és editable post-generació — acceptable per un certificat signat.
  //
  // PERÒ: la plantilla PyPDF2+reportlab té widget annotations amb /P
  // references obsoletes (apunten a objects de pàgina que pdf-lib no troba
  // al getPages()). flatten() llavors llança "Could not find page for
  // PDFRef N 0 R". La fix: abans de flatten, reconstruir els /P de cada
  // annotation a partir de la pàgina que els conté al seu /Annots array
  // — això garanteix que pdf-lib pot resoldre la pàgina del widget.
  rebuildAnnotPageRefs(pdfDoc);
  form.flatten();

  return await pdfDoc.save();
}

/**
 * Reconstrueix el /P de cada annotation perquè apunti a la pàgina que la
 * conté al seu /Annots. Necessari per plantilles generades amb PyPDF2/
 * reportlab que emeten /P references obsoletes que trenquen el flatten()
 * de pdf-lib.
 */
function rebuildAnnotPageRefs(pdfDoc: PDFDocument): void {
  for (const page of pdfDoc.getPages()) {
    const annots = page.node.lookup(PDFName.of("Annots"));
    if (!(annots instanceof PDFArray)) continue;
    for (let i = 0; i < annots.size(); i++) {
      const item = annots.get(i);
      const annotDict =
        item instanceof PDFRef
          ? pdfDoc.context.lookup(item)
          : item;
      if (annotDict instanceof PDFDict) {
        annotDict.set(PDFName.of("P"), page.ref);
      }
    }
  }
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
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "_");
  const base = safe || record.id;
  return `A2_${base}.pdf`;
}
