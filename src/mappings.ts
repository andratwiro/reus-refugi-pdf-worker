/**
 * Airtable field IDs for the Casos table (tblaz9eNKzTI7YbM2).
 * Centralized so a field rename in Airtable doesn't break the code.
 * IDs are stable; field names are not.
 */
export const CASOS = {
  // Identificació i estat
  codi: "fldlaX9fPgFdfUCwP", // "ID Cas" (formula). L'ID antic fldAgEFyyG66AFvHc
                              // era un camp posterior eliminat — abans del fix
                              // /generate generava filenames "recXXX_EX31.pdf".
  estat: "fldRT05I1hBUmR6ak",
  viaLegal: "fldL8G7DffIaANwl3",
  codiFamiliar: "fld38VOHsb87FdMiH",
  voluntari: "fldOefKAb1qPct4hm",

  // Dades personals
  nom: "fldkIXCBJ8Py0Ej5x",
  cognom1: "fldXxwOvDdP3C7945",
  cognom2: "fldJmqtSblwIl9wQM",
  dataNaixement: "fldqXRGy03lw3ZW4d",
  llocNaixement: "fldnKPHvDp28fcfqd",
  sexe: "fldrlnCWCTktnCgqz",
  nacionalitat: "fldHwroSokEKKXmks",
  estatCivil: "fldxeRihXrhUYhhpB",
  passaport: "fldwTuZvXIM8yMFZN",
  nie: "fldfMJILwP9use1h3",
  idPaisOrigen: "fldWpwNW4lSn37zSD",

  // Pares (per Annex I-2)
  pareNom: "fldH9pl4nqKN9Lcom",
  pareCognom1: "fldnlxGNxLF3YMYAw",
  pareCognom2: "fldv7Xbv0daz9BNsN",
  mareNom: "fldNg3Dkm8iy6sqGm",
  mareCognom1: "flddbzM0hCNJUB3co",
  mareCognom2: "fldKQh2xvltMIZnIZ",

  // Contacte i domicili
  telefon: "flddyicdmd8rypPDk",
  email: "fldSnErwIvogc7Ep7",
  domicili: "fldn7th9pYi9LNdAV",
  localitat: "fldW98c2pae7dt9UB",
  cp: "fldse26iroURquu29",
  provincia: "fldx9fuWHUSAYWFPA",

  // Bloc vulnerabilitat
  circumstancies: "fldQv1DufJtnnaREr",
  certVulnerabilitatEmesa: "fldpBlLwogAfj6YjS",

  // Flags
  menorEdat: "fldhrlDmTOHDrCStY",

  // Família — links entre casos de la mateixa unitat familiar que tramiten a la vegada
  casReferent: "fldLJrBVgoAz9Y72g",
  casosVinculats: "fldJ2FTtl9YXzw9zy",
  parentiuReferent: "fldpt5IEuZ8yWAnuk",

  // Firma digital (PNG capturada via Tally obV0rP)
  firmaDigital: "fld5n0vqeCg5A0USt",

  // Output target
  dossierGenerat: "fldVBsux4CdQkELmg",
} as const;

/**
 * Public entity data from the Generalitat de Catalunya's association registry
 * (form J0225, 64431 al Registre d'Associacions). PII fields (telefon,
 * representantNom/Dni/Titol) live in env secrets — see buildEntitat() in index.ts.
 *
 * For other NGOs forking this worker: edit these constants to your own
 * registry data. Tots els camps són dades públiques del registre d'associacions
 * o equivalent — no PII.
 */
export const ENTITAT_REUS_REFUGI_BASE = {
  nom: "ASSOCIACIÓ REUS REFUGI",
  nif: "G55739866",

  domiciliCarrer: "PLAÇA DE PRIM",
  domiciliNum: "10",
  domiciliPis: "3º 2ª",
  localitat: "REUS",
  cp: "43201",
  provincia: "TARRAGONA",

  email: "info@reusrefugi.cat",

  recexNum: "26e00030037126",

  // "tercer_sector" → marca Casilla 53 a l'Annex II.
  // "admin_publica" → marca Casilla 52.
  tipusEntitat: "tercer_sector" as TipusEntitat,
} as const;

export type TipusEntitat = "admin_publica" | "tercer_sector";

