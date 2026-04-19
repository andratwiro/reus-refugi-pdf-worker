import { PDFDocument, PDFForm } from "pdf-lib";
import {
  CASOS,
  ENTITAT_REUS_REFUGI,
  CIRCUMSTANCIA_CASILLA,
  SECTION5_EX31,
  SECTION5_EX32,
  FIRMA_BOXES_EX31,
  FIRMA_BOXES_EX32,
  FirmaBox,
} from "./mappings";

// ─────────────────────────────────────────────────────────────────────────────
//  Types exported for index.ts
// ─────────────────────────────────────────────────────────────────────────────

export type FormCode = "EX31" | "EX32";

export interface FillOptions {
  /**
   * First simultaneous applicant (family member) whose data should be filled
   * into section 5 of the main form's page 2. Subsequent applicants (if any)
   * go on inserts and are handled outside this function.
   */
  firstDependent?: AirtableRecordLike;
  /**
   * PNG bytes to embed at every FIRMA DEL SOLICITANTE / FIRMA DEL DECLARANTE
   * box in the form (pages 2, 4, 5 on both EX-31 and EX-32). Undefined if the
   * case has no signature captured yet — firma boxes are left blank.
   */
  signatureBytes?: Uint8Array;
}

type AirtableRecordLike = { id: string; fields: Record<string, unknown> };

export type FillFn = (
  templateBytes: ArrayBuffer,
  record: AirtableRecordLike,
  options?: FillOptions,
) => Promise<Uint8Array>;

export interface TemplateInfo {
  templateFile: string;
  section5TemplateFile: string;
  formCode: FormCode;
  fill: FillFn;
}

// ─────────────────────────────────────────────────────────────────────────────
//  EX-32 — DA 21ª i familiars de DA 21ª
// ─────────────────────────────────────────────────────────────────────────────

