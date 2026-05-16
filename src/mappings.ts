/**
 * Public entity data from the Generalitat de Catalunya's association registry
 * (form J0225, 64431 al Registre d'Associacions). PII fields (representant
 * Nom/Dni/Titol) live in env secrets — see buildEntitat() in index.ts.
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

  telefon: "+34 623 78 41 52",
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
  // Per option ID (preferit, estable).
  "selQPZ0N6xMPRXuWo": "Casilla de verificación54", // Aïllament social
  "selsSMM7GRLThoHmd": "Casilla de verificación55", // Sensellarisme
  "selcVnJ4wTgGkjjPr": "Casilla de verificación56", // Discriminació o exclusió
  "selWderpMATkL57L9": "Casilla de verificación57", // Manca d'ingressos
  "selBQjJpb0m3iK8eH": "Casilla de verificación58", // Pobresa
  "selLHNuj87FGMBesr": "Casilla de verificación59", // Dificultat per trobar feina
  "selkPqy30qXFzbHxL": "Casilla de verificación60", // Persones a càrrec
  "selkHCSgPEY7fq5gk": "Casilla de verificación61", // Família en situació vulnerable
  "selkFaLTMEHoEyeYR": "Casilla de verificación62", // Família monoparental
  "selpfLHy7mG04qH1p": "Casilla de verificación63", // Riscos psicosocials
  "selFf62XJhsvKkehb": "Casilla de verificación64", // Explotació o abús

  // Per nom (fallback) — l'API REST de Airtable retorna multipleSelects com
  // a array de strings (només noms, no objectes amb id), així que el match
  // efectiu és per nom. Cat + àrab separats per ESPAI (Airtable strippeja
  // els \n dels noms d'opció).
  "Aïllament social عزلة اجتماعية": "Casilla de verificación54",
  "Sensellarisme o habitatge precari بدون مسكن أو سكن غير لائق": "Casilla de verificación55",
  "Discriminació o exclusió تمييز أو إقصاء": "Casilla de verificación56",
  "Manca d'ingressos لا يوجد دخل كافٍ": "Casilla de verificación57",
  "Pobresa o risc d'exclusió econòmica فقر أو ضائقة اقتصادية": "Casilla de verificación58",
  "Dificultat per trobar feina صعوبة في إيجاد عمل": "Casilla de verificación59",
  "Persones a càrrec (menors, gent gran) أشخاص تحت رعايتي (أطفال، مسنون)": "Casilla de verificación60",
  "Família en situació vulnerable عائلة في وضع صعب": "Casilla de verificación61",
  "Família monoparental en precarietat أب أو أم وحيد(ة) في وضع صعب": "Casilla de verificación62",
  "Riscos psicosocials ضغط نفسي أو صدمة": "Casilla de verificación63",
  "Explotació o abús استغلال أو إساءة": "Casilla de verificación64",
};

/** Casilla "Otros (especificar)" — es marca si hi ha text a Altres factors. */
export const ANEXO2_OTROS_CASILLA = "Casilla de verificación65";
