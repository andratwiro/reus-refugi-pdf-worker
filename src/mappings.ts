/**
 * Airtable field IDs for the Casos table (tblaz9eNKzTI7YbM2).
 * Centralized so a field rename in Airtable doesn't break the code.
 * IDs are stable; field names are not.
 */
export const CASOS = {
  // Identificació i estat
  codi: "fldAgEFyyG66AFvHc",
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
 * Real data from the Generalitat de Catalunya's association registry (form J0225,
 * Inscripció de dades registrals — Òrgans de govern, 64431 al Registre d'Associacions).
 *
 * - `recexNum` stays blank for now; fill it in when we have the specific Registro de
 *   Colaboradores de Extranjería inscription number from the ministry (the 64431 is
 *   the Generalitat association registry, NOT the same as RECEX).
 * - Address is split into carrer/num/pis because sections 2 and 3 of the EX-31/EX-32
 *   forms have separate Nº (Texto30/43) and Piso (Texto31/44) fields.
 */
export const ENTITAT_REUS_REFUGI = {
  nom: "ASSOCIACIÓ REUS REFUGI",
  nif: "G55739866",

  domiciliCarrer: "PLAÇA DE PRIM",
  domiciliNum: "10",
  domiciliPis: "3º 2ª",
  localitat: "REUS",
  cp: "43201",
  provincia: "TARRAGONA",

  telefon: "619900426",
  email: "info@reusrefugi.cat",

  // TODO: omplir amb el número d'inscripció oficial al RECEX quan el tinguem.
  recexNum: "",

  // Persona física que representa legalment l'entitat.
  representantNom: "JOSEP XIFRÉ RAMOS AUBIA",
  representantDni: "39927815E",
  representantTitol: "PRESIDENTE",
};

/**
 * Mapping d'una circumstància de vulnerabilitat (text d'Airtable) al número
 * de Casilla de l'Annex II del PDF oficial.
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

/**
 * Coordinates of the FIRMA (signature) boxes on each form, in PDF-native page
 * coordinates (origin = bottom-left, y increases upward).
 *
 * Empirically verified: plain `page.drawImage(...)` with these coords renders
 * correctly on both EX-31 (which has a page-level CTM on each page) and EX-32
 * (no CTM). No inverse-CTM compensation is needed.
 *
 * Note: Page 8 of EX-32 (Annex II) has a signature box for the ENTITY (Reus
 * Refugi certifying vulnerability), NOT the applicant — intentionally excluded.
 */
export interface FirmaBox {
  /** 0-based page index (1 = page 2) */
  pageIndex: number;
  /** Bottom-left x (PDF-native coords) */
  x: number;
  /** Bottom-left y (PDF-native coords) */
  y: number;
  width: number;
  height: number;
}

export const FIRMA_BOXES_EX31: FirmaBox[] = [
  { pageIndex: 1, x: 274.9, y: 473.62, width: 231.2, height: 32.1 },  // Page 2: Solicitante
  { pageIndex: 3, x: 303.7, y: 110.52, width: 229.3, height: 36.4 },  // Page 4: Declarante (Anexo I-1)
  { pageIndex: 4, x: 295.2, y: 203.32, width: 205.0, height: 58.4 },  // Page 5: Declarante (Anexo I-2)
];

export const FIRMA_BOXES_EX32: FirmaBox[] = [
  { pageIndex: 1, x: 267.9, y: 369.4, width: 247.6, height: 48.3 },   // Page 2: Solicitante
  { pageIndex: 3, x: 291.3, y: 68.5,  width: 245.6, height: 45.3 },   // Page 4: Declarante (Anexo I-1)
  { pageIndex: 4, x: 273.3, y: 174.5, width: 247.6, height: 98.0 },   // Page 5: Declarante (Anexo I-2)
];

// ─────────────────────────────────────────────────────────────────────────────
//  ANEXO II — Flux express vulnerabilitat
//  Taula: Informes Vulnerabilitat Express (tblO0n6QksMeXLX3m) a base Venus.
//  Plantilla: assets/A2_certificado_vulnerabilidad.pdf (ja amb dades entitat).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Noms dels camps d'Airtable a la taula Informes Vulnerabilitat Express.
 * Usem NOMS (no IDs) perquè els IDs encara no estan cablejats al codi.
 * Si algun dia cal migrar a IDs, reemplaça els valors per field IDs i afegeix
 * `{ byFieldId: true }` al `getRecord` del handler.
 */
export const ANEXO2_AIRTABLE_FIELDS = {
  nom: "Nom i cognoms",
  tipusDoc: "Tipus document",
  numDoc: "Número document",
  dataNaixement: "Data de naixement",
  nacionalitat: "Nacionalitat",
  domicili: "Domicili",
  telefon: "Telèfon",
  localitat: "Localitat",
  cp: "CP",
  provincia: "Província",
  email: "Email",
  factors: "Factors vulnerabilitat",
  altresFactors: "Altres factors",
} as const;

/**
 * Noms dels widgets del PDF Anexo II (A2_certificado_vulnerabilidad.pdf).
 * NO toquem Texto145-149 (entitat, ja omplerta), Casilla 52/53 (Tercer Sector,
 * ja marcada), ni Texto162-164 (DIR3, pre-impressos al peu).
 */
export const ANEXO2_PDF_FIELDS = {
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

/**
 * Mapa 1:1 entre opcions del multipleSelect `Factors vulnerabilitat` (literal
 * d'Airtable) i el nom del widget PDF de la casilla corresponent.
 * Els 11 factors estàndard. Si Rob canvia les etiquetes, aquí cal actualitzar-les.
 */
export const VULNERABILITAT_CASILLA: Record<string, string> = {
  "Aïllament social o manca de xarxa de suport": "Casilla de verificación54",
  "Sensellarisme o habitatge precari": "Casilla de verificación55",
  "Víctima de discriminació o exclusió social": "Casilla de verificación56",
  "Manca d'ingressos suficients": "Casilla de verificación57",
  "Pobresa o risc d'exclusió econòmica": "Casilla de verificación58",
  "Dificultat d'accés a l'ocupació": "Casilla de verificación59",
  "Persones a càrrec (menors, dependents)": "Casilla de verificación60",
  "Unitat familiar en situació de vulnerabilitat": "Casilla de verificación61",
  "Monoparentalitat en context de precarietat": "Casilla de verificación62",
  "Riscos psicosocials": "Casilla de verificación63",
  "Exposició a situacions d'explotació o abús": "Casilla de verificación64",
};

/** Casilla "Otros (especificar)" — es marca si el text `Altres factors` té contingut. */
export const ANEXO2_OTROS_CASILLA = "Casilla de verificación65";