export async function fillCasPdf(
  templateBytes: ArrayBuffer,
  record: AirtableRecordLike,
  options: FillOptions = {},
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(templateBytes);
  const form = pdfDoc.getForm();

  const f = record.fields;
  const E = ENTITAT_REUS_REFUGI;

  const str = makeStr(f);
  const rawStr = makeRawStr(f);
  const setText = makeSetText(form);
  const check = makeCheck(form);

  // ── Extract case data ────────────────────────────────────────────────────
  const passaport = str(CASOS.passaport);
  const nom = str(CASOS.nom);
  const cognom1 = str(CASOS.cognom1);
  const cognom2 = str(CASOS.cognom2);
  const [d, m, y] = splitIsoDate(rawStr(CASOS.dataNaixement));
  const lloc = str(CASOS.llocNaixement);
  const nacionalitat = str(CASOS.nacionalitat);
  const paisOrigen = nacionalitatAPais(nacionalitat);
  const sexe = getFirstLetter(rawStr(CASOS.sexe));
  const civil = getCivilCode(rawStr(CASOS.estatCivil));
  const pareNom = str(CASOS.pareNom);
  const pareCognom1 = str(CASOS.pareCognom1);
  const pareCognom2 = str(CASOS.pareCognom2);
  const mareNom = str(CASOS.mareNom);
  const mareCognom1 = str(CASOS.mareCognom1);
  const mareCognom2 = str(CASOS.mareCognom2);
  const domicili = str(CASOS.domicili);
  const localitat = str(CASOS.localitat);
  const cp = str(CASOS.cp);
  const provincia = str(CASOS.provincia);
  const telefon = rawStr(CASOS.telefon);
  const email = rawStr(CASOS.email);
  const viaLegal = rawStr(CASOS.viaLegal);
  const menor = Boolean(f[CASOS.menorEdat]);
  const { carrer, num, pis } = splitAddress(domicili);

  // ── Secció 1 — Dades persona extranjera ──────────────────────────────────
  setText("Texto1", passaport);
  setText("Texto5", cognom1);
  setText("Texto6", cognom2);
  setText("Texto7", nom);
  setText("Texto8", d);
  setText("Texto9", m);
  setText("Texto10", y);
  setText("Texto11", lloc);
  setText("Texto12", paisOrigen);
  setText("Texto13", nacionalitat);
  setText("Texto14", joinName(pareNom, pareCognom1, pareCognom2));
  setText("Texto15", joinName(mareNom, mareCognom1, mareCognom2));
  setText("Texto16", carrer);
  setText("Texto17", num);
  setText("Texto18", pis);
  setText("Texto19", localitat);
  setText("Texto20", cp);
  setText("Texto21", provincia);
  setText("Texto22", telefon);
  setText("Texto23", email);

  const sexeMap: Record<string, string> = { X: "1", H: "2", M: "3" };
  if (sexe in sexeMap) check(`Casilla de verificación${sexeMap[sexe]}`);

  const civilMap: Record<string, string> = { S: "4", C: "5", V: "6", D: "7", Sp: "8" };
  if (civil in civilMap) check(`Casilla de verificación${civilMap[civil]}`);

  // ── Seccions 2 i 3 — Representant + notificacions ───────────────────────
  setText("Texto27", E.nom);
  setText("Texto28", E.nif);
  setText("Texto29", E.domicili);
  setText("Texto32", E.localitat);
  setText("Texto33", E.cp);
  setText("Texto34", E.provincia);
  setText("Texto35", E.telefon);
  setText("Texto36", E.email);
  setText("Texto40", E.nom);
  setText("Texto41", E.nif);
  setText("Texto42", E.domicili);
  setText("Texto45", E.localitat);
  setText("Texto46", E.cp);
  setText("Texto47", E.provincia);
  setText("Texto48", E.telefon);
  setText("Texto49", E.email);

  // ── Secció 4 — Decision tree ────────────────────────────────────────────
  if (viaLegal.includes("DA 21ª – Laboral")) {
    check("Casilla de verificación9");
    check("Casilla de verificación10");
  } else if (viaLegal.includes("DA 21ª – Familiar") && !menor) {
    check("Casilla de verificación9");
    check("Casilla de verificación11");
  } else if (viaLegal.includes("DA 21ª – Vulnerabilitat")) {
    check("Casilla de verificación9");
    check("Casilla de verificación12");
  } else if (viaLegal.includes("Familiar de")) {
    check("Casilla de verificación15");
  }
  check("Casilla de verificación18"); // CONSIENTO Dehú

  // ── Secció 5 — Fill with first dependent (if family) ────────────────────
  if (options.firstDependent) {
    fillSection5Fields(form, options.firstDependent, "EX32");
  }

  // ── Annex I-2 — Sol·licitud antecedents ──────────────────────────────────
  const idPaisOrigen = str(CASOS.idPaisOrigen);
  setText("Texto121", passaport);
  setText("Texto122", idPaisOrigen);
  setText("Texto123", cognom1);
  setText("Texto124", cognom2);
  setText("Texto125", nom);
  setText("Texto126", d);
  setText("Texto127", m);
  setText("Texto128", y);
  setText("Texto129", lloc);
  setText("Texto131", paisOrigen);
  setText("Texto132", nacionalitat);
  setText("Texto133", pareNom);
  setText("Texto134", pareCognom1);
  setText("Texto135", pareCognom2);
  setText("Texto136", mareNom);
  setText("Texto137", mareCognom1);
  setText("Texto138", mareCognom2);
  setText("Texto139", paisOrigen);

  const now = new Date();
  setText("Texto140", localitat);
  setText("Texto141", String(now.getUTCDate()));
  setText("Texto142", MESOS_CA[now.getUTCMonth()]);
  setText("Texto143", String(now.getUTCFullYear()));

  const sexeMapI2: Record<string, string> = { X: "44", H: "45", M: "46" };
  if (sexe in sexeMapI2) check(`Casilla de verificación${sexeMapI2[sexe]}`);
  const civilMapI2: Record<string, string> = { S: "47", C: "48", V: "49", D: "50", Sp: "51" };
  if (civil in civilMapI2) check(`Casilla de verificación${civilMapI2[civil]}`);

  // ── Annex II — Vulnerabilitat ────────────────────────────────────────────
  if (viaLegal.includes("Vulnerabilitat")) {
    setText("Texto145", E.nom);
    setText("Texto146", E.nif);
    setText("Texto147", E.recexNum);
    setText("Texto148", `${E.domicili}, ${E.localitat} ${E.cp} ${E.provincia}`);
    setText("Texto149", `${E.telefon} / ${E.email}`);
    setText("Texto150", `${nom} ${cognom1} ${cognom2}`.trim());
    setText("Texto151", passaport);
    setText("Texto152", `${d}/${m}/${y}`);
    setText("Texto153", nacionalitat);
    setText("Texto154", domicili);
    setText("Texto155", telefon);
    setText("Texto156", localitat);
    setText("Texto157", cp);
    setText("Texto158", provincia);
    check("Casilla de verificación53");

    const circArr = Array.isArray(f[CASOS.circumstancies])
      ? (f[CASOS.circumstancies] as Array<{ name?: string } | string>)
      : [];
    for (const c of circArr) {
      const name = typeof c === "string" ? c : c.name;
      if (name && CIRCUMSTANCIA_CASILLA[name]) {
        check(`Casilla de verificación${CIRCUMSTANCIA_CASILLA[name]}`);
      }
    }
  }

  // ── Embed signature on firma boxes (if provided) ────────────────────────
  if (options.signatureBytes) {
    await embedSignature(pdfDoc, options.signatureBytes, FIRMA_BOXES_EX32);
  }

  return await pdfDoc.save();
}