export interface EntitatConfig {
  nom: string;
  nif: string;
  domiciliCarrer: string;
  domiciliNum: string;
  domiciliPis: string;
  localitat: string;
  cp: string;
  provincia: string;
  email: string;
  recexNum: string;
  tipusEntitat: TipusEntitat;
  telefon: string;
  representantNom: string;
  representantDni: string;
  representantTitol: string;
}

/**
 * Mapping d'una circumstància de vulnerabilitat (text d'Airtable) al número
 * de Casilla de l'Annex II del PDF oficial. Usat pel flux /generate (Casos).
 */
export const CIRCUMSTANCIA_CASILLA: Record<string, string> = {
  "Aïllament social o manca de xarxa de suport": "54",
  "Sensellarisme o habitatge precàri": "55",
  "Víctima de discriminació o exclusió social": "56",
  "Manca d'ingressos suficients": "57",
  "Pobresa o risc d'exclusió econòmica": "58",
  "Dificultat d'accés a l'ocupació": "59",
  "Persones a càrrec (menors, dependents)": "60",
  "Unitat familiar en situació de vulnerabilitat": "61",
  "Monoparentalitat en context de precarietat": "62",
  "Riscos psicosocials": "63",
  "Exposició a explotació o abuso": "64",
};

/**
 * Widget names inside the Section-5 area. Identical between the main form's
 * page 2 and the extracted section-5 mini-template (same ministry PDF origin).
 */
export const SECTION5_EX31 = {
  pasaporte: "Texto51",
  nieLetter: "Texto52",
  nieNumber: "Texto53",
  nieCheck: "Texto54",
  cognom1: "Texto55",
  cognom2: "Texto56",
  nom: "Texto57",
  diaNac: "Texto58",
  mesNac: "Texto59",
  anyNac: "Texto60",
  lloc: "Texto61",
  pais: "Texto62",
  nacionalitat: "Texto63",
  pareNomComplet: "Texto64",
  mareNomComplet: "Texto65",
  sexoX: "Casilla de verificación186",
  sexoH: "Casilla de verificación155",
  sexoM: "Casilla de verificación156",
  civilS: "Casilla de verificación157",
  civilC: "Casilla de verificación158",
  civilV: "Casilla de verificación159",
  civilD: "Casilla de verificación160",
  civilSp: "Casilla de verificación161",
  parentiuHijo: "Casilla de verificación162",
  parentiuConyuge: "Casilla de verificación163",
  parentiuAscendiente: "Casilla de verificación164",
} as const;

export const SECTION5_EX32 = {
  pasaporte: "Texto50",
  nieLetter: "Texto51",
  nieNumber: "Texto52",
  nieCheck: "Texto53",
  cognom1: "Texto54",
  cognom2: "Texto55",
  nom: "Texto56",
  diaNac: "Texto57",
  mesNac: "Texto58",
  anyNac: "Texto59",
  lloc: "Texto60",
  pais: "Texto61",
  nacionalitat: "Texto62",
  pareNomComplet: "Texto63",
  mareNomComplet: "Texto64",
  sexoX: "Casilla de verificación19",
  sexoH: "Casilla de verificación20",
  sexoM: "Casilla de verificación21",
  civilS: "Casilla de verificación22",
  civilC: "Casilla de verificación23",
  civilV: "Casilla de verificación24",
  civilD: "Casilla de verificación25",
  civilSp: "Casilla de verificación26",
  parentiuHijo: "Casilla de verificación27",
  parentiuConyuge: "Casilla de verificación28",
  parentiuAscendiente: "Casilla de verificación29",
} as const;

