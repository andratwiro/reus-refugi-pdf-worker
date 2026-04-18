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