// ─────────────────────────────────────────────────────────────────────────────
//  EX-31 — DA 20ª (Sol·licitants Protecció Internacional)
// ─────────────────────────────────────────────────────────────────────────────

export async function fillEx31Pdf(
  templateBytes: ArrayBuffer,
  record: AirtableRecordLike,
  options: FillOptions = {},
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(templateBytes);
  const form = pdfDoc.getForm();

  const f = record.fields;
  const E = ENTITAT_REUS_REFUGI;

  const str = makeStr(f);
  const rawStr = makeRawStr(f);
  const setText = makeSetText(form);
  const check = makeCheck(form);

  const passaport = str(CASOS.passaport);
  const nom = str(CASOS.nom);
  const cognom1 = str(CASOS.cognom1);
  const cognom2 = str(CASOS.cognom2);
  const [d, m, y] = splitIsoDate(rawStr(CASOS.dataNaixement));
  const lloc = str(CASOS.llocNaixement);
  const nacionalitat = str(CASOS.nacionalitat);
  const paisOrigen = nacionalitatAPais(nacionalitat);
  const sexe = getFirstLetter(rawStr(CASOS.sexe));
  const civil = getCivilCode(rawStr(CASOS.estatCivil));
  const pareNom = str(CASOS.pareNom);
  const pareCognom1 = str(CASOS.pareCognom1);
  const pareCognom2 = str(CASOS.pareCognom2);
  const mareNom = str(CASOS.mareNom);
  const mareCognom1 = str(CASOS.mareCognom1);
  const mareCognom2 = str(CASOS.mareCognom2);
  const domicili = str(CASOS.domicili);
  const localitat = str(CASOS.localitat);
  const cp = str(CASOS.cp);
  const provincia = str(CASOS.provincia);
  const telefon = rawStr(CASOS.telefon);
  const email = rawStr(CASOS.email);
  const menor = Boolean(f[CASOS.menorEdat]);
  const { carrer, num, pis } = splitAddress(domicili);
  const idPaisOrigen = str(CASOS.idPaisOrigen);

  // Secció 1
  setText("Texto1", passaport);
  setText("Texto5", cognom1);
  setText("Texto6", cognom2);
  setText("Texto7", nom);
  setText("Texto8", d);
  setText("Texto9", m);
  setText("Texto10", y);
  setText("Texto11", lloc);
  setText("Texto12", paisOrigen);
  setText("Texto13", nacionalitat);
  setText("Texto14", joinName(pareNom, pareCognom1, pareCognom2));
  setText("Texto15", joinName(mareNom, mareCognom1, mareCognom2));
  setText("Texto16", carrer);
  setText("Texto17", num);
  setText("Texto18", pis);
  setText("Texto19", localitat);
  setText("Texto20", cp);
  setText("Texto21", provincia);
  setText("Texto22", telefon);
  setText("Texto23", email);

  const sexeMap: Record<string, string> = { X: "187", H: "141", M: "142" };
  if (sexe in sexeMap) check(`Casilla de verificación${sexeMap[sexe]}`);
  const civilMap: Record<string, string> = {
    S: "143", C: "144", V: "145", D: "146", Sp: "147",
  };
  if (civil in civilMap) check(`Casilla de verificación${civilMap[civil]}`);

  // Seccions 2-3
  setText("Texto27", E.nom);
  setText("Texto28", E.nif);
  setText("Texto29", E.domicili);
  setText("Texto32", E.localitat);
  setText("Texto33", E.cp);
  setText("Texto34", E.provincia);
  setText("Texto35", E.telefon);
  setText("Texto36", E.email);
  setText("Texto40", E.nom);
  setText("Texto41", E.nif);
  setText("Texto42", E.domicili);
  setText("Texto45", E.localitat);
  setText("Texto46", E.cp);
  setText("Texto47", E.provincia);
  setText("Texto48", E.telefon);
  setText("Texto49", E.email);

  // Secció 4
  check("Casilla de verificación148");
  if (menor) check("Casilla de verificación149");
  check("Casilla de verificación154"); // CONSIENTO Dehú

  // Secció 5 — first dependent, if family
  if (options.firstDependent) {
    fillSection5Fields(form, options.firstDependent, "EX31");
  }

  // Annex I-2
  setText("Texto117", passaport);
  setText("Texto118", idPaisOrigen);
  setText("Texto119", cognom1);
  setText("Texto120", cognom2);
  setText("Texto121", nom);
  setText("Texto122", d);
  setText("Texto123", m);
  setText("Texto124", y);
  setText("Texto125", lloc);
  setText("Texto127", paisOrigen);
  setText("Texto128", nacionalitat);
  setText("Texto129", pareNom);
  setText("Texto130", pareCognom1);
  setText("Texto131", pareCognom2);
  setText("Texto132", mareNom);
  setText("Texto133", mareCognom1);
  setText("Texto134", mareCognom2);
  setText("Texto183", paisOrigen);

  const sexeMapI2: Record<string, string> = { X: "188", H: "176", M: "177" };
  if (sexe in sexeMapI2) check(`Casilla de verificación${sexeMapI2[sexe]}`);
  const civilMapI2: Record<string, string> = {
    S: "178", C: "179", V: "180", D: "181", Sp: "182",
  };
  if (civil in civilMapI2) check(`Casilla de verificación${civilMapI2[civil]}`);

  const now = new Date();
  setText("Texto135", localitat);
  setText("Texto136", String(now.getUTCDate()));
  setText("Texto137", MESOS_CA[now.getUTCMonth()]);
  setText("Texto138", String(now.getUTCFullYear()));

  // Embed signature (if provided)
  if (options.signatureBytes) {
    await embedSignature(pdfDoc, options.signatureBytes, FIRMA_BOXES_EX31);
  }

  return await pdfDoc.save();
}

