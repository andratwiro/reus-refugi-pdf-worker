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
  casReferent: "fldLJrBVgoAz9Y72g",     // multipleRecordLinks → cas del sol·licitant principal
  casosVinculats: "fldJ2FTtl9YXzw9zy",  // multipleRecordLinks (invers de casReferent) → dependents
  parentiuReferent: "fldpt5IEuZ8yWAnuk", // singleSelect: Fill/a | Cònjuge/parella registrada | Ascendent | Altre

  // Output target
  dossierGenerat: "fldVBsux4CdQkELmg",
} as const;

/**
 * Dades fixes de l'entitat representant (Reus Refugi).
 * En producció podrien viure a una taula "Config" d'Airtable per editabilitat.
 */
export const ENTITAT_REUS_REFUGI = {
  nom: "ASOCIACION REUS REFUGI",
  nif: "G12345678",
  domicili: "C/ EXEMPLE 1 BAJO",
  localitat: "REUS",
  cp: "43201",
  provincia: "TARRAGONA",
  telefon: "977000000",
  email: "info@reusrefugi.cat",
  recexNum: "",
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
 * Widget names inside the Section-5 mini-template (per form).
 *
 * These are the form-field names found on page 2 of the respective main template,
 * preserved in the extracted section-5 PDFs. They do NOT match the main form's
 * section-5 numbering because EX-31 uses non-sequential checkbox numbering.
 *
 * The mini-template fills these, flattens, and gets merged after page 2 of the
 * main form. See fillSection5Page() in fillPdf.ts.
 */
export const SECTION5_EX31 = {
  // 15 text fields
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
  // Sexo (X/H/M)
  sexoX: "Casilla de verificación186",
  sexoH: "Casilla de verificación155",
  sexoM: "Casilla de verificación156",
  // Estat civil (S/C/V/D/Sp)
  civilS: "Casilla de verificación157",
  civilC: "Casilla de verificación158",
  civilV: "Casilla de verificación159",
  civilD: "Casilla de verificación160",
  civilSp: "Casilla de verificación161",
  // Parentesco (Hijo/Cónyuge/Ascendiente)
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
