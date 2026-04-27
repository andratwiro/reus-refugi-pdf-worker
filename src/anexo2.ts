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
 * Renderitzat universal: la plantilla PyPDF2/reportlab genera /AP streams
 * pels checkboxes que Chrome/Firefox/Drive/Samsung NO renderitzen quan
 * estan marcats — només Apple Preview/Adobe que regeneren al vol.
 *
 * Després d'iterar tres aproximacions (NeedAppearances=false, form.flatten()
 * amb i sense updateFieldAppearances), la solució estable és **bypassar
 * pdf-lib's flatten completament** i dibuixar el contingut directament al
 * content stream de la pàgina:
 *
 *   1. setText/check actualitzen /V dels camps (per a Apple Preview/Adobe).
 *   2. Per cada camp tocat, dibuixem text/marca al rect del widget
 *      (drawText / drawRectangle al PDFPage).
 *   3. Resolem la pàgina destí via /Annots membership amb fallback al /P
 *      o pages[0] (la plantilla té widgets orphans i mal-posicionats).
 *   4. Eliminem els widgets tocats del /Annots de la pàgina + /F=2 +
 *      esborrem /AP perquè el visor no renderitzi appearance default a
 *      sobre. Camps NO tocats (Texto145-149 entitat, Casilla 53) conserven
 *      la seva /AP original — els visors els renderitzen com fa la plantilla.
 *   5. Marca rectangle 120% del widget rect — el frame del checkbox està
 *      al page content stream amb fill blanc per dins; sense l'expansió
 *      el blanc tapa la nostra marca.
 *   6. Override per Texto161 (Fecha): el widget rect del template està a
 *      page 1 quan l'etiqueta visible és a page 2. Forcem pageIndex=1.
 *
 * Verificat amb harness offline (mock/anexo2-render-test.ts) renderitzant
 * el PDF resultant amb poppler/cairo (~Chrome/Drive) i comprovant
 * visualment.
 *
 * Trade-off: PDF no editable post-generació. Acceptable per certificat
 * signat (vegeu commit history 2026-04-27).
 */