// ─────────────────────────────────────────────────────────────────────────────
//  Secció 5 — Shared field-fill logic + insert-page wrapper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fills section 5 widget values on the given form. Does NOT flatten — the
 * caller decides whether to flatten (inserts yes, main form no).
 *
 * Used in two paths:
 *   - fillCasPdf/fillEx31Pdf: fills page 2's section 5 for the first family member
 *   - fillSection5Page: fills the insert mini-template, which is then flattened
 */
function fillSection5Fields(
  form: PDFForm,
  member: AirtableRecordLike,
  formCode: FormCode,
): void {
  const f = member.fields;
  const MAP = formCode === "EX31" ? SECTION5_EX31 : SECTION5_EX32;

  const str = makeStr(f);
  const rawStr = makeRawStr(f);
  const setText = makeSetText(form);
  const check = makeCheck(form);

  const passaport = str(CASOS.passaport);
  const nie = str(CASOS.nie);
  const nom = str(CASOS.nom);
  const cognom1 = str(CASOS.cognom1);
  const cognom2 = str(CASOS.cognom2);
  const [d, m, y] = splitIsoDate(rawStr(CASOS.dataNaixement));
  const lloc = str(CASOS.llocNaixement);
  const nacionalitat = str(CASOS.nacionalitat);
  const paisOrigen = nacionalitatAPais(nacionalitat);
  const sexe = getFirstLetter(rawStr(CASOS.sexe));
  const civil = getCivilCode(rawStr(CASOS.estatCivil));
  const pareNomComplet = joinName(
    str(CASOS.pareNom), str(CASOS.pareCognom1), str(CASOS.pareCognom2),
  );
  const mareNomComplet = joinName(
    str(CASOS.mareNom), str(CASOS.mareCognom1), str(CASOS.mareCognom2),
  );
  const parentiu = rawStr(CASOS.parentiuReferent).trim();

  setText(MAP.pasaporte, passaport);
  setText(MAP.nieLetter, "");
  setText(MAP.nieNumber, nie);
  setText(MAP.nieCheck, "");
  setText(MAP.cognom1, cognom1);
  setText(MAP.cognom2, cognom2);
  setText(MAP.nom, nom);
  setText(MAP.diaNac, d);
  setText(MAP.mesNac, m);
  setText(MAP.anyNac, y);
  setText(MAP.lloc, lloc);
  setText(MAP.pais, paisOrigen);
  setText(MAP.nacionalitat, nacionalitat);
  setText(MAP.pareNomComplet, pareNomComplet);
  setText(MAP.mareNomComplet, mareNomComplet);

  if (sexe === "H") check(MAP.sexoH);
  else if (sexe === "M") check(MAP.sexoM);
  else if (sexe === "X") check(MAP.sexoX);

  const civilCheck: Record<string, string> = {
    S: MAP.civilS, C: MAP.civilC, V: MAP.civilV, D: MAP.civilD, Sp: MAP.civilSp,
  };
  if (civil in civilCheck) check(civilCheck[civil]);

  if (parentiu === "Fill/a") check(MAP.parentiuHijo);
  else if (parentiu === "Cònjuge / parella registrada") check(MAP.parentiuConyuge);
  else if (parentiu === "Cònjuge/parella registrada") check(MAP.parentiuConyuge);
  else if (parentiu === "Ascendent") check(MAP.parentiuAscendiente);
}

