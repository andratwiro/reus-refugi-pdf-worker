import { PDFDocument } from "pdf-lib";
import { CASOS, ENTITAT_REUS_REFUGI, CIRCUMSTANCIA_CASILLA } from "./mappings";

/**
 * Omple l'EX-32 amb les dades d'un cas. Retorna el PDF com a Uint8Array.
 *
 * Aplica l'arbre de decisió basat en la "Via legal":
 *   - DA 21ª – Laboral       → irregular + haber trabajado
 *   - DA 21ª – Familiar      → irregular + unidad familiar
 *   - DA 21ª – Vulnerabilitat→ irregular + vulnerabilidad (+ Annex II)
 *   - Familiar de DA21ª      → familiar de solicitante
 *
 * L'Annex I-2 (sol·licitud antecedents) s'omple sempre amb les dades del país
 * d'origen (en producció: un PDF per cada país de residència dels últims 5 anys).
 */
export async function fillCasPdf(
  templateBytes: ArrayBuffer,
  record: { id: string; fields: Record<string, unknown> },
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(templateBytes);
  const form = pdfDoc.getForm();

  const f = record.fields;
  const E = ENTITAT_REUS_REFUGI;

  // ── Helpers ─────────────────────────────────────────────────────────────
  const str = (fieldId: string): string => {
    const v = f[fieldId];
    if (v == null) return "";
    if (typeof v === "string") return v.toUpperCase().trim();
    if (Array.isArray(v)) return ""; // linked records / multi-selects handled elsewhere
    if (typeof v === "object" && "name" in (v as object)) {
      return String((v as { name: string }).name).toUpperCase().trim();
    }
    return String(v).toUpperCase().trim();
  };

  const rawStr = (fieldId: string): string => {
    const v = f[fieldId];
    if (v == null) return "";
    if (typeof v === "string") return v;
    if (typeof v === "object" && "name" in (v as object)) {
      return String((v as { name: string }).name);
    }
    return String(v);
  };

  const setText = (fieldName: string, value: string): void => {
    try {
      form.getTextField(fieldName).setText(value || "");
    } catch {
      // Field doesn't exist in this template — silently skip.
    }
  };

  const check = (fieldName: string): void => {
    try {
      form.getCheckBox(fieldName).check();
    } catch {
      // Checkbox doesn't exist — silently skip.
    }
  };

  const splitIsoDate = (iso: string): [string, string, string] => {
    if (!iso || typeof iso !== "string") return ["", "", ""];
    const parts = iso.split("-");
    if (parts.length !== 3) return ["", "", ""];
    return [parts[2], parts[1], parts[0]]; // dd, mm, yyyy
  };

  // ── Extract case data ───────────────────────────────────────────────────
  const passaport = str(CASOS.passaport);
  const nom = str(CASOS.nom);
  const cognom1 = str(CASOS.cognom1);
  const cognom2 = str(CASOS.cognom2);
  const [d, m, y] = splitIsoDate(rawStr(CASOS.dataNaixement));
  const lloc = str(CASOS.llocNaixement);
  const nacionalitat = str(CASOS.nacionalitat);
  const paisOrigen = nacionalitatAPais(nacionalitat);
  const sexe = getFirstLetter(rawStr(CASOS.sexe)); // "H (home)" → "H"
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

  // Parse "Carrer Sant Pere 14 2º 1ª" into {carrer, num, pis} best-effort
  const { carrer, num, pis } = splitAddress(domicili);

  // ── Secció 1 — Dades persona extranjera ────────────────────────────────
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

  // Sexe (Casilla 1=X, 2=H, 3=M)
  const sexeMap: Record<string, string> = { X: "1", H: "2", M: "3" };
  if (sexe in sexeMap) check(`Casilla de verificación${sexeMap[sexe]}`);

  // Estat civil (Casilla 4=S, 5=C, 6=V, 7=D, 8=Sp)
  const civilMap: Record<string, string> = { S: "4", C: "5", V: "6", D: "7", Sp: "8" };
  if (civil in civilMap) check(`Casilla de verificación${civilMap[civil]}`);

  // ── Secció 2 — Dades representant (Reus Refugi via RECEX) ──────────────
  setText("Texto27", E.nom);
  setText("Texto28", E.nif);
  setText("Texto29", E.domicili);
  setText("Texto32", E.localitat);
  setText("Texto33", E.cp);
  setText("Texto34", E.provincia);
  setText("Texto35", E.telefon);
  setText("Texto36", E.email);

  // ── Secció 3 — Domicili a efectes de notificacions (= secció 2) ───────
  setText("Texto40", E.nom);
  setText("Texto41", E.nif);
  setText("Texto42", E.domicili);
  setText("Texto45", E.localitat);
  setText("Texto46", E.cp);
  setText("Texto47", E.provincia);
  setText("Texto48", E.telefon);
  setText("Texto49", E.email);

  // ── Secció 4 — Decision tree ──────────────────────────────────────────
  if (viaLegal.includes("DA 21ª – Laboral")) {
    check("Casilla de verificación9");   // Encontrarse irregular
    check("Casilla de verificación10");  // Haber trabajado
  } else if (viaLegal.includes("DA 21ª – Familiar") && !menor) {
    check("Casilla de verificación9");
    check("Casilla de verificación11");  // Permanecer con unidad familiar
  } else if (viaLegal.includes("DA 21ª – Vulnerabilitat")) {
    check("Casilla de verificación9");
    check("Casilla de verificación12");  // Vulnerabilidad
  } else if (viaLegal.includes("Familiar de")) {
    check("Casilla de verificación15");
  }

  // CONSIENTO Dehú (RECEX → sempre)
  check("Casilla de verificación18");

  // ── Annex I-2 — Sol·licitud antecedents al país d'origen ───────────────
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

  // Lloc i data de signatura (a peu de l'Annex I-2)
  const now = new Date();
  setText("Texto140", localitat);
  setText("Texto141", String(now.getUTCDate()));
  setText("Texto142", MESOS_CA[now.getUTCMonth()]);
  setText("Texto143", String(now.getUTCFullYear()));

  // Sexe i estat civil a Annex I-2 (Casilla 44-46 i 47-51)
  const sexeMapI2: Record<string, string> = { X: "44", H: "45", M: "46" };
  if (sexe in sexeMapI2) check(`Casilla de verificación${sexeMapI2[sexe]}`);
  const civilMapI2: Record<string, string> = { S: "47", C: "48", V: "49", D: "50", Sp: "51" };
  if (civil in civilMapI2) check(`Casilla de verificación${civilMapI2[civil]}`);

  // ── Annex II — Certificat vulnerabilitat (només via vulnerabilitat) ───
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
    setText("Texto154", `${domicili}`);
    setText("Texto155", telefon);
    setText("Texto156", localitat);
    setText("Texto157", cp);
    setText("Texto158", provincia);

    check("Casilla de verificación53"); // Tercer Sector RECEX

    // Circumstàncies marcades (multipleSelects d'Airtable)
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

  return await pdfDoc.save();
}

