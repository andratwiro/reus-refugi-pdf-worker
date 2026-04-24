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
 * Convenció: llegim els camps del record d'Airtable PER NOM (no per field ID),
 * perquè la taula Informes Vulnerabilitat Express (tblO0n6QksMeXLX3m) de
 * moment no té els IDs de camp cablejats aquí.
 *
 * No flatten — Rob vol poder editar manualment si cal.
 */

import { PDFDocument } from "pdf-lib";
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
    if (!value) return; // do NOT clobber plantilla defaults when Airtable is empty
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
      const name = optName(raw);
      if (!name) continue;
      const casilla = VULNERABILITAT_CASILLA[name];
      if (casilla) check(casilla);
    }
  }

  // Text lliure "Otros (especificar)" → Texto159 + marca Casilla 65
  const altresFactors = strOf(f[A.altresFactors]).trim();
  if (altresFactors) {
    setText(P.altresFactors, altresFactors);
    check(ANEXO2_OTROS_CASILLA);
  }

  // ── Fecha (avui, Europe/Madrid) ──────────────────────────────────────────
  setText(P.dataAvui, todayInMadrid());

  // No flatten
  return await pdfDoc.save();
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Read a string-ish Airtable value. Handles string | number | {name}. */
function strOf(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object" && v !== null && "name" in (v as object)) {
    return String((v as { name: unknown }).name || "");
  }
  return "";
}

/** Name of a single-select / multiple-select option (string or {name}). */
function optName(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "object" && v !== null && "name" in (v as object)) {
    return String((v as { name: unknown }).name || "");
  }
  return "";
}

/**
 * "2026-04-25" or "2026-04-25T00:00:00.000Z" → "25/04/2026".
 * Returns "" for anything unparseable.
 */
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
  // es-ES yields "25/04/2026" with "/" as separator across runtimes (V8 and Workerd).
  return formatter.format(new Date());
}

/** Build a filesystem-safe filename from the applicant name. */
export function anexo2Filename(record: AirtableRecordLike): string {
  const nom = strOf(record.fields[A.nom]);
  const safe = nom
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "_");
  const base = safe || record.id;
  return `A2_${base}.pdf`;
}