export interface FirmaBox {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export const FIRMA_BOXES_EX31: FirmaBox[] = [
  { pageIndex: 1, x: 274.9, y: 473.62, width: 231.2, height: 32.1 },
  { pageIndex: 3, x: 303.7, y: 110.52, width: 229.3, height: 36.4 },
  { pageIndex: 4, x: 295.2, y: 203.32, width: 205.0, height: 58.4 },
];

export const FIRMA_BOXES_EX32: FirmaBox[] = [
  { pageIndex: 1, x: 267.9, y: 369.4, width: 247.6, height: 48.3 },
  { pageIndex: 3, x: 291.3, y: 68.5,  width: 245.6, height: 45.3 },
  { pageIndex: 4, x: 273.3, y: 174.5, width: 247.6, height: 98.0 },
];

// ─────────────────────────────────────────────────────────────────────────────
//  ANEXO II — Flux ràpid vulnerabilitat (persones que només venen a recollir
//  el certificat i no entren al pipeline complet de Reus Refugi).
//  Taula: Informes de Vulnerabilitat (tblO0n6QksMeXLX3m) a base Venus.
//  Plantilla: assets/A2_certificado_vulnerabilidad.pdf.
//
//  IMPORTANT: usem FIELD IDs (no noms) per estabilitat.
//  Si Rob crea nous camps, afegir-los aquí amb el seu ID.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Field IDs de la taula Informes de Vulnerabilitat.
 * Recollits via Airtable MCP (2026-04-25). Renombrada 2026-04-26: era
 * "Informes Vulnerabilitat Express" — l'ID es manté.
 */
export const ANEXO2_AIRTABLE_FIELDS = {
  nom: "fldkwRL1btyKBJIGM",            // "Nom i cognoms" (singleLineText)
  tipusDoc: "fldoyGzPjQ5jwIMck",       // "Tipus document" (singleSelect)
  numDoc: "flduSnTZLHPP0NMTb",         // "Número document" (singleLineText)
  dataNaixement: "fldJ5bd3Xniot5RFt",  // "Data de naixement" (date)
  nacionalitat: "fldhIVVLGHCYVZfdn",   // "Nacionalitat" (singleLineText)
  domicili: "fldDRwjyqRITqmAUZ",       // "Domicili a Espanya" (singleLineText)
  telefon: "fldX8zuPpEZromBfh",        // "Telèfon" (singleLineText)
  localitat: "fldntiT4dQi7Usn2Q",      // "Localitat" (singleLineText)
  cp: "fldbxRqfIXg8la2az",             // "CP" (singleLineText)
  provincia: "fld7VvSakBt59Xrkj",      // "Província" (singleLineText)
  email: "fld36a7AAARLJUKlE",          // "Email" (email)
  factors: "fldmv1XoELN9E1KR7",        // "Factors vulnerabilitat" (multipleSelects)

  // TODO: "Altres factors" field ID — encara no capturat. Mentre no hi sigui,
  // el Otros (especificar) i la Casilla 65 del PDF quedaran buits.
  // Rob: obre Airtable → field Altres factors → Edit field → copia l'ID "fld..."
  altresFactors: "",
} as const;

/**
 * Noms dels widgets de l'Annex II. Els noms són purament identificadors
 * lògics: el PDF que distribuïm com a template (`assets/A2_certificado_vulnerabilidad.pdf`,
 * descarregat directament d'inclusion.gob.es) NO té AcroForm, i pintem tot
 * a coordenades absolutes definides a `anexo2-coords.ts`. Mantenim els noms
 * "TextoNNN" / "Casilla de verificación NN" perquè coincideixen amb el PDF
 * fillable original que l'oficial va publicar i fan d'ID estable.
 *
 *   Texto145-149 = dades de l'entitat (s'omplen via FillOptions.entitat)
 *   Texto150-158 = dades del sol·licitant
 *   Texto159     = "Otros (especificar)"
 *   Texto161     = data emissió
 *   Texto162-164 = DIR3 (codi DIR3 òrgan tramitador) — opcional, vegeu
 *                  ENTITAT_DIR3_* a env secrets si s'omplen
 *   Casilla 52/53 = tipus entitat (Admin pública / Tercer Sector)
 *   Casilla 54-64 = factors de vulnerabilitat
 *   Casilla 65    = "Otros factores" toggle
 */
export const ANEXO2_PDF_FIELDS = {
  // Entitat
  entitatNom: "Texto145",
  entitatNif: "Texto146",
  entitatRecex: "Texto147",
  entitatDomicili: "Texto148",
  entitatTelEmail: "Texto149",
  // Sol·licitant
  nom: "Texto150",
  numDoc: "Texto151",
  dataNaixement: "Texto152",
  nacionalitat: "Texto153",
  domicili: "Texto154",
  telefon: "Texto155",
  localitat: "Texto156",
  cp: "Texto157",
  provincia: "Texto158",
  altresFactors: "Texto159",
  dataAvui: "Texto161",
} as const;

export const ANEXO2_TIPUS_ENTITAT_CASILLA: Record<TipusEntitat, string> = {
  admin_publica: "Casilla de verificación52",
  tercer_sector: "Casilla de verificación53",
};

/**
 * Mapa entre OPCIÓ (id o nom) del multipleSelect i el widget PDF.
 * Les claus són option IDs (sel...) — robust davant canvis d'etiqueta.
 * Les claus string literals també funcionen com a fallback per si Airtable
 * retorna només el name i no l'ID.
 */
export const VULNERABILITAT_CASILLA: Record<string, string> = {
  // Per option ID (preferit, estable). En el seu moment Rob va renomenar
  // alguns valors a la UI i Airtable va crear OPCIONS NOVES amb ID nou en
  // comptes de mutar les antigues — així que tenim duplicats per algunes
  // entrades. Mapem els dos IDs al mateix Casilla. Si es netegen els
  // duplicats a Airtable, els blocs "(antiga)" / "(nou ID)" són eliminables.
  "selQPZ0N6xMPRXuWo": "Casilla de verificación54", // Aïllament social
  "seleSh6L5An7r3Alp": "Casilla de verificación54", // Aïllament social (nou ID)
  "selsSMM7GRLThoHmd": "Casilla de verificación55", // Sensellarisme
  "selcVnJ4wTgGkjjPr": "Casilla de verificación56", // Discriminació o exclusió
  "seltT2ijq8zDG2VUC": "Casilla de verificación56", // Discriminació o exclusió (nou ID)
  "selWderpMATkL57L9": "Casilla de verificación57", // Manca d'ingressos
  "selBQjJpb0m3iK8eH": "Casilla de verificación58", // Pobresa
  "selDdFL5MFzyI70TO": "Casilla de verificación58", // Pobresa (nou ID)
  "selLHNuj87FGMBesr": "Casilla de verificación59", // Dificultat per trobar feina
  "selkPqy30qXFzbHxL": "Casilla de verificación60", // Persones a càrrec
  "selkHCSgPEY7fq5gk": "Casilla de verificación61", // Família en situació vulnerable
  "selkFaLTMEHoEyeYR": "Casilla de verificación62", // Família monoparental
  "selpfLHy7mG04qH1p": "Casilla de verificación63", // Riscos psicosocials
  "selwgiZxu2FMqsdXT": "Casilla de verificación63", // Riscos psicosocials (nou ID)
  "selFf62XJhsvKkehb": "Casilla de verificación64", // Explotació o abús
  "sel5ozBQ3zPAyTZEz": "Casilla de verificación64", // Explotació o abús (nou ID)

  // Per nom (fallback) — l'API REST retorna multipleSelects com a array de
  // strings (només noms), no objectes amb id, així que el match efectiu és
  // per nom. Doble entrada per als duplicats: variant amb espai (opcions
  // velles) i variant amb \n real (opcions noves creades després del rename).
  "Aïllament social عزلة اجتماعية": "Casilla de verificación54",
  "Aïllament social\nعزلة اجتماعية": "Casilla de verificación54",
  "Sensellarisme o habitatge precari بدون مسكن أو سكن غير لائق": "Casilla de verificación55",
  "Discriminació o exclusió تمييز أو إقصاء": "Casilla de verificación56",
  "Discriminació o exclusió\nتمييز أو إقصاء": "Casilla de verificación56",
  "Manca d'ingressos لا يوجد دخل كافٍ": "Casilla de verificación57",
  "Pobresa o risc d'exclusió econòmica فقر أو ضائقة اقتصادية": "Casilla de verificación58",
  "Pobresa o risc d'exclusió econòmica\nفقر أو ضائقة اقتصادية": "Casilla de verificación58",
  "Dificultat per trobar feina صعوبة في إيجاد عمل": "Casilla de verificación59",
  "Persones a càrrec (menors, gent gran) أشخاص تحت رعايتي (أطفال، مسنون)": "Casilla de verificación60",
  "Família en situació vulnerable عائلة في وضع صعب": "Casilla de verificación61",
  "Família monoparental en precarietat أب أو أم وحيد(ة) في وضع صعب": "Casilla de verificación62",
  "Riscos psicosocials ضغط نفسي أو صدمة": "Casilla de verificación63",
  "Riscos psicosocials\nضغط نفسي أو صدمة": "Casilla de verificación63",
  "Explotació o abús استغلال أو إساءة": "Casilla de verificación64",
  "Explotació o abús\nاستغلال أو إساءة": "Casilla de verificación64",
};

/** Casilla "Otros (especificar)" — es marca si hi ha text a Altres factors. */
export const ANEXO2_OTROS_CASILLA = "Casilla de verificación65";