// ── Utilities ──────────────────────────────────────────────────────────

const MESOS_CA = [
  "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
  "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE",
];

/** Extract first character from "H (home)" → "H" */
function getFirstLetter(s: string): string {
  const trimmed = (s || "").trim();
  return trimmed.charAt(0).toUpperCase();
}

/** "Solter/a (S)" → "S" — last char in parens */
function getCivilCode(s: string): string {
  if (!s) return "";
  const match = s.match(/\(([A-Za-z]+)\)/);
  return match ? match[1] : "";
}

function joinName(nom: string, c1: string, c2: string): string {
  return [nom, c1, c2].filter(Boolean).join(" ");
}

/** Best-effort parse of "CARRER X 14 2º 1ª" into {carrer: "CARRER X", num: "14", pis: "2º 1ª"} */
function splitAddress(addr: string): { carrer: string; num: string; pis: string } {
  if (!addr) return { carrer: "", num: "", pis: "" };
  // Match first number sequence
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

/** Naive nationality → country (extend as needed). */
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

// ═══════════════════════════════════════════════════════════════════════════
//  EX-31 — Solicitants de protecció internacional (DA 20ª)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Omple l'EX-31 amb les dades d'un cas de DA 20ª.
 *
 * Diferències principals amb EX-32:
 *   - Checkboxes numerats 141-188 (en lloc de 1-65)
 *   - Sexe: X=187, H=141, M=142
 *   - Estat civil: 143(S), 144(C), 145(V), 146(D), 147(Sp)
 *   - Tipo autorización: Casilla148 (Solicitante PI) + 154 (Dehú) sempre marcats
 *   - NO té Annex II (vulnerabilitat) — només Annex I-1 i I-2
 *   - Annex I-2 sexe: X=188, H=176, M=177
 *   - Annex I-2 civil: 178(S), 179(C), 180(V), 181(D), 182(Sp)
 */
export async function fillEx31Pdf(
  templateBytes: ArrayBuffer,
  record: { id: string; fields: Record<string, unknown> },
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(templateBytes);
  const form = pdfDoc.getForm();

  const f = record.fields;
  const E = ENTITAT_REUS_REFUGI;

  // Helpers (idèntics a fillCasPdf, duplicats per simplicitat)
  const str = (fieldId: string): string => {
    const v = f[fieldId];
    if (v == null) return "";
    if (typeof v === "string") return v.toUpperCase().trim();
    if (Array.isArray(v)) return "";
    if (typeof v === "object" && "name" in (v as object)) {
      return String((v as { name: string }).name).toUpperCase().trim();
    }
    return String(v).toUpperCase().trim();
  };

  const rawStr = (fieldId: string): string => {
    const v = f[fieldId];
    if (v == null) return "";
    if (typeof v === "string") return v;
    if (typeof v === "object" && "name" in (v as object)) {
      return String((v as { name: string }).name);
    }
    return String(v);
  };

  const setText = (fieldName: string, value: string): void => {
    try {
      form.getTextField(fieldName).setText(value || "");
    } catch {
      // Field doesn't exist — silently skip
    }
  };

  const check = (fieldName: string): void => {
    try {
      form.getCheckBox(fieldName).check();
    } catch {
      // Checkbox doesn't exist — silently skip
    }
  };

  const splitIsoDate = (iso: string): [string, string, string] => {
    if (!iso || typeof iso !== "string") return ["", "", ""];
    const parts = iso.split("-");
    if (parts.length !== 3) return ["", "", ""];
    return [parts[2], parts[1], parts[0]];
  };

  // Dades del cas
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

  // ── Secció 1 — Dades persona extranjera ─────────────────────────────────
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

  // Sexe: EX-31 usa Casilla187/141/142 (X/H/M)
  const sexeMap: Record<string, string> = { X: "187", H: "141", M: "142" };
  if (sexe in sexeMap) check(`Casilla de verificación${sexeMap[sexe]}`);

  // Estat civil: Casilla143-147 (S/C/V/D/Sp)
  const civilMap: Record<string, string> = {
    S: "143", C: "144", V: "145", D: "146", Sp: "147",
  };
  if (civil in civilMap) check(`Casilla de verificación${civilMap[civil]}`);

  // ── Secció 2 — Representant (Reus Refugi via RECEX) ─────────────────────
  setText("Texto27", E.nom);
  setText("Texto28", E.nif);
  setText("Texto29", E.domicili);
  setText("Texto32", E.localitat);
  setText("Texto33", E.cp);
  setText("Texto34", E.provincia);
  setText("Texto35", E.telefon);
  setText("Texto36", E.email);

  // ── Secció 3 — Domicili notificacions (= secció 2) ─────────────────────
  setText("Texto40", E.nom);
  setText("Texto41", E.nif);
  setText("Texto42", E.domicili);
  setText("Texto45", E.localitat);
  setText("Texto46", E.cp);
  setText("Texto47", E.provincia);
  setText("Texto48", E.telefon);
  setText("Texto49", E.email);

  // ── Secció 4 — Tipo autorización ────────────────────────────────────────
  // Per DA 20ª el cas per defecte és "Solicitante PI" (Casilla148).
  // El nº d'expedient d'asil (Texto50) l'omple el voluntari a mà.
  check("Casilla de verificación148");

  // Si el cas és un menor, marca també la casella corresponent.
  // Per defecte assumim "nacido en España". Ajustable segons context del cas.
  if (menor) {
    check("Casilla de verificación149");
  }

  // CONSIENTO Dehú (RECEX → sempre)
  check("Casilla de verificación154");

  // ── Annex I-2 — Sol·licitud antecedents al país d'origen ───────────────
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
  setText("Texto183", paisOrigen); // País al que solicitar antecedents

  // Sexe Annex I-2: Casilla188/176/177 (X/H/M)
  const sexeMapI2: Record<string, string> = { X: "188", H: "176", M: "177" };
  if (sexe in sexeMapI2) check(`Casilla de verificación${sexeMapI2[sexe]}`);

  // Civil Annex I-2: Casilla178-182 (S/C/V/D/Sp)
  const civilMapI2: Record<string, string> = {
    S: "178", C: "179", V: "180", D: "181", Sp: "182",
  };
  if (civil in civilMapI2) check(`Casilla de verificación${civilMapI2[civil]}`);

  // Lloc + data signatura Annex I-2
  const now = new Date();
  setText("Texto135", localitat);
  setText("Texto136", String(now.getUTCDate()));
  setText("Texto137", MESOS_CA[now.getUTCMonth()]);
  setText("Texto138", String(now.getUTCFullYear()));

  return await pdfDoc.save();
}

// ═══════════════════════════════════════════════════════════════════════════
//  Dispatcher — Tria quin template i funció usar segons "Via legal"
// ═══════════════════════════════════════════════════════════════════════════

export type FormCode = "EX31" | "EX32";
export type FillFn = (
  templateBytes: ArrayBuffer,
  record: { id: string; fields: Record<string, unknown> },
) => Promise<Uint8Array>;

export interface TemplateInfo {
  templateFile: string;
  formCode: FormCode;
  fill: FillFn;
}

/**
 * Decideix quin formulari usar segons la Via legal del cas.
 *
 * DA 20ª (sol·licitants de protecció internacional) → EX-31
 * DA 21ª i famílies → EX-32 (el comportament existent)
 */
export function getTemplateInfo(viaLegal: string): TemplateInfo {
  if (viaLegal.includes("DA 20ª")) {
    return {
      templateFile: "EX31_oficial.pdf",
      formCode: "EX31",
      fill: fillEx31Pdf,
    };
  }
  return {
    templateFile: "EX32_oficial.pdf",
    formCode: "EX32",
    fill: fillCasPdf,
  };
}