import {
  PDFDocument,
  PDFName,
  PDFArray,
  PDFDict,
  PDFRef,
  PDFBool,
  PDFNumber,
  PDFPage,
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

export async function fillAnexo2Pdf(
  templateBytes: ArrayBuffer,
  record: AirtableRecordLike,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(templateBytes);
  const form = pdfDoc.getForm();
  const f = record.fields;

  // Tracking: només regenerarem appearances per als camps QUE NOSALTRES
  // toquem. Els camps pre-omplerts del template (Texto145-149, Casilla 53,
  // etc.) conserven el seu /AP original — així flatten amb
  // updateFieldAppearances:false bake-eja exactament el que la plantilla
  // tenia previst, sense overlap amb una regeneració mal posicionada.
  const touchedTextFields = new Set<string>();
  const touchedCheckBoxes = new Set<string>();

  const setText = (name: string, value: string): void => {
    if (!value) return; // no clobberem defaults de la plantilla amb cadenes buides
    try {
      form.getTextField(name).setText(value);
      touchedTextFields.add(name);
    } catch {
      /* skip missing */
    }
  };
  const check = (name: string): void => {
    try {
      form.getCheckBox(name).check();
      touchedCheckBoxes.add(name);
    } catch {
      /* skip missing */
    }
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

  // ── Manual draw — visibilitat universal sense flatten ────────────────────
  // Història del bug (3 iteracions):
  //
  // 1ª: NeedAppearances=false → Chrome/Firefox/Drive no mostraven Casillas
  //     marcades (només Apple Preview/Adobe regeneren al vol).
  //
  // 2ª: form.flatten() amb updateFieldAppearances:true → els /P refs
  //     obsoletes de la plantilla PyPDF2+reportlab feien fallar flatten()
  //     amb "Could not find page for PDFRef N 0 R". Fix amb /P rebuild.
  //
  // 3ª: form.flatten() amb updateFieldAppearances:false (post-/P rebuild)
  //     → flatten produeix XObjects malformats (poppler avisa "FlatWidget-X
  //     is wrong type") i regenera appearances en posicions errònies,
  //     causant text duplicat a la Secció 1 i Casillas 54-64 buides.
  //     (Verificat amb harness local — mock/anexo2-render-test.ts.)
  //
  // Fix definitiu: BYPASS pdf-lib's flatten completament. Per a cada camp
  // que nosaltres toquem, dibuixem text/marca directament al contingut de
  // la pàgina al rect del widget i netegem la /AP del widget perquè el
  // visor no dibuixi el placeholder original sobre. Els camps NO tocats
  // (Texto145-149 entitat, Casilla 53 Tercer Sector, segell visual)
  // conserven la /AP original del template — el visor els renderitza com
  // sempre. NeedAppearances=false per garantir que els visors NO regenerin
  // el contingut dels camps no tocats.
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const FONT_SIZE = 10;


  // Mapa widget dict → page que el conté (font de veritat: /Annots membership).
  // Necessari perquè el template és multi-page i pdf-lib's widget.P() pot
  // tenir refs obsoletes; volem dibuixar al PAGE on viu cada widget realment.
  const widgetPageMap = buildWidgetPageMap(pdfDoc);

  // Overrides de pàgina — alguns widgets de la plantilla estan registrats
  // a la pàgina equivocada. Per Texto161 (Fecha), el widget rect cau al
  // mateix Y on hi ha l'etiqueta "Fecha:" visible, però a page 1 enlloc
  // de page 2 (template bug). Forcem pageIndex=1 i usem el rect natiu
  // perquè el rect Y casa amb l'etiqueta a page 2.
  const PAGE_OVERRIDE: Record<string, number> = {
    [P.dataAvui]: 1,
  };

  // Dibuix manual del text als camps que hem omplert
  for (const fieldName of touchedTextFields) {
    let field;
    try {
      field = form.getTextField(fieldName);
    } catch {
      continue;
    }
    const text = field.getText() ?? "";
    if (!text) continue;
    const pageOverride = PAGE_OVERRIDE[fieldName];
    for (const widget of field.acroField.getWidgets()) {
      const targetPage =
        pageOverride !== undefined
          ? pdfDoc.getPages()[pageOverride]
          : widgetPageMap.get(widget.dict);
      if (!targetPage) continue;
      const rect = widget.getRectangle();
      targetPage.drawText(text, {
        x: rect.x + 3,
        y: rect.y + (rect.height - FONT_SIZE) / 2 + 1,
        size: FONT_SIZE,
        font: helvetica,
        color: rgb(0, 0, 0),
      });
      // Amagar el widget perquè el visor no dibuixi cap appearance pròpia
      // sobre la nostra. /F bit 2 = Hidden + esborrar /AP per redundància.
      widget.dict.set(PDFName.of("F"), PDFNumber.of(2));
      widget.dict.delete(PDFName.of("AP"));
    }
  }

  // Dibuix manual de la marca (rectangle ple) als checkboxes que hem marcat
  for (const cbName of touchedCheckBoxes) {
    let cb;
    try {
      cb = form.getCheckBox(cbName);
    } catch {
      continue;
    }
    if (!cb.isChecked()) continue;
    for (const widget of cb.acroField.getWidgets()) {
      const targetPage = widgetPageMap.get(widget.dict);
      if (!targetPage) continue;
      const rect = widget.getRectangle();
      // Marca ple ~120% del rect del widget. Necessari extendre-ho per
      // damunt del rect perquè la plantilla té el frame de checkbox al
      // page content stream amb un fill blanc per dins; si dibuixem
      // exactament al rect, el fill blanc tapa la nostra marca.
      const padX = rect.width * 0.1;
      const padY = rect.height * 0.1;
      targetPage.drawRectangle({
        x: rect.x - padX,
        y: rect.y - padY,
        width: rect.width + padX * 2,
        height: rect.height + padY * 2,
        color: rgb(0, 0, 0),
      });
      widget.dict.set(PDFName.of("F"), PDFNumber.of(2));
      widget.dict.delete(PDFName.of("AP"));
    }
  }

  // NeedAppearances=false: no demanem al visor que regeneri res. Els
  // widgets sense /AP (els que hem netejat) no tenen res per dibuixar i
  // queden invisibles. Els widgets amb /AP original (template defaults)
  // es renderitzen correctament com sempre.
  // Eliminar els widgets tocats del /Annots de cada pàgina. Sense això
  // alguns visors (p.ex. ghostscript) renderitzen una appearance default
  // pel widget tot i tenir /F=2 i /AP buit, tapant la nostra marca.
  // Untouched widgets (template pre-fill com Casilla 53) NO es toquen,
  // així conserven la seva /AP original.
  const touchedDicts = new Set<PDFDict>();
  for (const name of touchedTextFields) {
    try {
      for (const w of form.getTextField(name).acroField.getWidgets()) {
        touchedDicts.add(w.dict);
      }
    } catch {
      /* skip */
    }
  }
  for (const name of touchedCheckBoxes) {
    try {
      for (const w of form.getCheckBox(name).acroField.getWidgets()) {
        touchedDicts.add(w.dict);
      }
    } catch {
      /* skip */
    }
  }
  for (const page of pdfDoc.getPages()) {
    const annots = page.node.lookup(PDFName.of("Annots"));
    if (!(annots instanceof PDFArray)) continue;
    for (let i = annots.size() - 1; i >= 0; i--) {
      const item = annots.get(i);
      const dict =
        item instanceof PDFRef ? pdfDoc.context.lookup(item) : item;
      if (dict instanceof PDFDict && touchedDicts.has(dict)) {
        annots.remove(i);
      }
    }
  }

  form.acroForm.dict.set(PDFName.of("NeedAppearances"), PDFBool.False);

  return await pdfDoc.save();
}

/**
 * Construeix un mapa widget.dict → PDFPage. Tres fonts de veritat, en
 * ordre de fiabilitat:
 *   1. /Annots membership: si el widget apareix a la /Annots d'alguna
 *      pàgina, sabem on viu de manera definitiva.
 *   2. Fallback: si el widget té /P apuntant a una pàgina vàlida, l'usem.
 *   3. Heurística: si el rect del widget té y a la meitat superior del
 *      page total i hi ha 2 pàgines, és page 1 (Anexo II: page 1 conté
 *      Sections 1-3, page 2 conté la resta). Si y és molt amunt o molt
 *      avall, page 2.
 *
 * Necessari perquè la plantilla PyPDF2/reportlab té widgets orphans —
 * registrats al form però no a cap /Annots de cap pàgina, amb /P sovint
 * obsolet. Sense aquesta lògica de fallback, dibuixar al primer page
 * fica les marques de Section 3 al lloc equivocat.
 */
function buildWidgetPageMap(pdfDoc: PDFDocument): Map<PDFDict, PDFPage> {
  const map = new Map<PDFDict, PDFPage>();
  const pages = pdfDoc.getPages();
  if (pages.length === 0) return map;

  // Pass 1: /Annots membership (font definitiva)
  for (const page of pages) {
    const annots = page.node.lookup(PDFName.of("Annots"));
    if (!(annots instanceof PDFArray)) continue;
    for (let i = 0; i < annots.size(); i++) {
      const item = annots.get(i);
      const dict =
        item instanceof PDFRef
          ? pdfDoc.context.lookup(item)
          : item;
      if (dict instanceof PDFDict) {
        map.set(dict, page);
      }
    }
  }

  // Pass 2: widgets orphans — assignar via /P si vàlid, altrament fallback
  // a la primera pàgina (Anexo II Section 3 — Casillas 54-64 — viu a page 1).
  const validRefMap = new Map<string, PDFPage>();
  for (const p of pages) {
    validRefMap.set(`${p.ref.objectNumber} ${p.ref.generationNumber}`, p);
  }
  const form = pdfDoc.getForm();
  for (const field of form.getFields()) {
    for (const widget of field.acroField.getWidgets()) {
      if (map.has(widget.dict)) continue; // ja resolt
      const pVal = widget.dict.get(PDFName.of("P"));
      if (pVal instanceof PDFRef) {
        const matched = validRefMap.get(`${pVal.objectNumber} ${pVal.generationNumber}`);
        if (matched) {
          map.set(widget.dict, matched);
          continue;
        }
      }
      // Fallback final: primera pàgina (Section 3 i la resta del form principal)
      map.set(widget.dict, pages[0]);
    }
  }

  return map;
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