/**
 * Load the section-5 mini-template, fill it for a family member, flatten
 * (crucial — prevents widget name collisions when merged with the main form),
 * and return the bytes of the single-page A4 PDF.
 */
export async function fillSection5Page(
  templateBytes: ArrayBuffer,
  member: AirtableRecordLike,
  formCode: FormCode,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(templateBytes);
  const form = pdfDoc.getForm();
  fillSection5Fields(form, member, formCode);
  form.flatten();
  return await pdfDoc.save();
}

// ─────────────────────────────────────────────────────────────────────────────
//  Merge — Insert additional section-5 pages after page 2 of main
// ─────────────────────────────────────────────────────────────────────────────

export async function mergePdfWithInserts(
  mainBytes: Uint8Array,
  insertBytesList: Uint8Array[],
  insertAfterPageIndex = 1,
): Promise<Uint8Array> {
  if (insertBytesList.length === 0) return mainBytes;

  const result = await PDFDocument.create();
  const mainDoc = await PDFDocument.load(mainBytes);
  const mainPages = await result.copyPages(mainDoc, mainDoc.getPageIndices());

  for (let i = 0; i <= insertAfterPageIndex && i < mainPages.length; i++) {
    result.addPage(mainPages[i]);
  }
  for (const insertBytes of insertBytesList) {
    const insertDoc = await PDFDocument.load(insertBytes);
    const [insertPage] = await result.copyPages(insertDoc, [0]);
    result.addPage(insertPage);
  }
  for (let i = insertAfterPageIndex + 1; i < mainPages.length; i++) {
    result.addPage(mainPages[i]);
  }
  return await result.save();
}

// ─────────────────────────────────────────────────────────────────────────────
//  Signature — Embed PNG at each FIRMA box
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Embeds the signature PNG at each firma box in the document. The image is
 * scaled to fit (preserving aspect ratio) with a small margin, then centered
 * within the box.
 *
 * Uses plain `page.drawImage(...)` — no CTM compensation needed, even on EX-31
 * (which has a page-level scale+flip CTM). Empirically verified both forms
 * render correctly this way.
 */
async function embedSignature(
  pdfDoc: PDFDocument,
  signatureBytes: Uint8Array,
  boxes: FirmaBox[],
): Promise<void> {
  const img = await pdfDoc.embedPng(signatureBytes);
  const pages = pdfDoc.getPages();
  const MARGIN = 4; // points of padding inside the box

  for (const box of boxes) {
    if (box.pageIndex < 0 || box.pageIndex >= pages.length) continue;
    const page = pages[box.pageIndex];
    const scaled = img.scaleToFit(
      Math.max(1, box.width - MARGIN),
      Math.max(1, box.height - MARGIN),
    );
    const xOff = (box.width - scaled.width) / 2;
    const yOff = (box.height - scaled.height) / 2;
    page.drawImage(img, {
      x: box.x + xOff,
      y: box.y + yOff,
      width: scaled.width,
      height: scaled.height,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Shared helpers (used by all fill paths)
// ─────────────────────────────────────────────────────────────────────────────

function makeStr(f: Record<string, unknown>) {
  return (fieldId: string): string => {
    const v = f[fieldId];
    if (v == null) return "";
    if (typeof v === "string") return v.toUpperCase().trim();
    if (Array.isArray(v)) return "";
    if (typeof v === "object" && "name" in (v as object)) {
      return String((v as { name: string }).name).toUpperCase().trim();
    }
    return String(v).toUpperCase().trim();
  };
}

function makeRawStr(f: Record<string, unknown>) {
  return (fieldId: string): string => {
    const v = f[fieldId];
    if (v == null) return "";
    if (typeof v === "string") return v;
    if (typeof v === "object" && "name" in (v as object)) {
      return String((v as { name: string }).name);
    }
    return String(v);
  };
}

function makeSetText(form: PDFForm) {
  return (fieldName: string, value: string): void => {
    try {
      form.getTextField(fieldName).setText(value || "");
    } catch { /* field doesn't exist in this template; skip */ }
  };
}

function makeCheck(form: PDFForm) {
  return (fieldName: string): void => {
    try {
      form.getCheckBox(fieldName).check();
    } catch { /* checkbox doesn't exist; skip */ }
  };
}

function splitIsoDate(iso: string): [string, string, string] {
  if (!iso || typeof iso !== "string") return ["", "", ""];
  const parts = iso.split("-");
  if (parts.length !== 3) return ["", "", ""];
  return [parts[2], parts[1], parts[0]];
}

function getFirstLetter(s: string): string {
  return (s || "").trim().charAt(0).toUpperCase();
}

function getCivilCode(s: string): string {
  if (!s) return "";
  const match = s.match(/\(([A-Za-z]+)\)/);
  return match ? match[1] : "";
}

function joinName(nom: string, c1: string, c2: string): string {
  return [nom, c1, c2].filter(Boolean).join(" ");
}

function splitAddress(addr: string): { carrer: string; num: string; pis: string } {
  if (!addr) return { carrer: "", num: "", pis: "" };
  const match = addr.match(/^(.+?)\s+(\d+[A-Za-z]?)\s*(.*)$/);
  if (match) {
    return {
      carrer: match[1].trim(),
      num: match[2].trim(),
      pis: (match[3] || "").trim(),
    };
  }
  return { carrer: addr, num: "", pis: "" };
}

function nacionalitatAPais(nac: string): string {
  const map: Record<string, string> = {
    "SENEGALESA": "SENEGAL",
    "MARROQUINA": "MARRUECOS",
    "VENEÇOLANA": "VENEZUELA",
    "HONDURENYA": "HONDURAS",
    "PERUANA": "PERÚ",
    "COLOMBIANA": "COLOMBIA",
    "ECUATORIANA": "ECUADOR",
    "NIGERIANA": "NIGERIA",
    "MALIANA": "MALÍ",
    "GAMBIANA": "GAMBIA",
  };
  return map[nac] || nac;
}

const MESOS_CA = [
  "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
  "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE",
];

// ─────────────────────────────────────────────────────────────────────────────
//  Dispatcher
// ─────────────────────────────────────────────────────────────────────────────

export function getTemplateInfo(viaLegal: string): TemplateInfo {
  if (viaLegal.includes("DA 20ª")) {
    return {
      templateFile: "EX31_oficial.pdf",
      section5TemplateFile: "EX31_seccion5.pdf",
      formCode: "EX31",
      fill: fillEx31Pdf,
    };
  }
  return {
    templateFile: "EX32_oficial.pdf",
    section5TemplateFile: "EX32_seccion5.pdf",
    formCode: "EX32",
    fill: fillCasPdf,
  };
}
