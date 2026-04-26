/**
 * Mapping Airtable case → Mercurio 143-field POST payload (form EX-32).
 *
 * Aquest mòdul és COMPARTIT entre el test harness i (futur) el Worker endpoint
 * `/mercurio/payload`. Mantenir pure function sense dependències de Worker o
 * Node-only modules.
 *
 * Conveni: les claus de `record.fields` són els NOMS d'Airtable (post-rename
 * dels camps `(Mercurio)` al nom net). Si encara tens els suffixos, passa
 * `record.fields["Tipus via (Mercurio)"]` etc. — el mapper accepta les dues.
 */

export interface AirtableCase {
  id: string;
  fields: Record<string, any>;
}

export interface PresentadorConfig {
  /** Nom complet, ja en majúscules format Mercurio (cognoms + nom) */
  nombre: string;
  /** NIE/DNI del voluntari que presenta */
  nie: string;
  /** Tipus de doc, normalment 'NF' (NIE) o 'NV' (DNI) */
  tipoDoc: 'NF' | 'NV' | 'PA';
  /** Mòbil de contacte de l'entitat */
  mobil: string;
  /** Email genèric de l'entitat */
  email: string;
}

/** Default presentador config — Reus Refugi entity defaults from HAR (Elena) */
export const REUS_REFUGI_DEFAULT_PRESENTADOR: PresentadorConfig = {
  nombre: 'GIMENEZ RODRIGUEZ ELENA ANTONIA',
  nie: '39656870V',
  tipoDoc: 'NF',
  mobil: '663305755',
  email: 'regularitzacio@reusrefugi.cat',
};

/**
 * Map "Via legal" (Airtable singleSelect) → Mercurio form & codes.
 *
 * Mercurio té DOS formularis paral·lels:
 *   • EX-31 = "...por razón de arraigo": cobreix DA 20ª (Sol·licitant Protecció
 *     Internacional) i variants (fills menors, familiars del Sol·licitant PI,
 *     pròrrogues...). 6 supuestos.
 *   • EX-32 = "...por circunstancias excepcionales": cobreix DA 21ª (Arraigo
 *     Laboral / Familiar / Vulnerabilitat) i variants (fills menors, familiars
 *     DA 21ª, pròrrogues). 8 supuestos.
 *
 * Codis confirmats per inspecció DOM dels 2 forms (2026-04-26).
 */
const FORM_DES = {
  EX31: 'Solicitud de autorización de residencia por circunstancias excepcionales por razón de arraigo',
  EX32: 'Solicitud de autorización de residencia por circunstancias excepcionales',
} as const;

const VIA_LEGAL_MAP: Record<string, {
  formulario: 'EX31' | 'EX32';
  viaAccesoNew: string;
  tipoPermisoNew: string;
  idOpcionAutorizacion: string;
  codOpcionAutorizacion: string;
  _confidence: 'confirmed' | 'estimated' | 'unknown';
}> = {
  // ─── EX-32: DA 21ª (Reforma Llei estrangeria 2026) ─────────────
  'DA 21ª – Laboral': {
    formulario: 'EX32',
    viaAccesoNew: 'ARL', tipoPermisoNew: 'D21',
    idOpcionAutorizacion: '292', codOpcionAutorizacion: 'EX-32-1-01',
    _confidence: 'confirmed',  // HAR Marta + DOM EX-32
  },
  'DA 21ª – Familiar': {
    // "Permanecer en España junto con su unidad familiar" (radio DOM EX-32)
    formulario: 'EX32',
    viaAccesoNew: 'AUF', tipoPermisoNew: 'D21',
    idOpcionAutorizacion: '293', codOpcionAutorizacion: 'EX-32-1-02',
    _confidence: 'confirmed',  // DOM EX-32
  },
  'DA 21ª – Vulnerabilitat': {
    formulario: 'EX32',
    viaAccesoNew: 'ASV', tipoPermisoNew: 'D21',
    idOpcionAutorizacion: '294', codOpcionAutorizacion: 'EX-32-1-03',
    _confidence: 'confirmed',  // DOM EX-32
  },
  // ─── EX-31: DA 20ª (Sol·licitant Protecció Internacional) ──────
  'DA 20ª – Sol·licitant PI': {
    // "Solicitante de Protección Internacional con solicitud presentada
    //  antes del 01 de enero de 2026" (radio DOM EX-31)
    formulario: 'EX31',
    // viaAccesoNew/tipoPermisoNew: estimats (HTML EX-31 no porta atribut viaSup
    // visible — s'omplen via JS al click). Cal confirmar al primer submit real.
    viaAccesoNew: 'PRI', tipoPermisoNew: 'D20',
    idOpcionAutorizacion: '284', codOpcionAutorizacion: 'EX-31-1-01',
    _confidence: 'estimated',
  },
  'DA 20ª – Familiar de Sol·licitant PI': {
    // "Familiar de Solicitante de Protección Internacional" (radio DOM EX-31)
    formulario: 'EX31',
    viaAccesoNew: 'PRI', tipoPermisoNew: 'D20',
    idOpcionAutorizacion: '287', codOpcionAutorizacion: 'EX-31-1-04',
    _confidence: 'estimated',
  },
};

export { FORM_DES };

/** Sexe Airtable "H (home)" → Mercurio code (codis confirmats del select del form):
 *   0 = HOMBRE, 1 = MUJER, X = INDEFINIDO */
function mapSexo(s: string | undefined): string {
  if (!s) return '';
  if (s.startsWith('H')) return '0';
  if (s.startsWith('M')) return '1';
  if (s.startsWith('X')) return 'X';
  return '';
}

/** Estat civil Airtable "Casat/da (C)" → Mercurio "C" */
function mapEstadoCivil(s: string | undefined): string {
  if (!s) return '';
  const m = s.match(/\(([A-Z])\)/);
  return m ? m[1] : '';
}

/** Extreu codi entre parèntesis: "COLOMBIA (212)" → "212" */
function extractCode(s: any): string {
  if (typeof s !== 'string' || !s) return '';
  const m = s.match(/\(([A-Z0-9]+)\)\s*$/);
  return m ? m[1] : '';
}

/** Extreu codi de Tipus via Airtable "CALLE (ED)" → "ED" */
function mapTipoVia(s: string | undefined): string {
  return extractCode(s);
}

/** ISO date "1986-08-15" → "15/08/1986" */
function isoToEs(iso: string | undefined): string {
  if (!iso) return '';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** Get field, preferint la versió sufixada "X (Mercurio)" si existeix.
 *  Cas Nacionalitat / País naixement / Tipus via: Airtable té DOS camps —
 *  l'antic (text "COLOMBIA") i el nou (codi "COLOMBIA (212)"). Volem el nou.
 *  Per als camps que no tenen sufix, troba el plain igualment. */
function f(rec: AirtableCase, name: string): any {
  return rec.fields[`${name} (Mercurio)`] ?? rec.fields[name] ?? '';
}

/** First non-empty Airtable string value: nacionalitat or other singleSelect.
 *  Handles "MARRUECOS (348)" pattern. */
function fStr(rec: AirtableCase, name: string): string {
  const v = f(rec, name);
  return typeof v === 'string' ? v : '';
}

/**
 * Construeix el payload de 143 camps a partir d'un cas Airtable.
 *
 * @param rec       Cas Airtable principal (sol·licitant)
 * @param presentador Configuració del presentador (entitat + voluntari)
 * @param refRec    Cas referent (només per dependents — DA 21ª Familiar). Omitir si no aplica.
 */
export function airtableToMercurio(
  rec: AirtableCase,
  presentador: PresentadorConfig = REUS_REFUGI_DEFAULT_PRESENTADOR,
  refRec?: AirtableCase
): Record<string, string> {
  const viaLegal = fStr(rec, 'Via legal');
  const viaCfg = VIA_LEGAL_MAP[viaLegal] ?? VIA_LEGAL_MAP['DA 21ª – Laboral'];

  // Trim whitespace from name fields (DAYNER had "Dayner ")
  const nom = fStr(rec, 'Nom').trim().toUpperCase();
  const cog1 = fStr(rec, '1r cognom').trim().toUpperCase();
  const cog2 = fStr(rec, '2n cognom').trim().toUpperCase();

  const isDependent = !!refRec;

  // Determine reagrupante data when dependent
  const rea = isDependent && refRec ? buildReagrupante(refRec) : emptyReagrupante();

  // Decla3 logic: marcat només si hi ha activitat laboral declarada
  const activitatLaboral = fStr(rec, 'Activitat laboral descripció');
  const tipusContracte = fStr(rec, 'Tipus de contracte');
  const declaIntencio = activitatLaboral ||
    tipusContracte === 'Oferta ferma' ||
    tipusContracte === 'Declaració responsable';
  const chkDecla3 = declaIntencio ? 'true' : undefined;

  const formulario = viaCfg.formulario;

  return {
    // ─── Header / form metadata ────────────────────────────
    tipoSolicitud: 'INI',
    tipoSolicitudRI: 'E',
    tipoFormulario: formulario,
    tipoFormularioDes: FORM_DES[formulario],
    provincia: '43',
    tipoPermiso: '',
    viaAcceso: '',
    expedienteCaduca: '',
    expedientePregrabado: '',
    idExpediente: '',
    fechaCaducidad: '',
    fechaCaducidadExpCaduca: '',
    viaAccesoOld: '',
    viaAccesoNew: viaCfg.viaAccesoNew,
    tipoPermisoNew: viaCfg.tipoPermisoNew,
    codigoMeyss: '',
    tipoPermisoOld: '',
    idGesDocum: '',
    id: '',
    idInicial: '',
    idEmpresa: '',
    situacionProcede: '',
    idExtranjero: '',
    extReferenciaExtranjeroPolicia: '',
    idCatalogoOcupacionesEmpresa: '',
    actividadEmpresaOTrabajoCuentaPropia: '',
    domicilioEnExtranjero: '',
    reagrupanteDocumentoExpNuevo: '',
    filiacionFamiliar: '',
    codParentesco: isDependent ? mapParentesco(fStr(rec, 'Parentiu amb referent')) : '',
    dirParentescoFamDirecto: '',
    descripcionDesplegable: '',
    cod1: '',
    acompante: '',
    acompananteDocumento: '',
    acompananteTitulo: '',
    idOpcionAutorizacion: viaCfg.idOpcionAutorizacion,
    codOpcionAutorizacion: viaCfg.codOpcionAutorizacion,
    datosForAut: viaCfg.idOpcionAutorizacion,
    descActividadDecla3: activitatLaboral,
    // Camp dinàmic — només apareix al DOM si datosForAut=284 (DA 20ª PI).
    // El userscript farà fillament en 2 fases: primer datosForAut, esperar
    // injecció DOM, llavors expAsilo.
    expAsilo: fStr(rec, 'N.º expedient asil'),

    // ─── Decla checkboxes ───────────────────────────────────
    chkDecla1: 'true',
    _chkDecla1: 'on',
    chkDecla2: 'true',
    _chkDecla2: 'on',
    ...(chkDecla3 ? { chkDecla3 } : {}),
    _chkDecla3: 'on',
    docsAutoriza: '',
    docsDeniega: '',
    _chkConsientoConsultaDocumentos: 'on',

    // ─── Sol·licitant (ext*) ────────────────────────────────
    extPasaporte: fStr(rec, 'Núm. passaport'),
    extNie: fStr(rec, 'NIE'),
    extApellido1: cog1,
    extApellido2: cog2,
    extNombre: nom,
    extSexo: mapSexo(fStr(rec, 'Sexe')),
    extFechaNacimiento: isoToEs(fStr(rec, 'Data de naixement')),
    extEstadoCivil: mapEstadoCivil(fStr(rec, 'Estat civil')),
    extLugarNacimiento: fStr(rec, 'Lloc de naixement').toUpperCase(),
    // País naixement: si buit, default a Nacionalitat (assumir nascut al país
    // d'origen — cas habitual 95%+). El voluntari pot sobreescriure manualment.
    extCodigoPaisNacimiento: extractCode(fStr(rec, 'País naixement'))
                          || extractCode(fStr(rec, 'Nacionalitat')),
    extCodigoNacionalidad: extractCode(fStr(rec, 'Nacionalitat')),
    extPadre: fStr(rec, 'Nom del pare'),
    extMadre: fStr(rec, 'Nom de la mare'),
    _chkIncapacidad: 'on',
    extCatalogoNacional: '',
    extTipoVia: mapTipoVia(fStr(rec, 'Tipus via')),
    extDomicilio: fStr(rec, 'Nom carrer'),
    extNumero: fStr(rec, 'Número') || (fStr(rec, 'Nom carrer') ? 'SN' : ''),
    extPiso: fStr(rec, 'Pis'),
    extLetra: fStr(rec, 'Lletra'),
    extEscalera: fStr(rec, 'Escala'),
    extBloque: fStr(rec, 'Bloc'),
    extKilometro: fStr(rec, 'Km'),
    extHectometro: fStr(rec, 'Hm'),
    extCodigoProvincia: '43',
    extCodigoMunicipio: extractCode(fStr(rec, 'Municipi Mercurio')),
    extCodigoLocalidad: fStr(rec, 'Localitat Mercurio') || '000000',
    extCodigoPostal: fStr(rec, 'CP'),
    extTelefono: '',
    extTelefonoMovil: fStr(rec, 'Telèfon').replace(/\D/g, ''),
    extEmail: fStr(rec, 'Email'),
    extNombreRepresentante: '',
    extTipodocumentoRepresentante: 'NF',
    extNieRepresentante: '',
    extTituloRepresentante: '',
    extVinculoRepresentante: '',

    // ─── Reagrupante (cas referent) ─────────────────────────
    ...rea,

    // ─── Doc ────────────────────────────────────────────────
    docInteresado: '',
    docRepresentante: presentador.nie,

    // ─── Presentador ────────────────────────────────────────
    preNombrePresentador: presentador.nombre,
    preTipodocumentoPresentador: presentador.tipoDoc,
    preNiePresentador: presentador.nie,
    preTipoViaPresentador: '',
    preDomicilioPresentador: '',
    preNumeroPresentador: 'SN',
    prePisoPresentador: '',
    preLetraPresentador: '',
    preEscaleraPresentador: '',
    preBloquePresentador: '',
    preKilometroPresentador: '',
    preHectometroPresentador: '',
    preCodigoProvinciaPresentador: '',
    preCodigoMunicipioPresentador: '',
    preCodigoLocalidadPresentador: '',
    preCodigoPostalPresentador: '',
    preTelefonoPresentador: '',
    preTelefonoMovilPresentador: presentador.mobil,
    preEmailPresentador: presentador.email,
    preNombreRepresentantePresentador: '',
    preTipodocumentoRepresentantePresentador: '',
    preNieRepresentantePresentador: '',
    preTituloRepresentantePresentador: '',

    // ─── Notificació ────────────────────────────────────────
    notNombreNotificacion: presentador.nombre,
    notTipodocumentoNotificacion: presentador.tipoDoc,
    notNieNotificacion: presentador.nie,
    notEmailNotificacion: presentador.email,
    notTelefonoMovilNotificacion: presentador.mobil,
    chkConsentimientoNotificacion: 'true',
    _chkConsentimientoNotificacion: 'on',
  };
}

function mapParentesco(p: string): string {
  // catàleg parental Mercurio — codis hipotètics, cal validar
  switch (p) {
    case 'Cònjuge / parella registrada': return '02';
    case 'Fill/a': return '03';
    case 'Ascendent': return '01';
    case 'Altre': return '07';
    default: return '';
  }
}

function buildReagrupante(refRec: AirtableCase): Record<string, string> {
  const f = (n: string) => {
    // Prefer (Mercurio) suffix — same priority com a la f() principal
    const v = refRec.fields[`${n} (Mercurio)`] ?? refRec.fields[n] ?? '';
    return typeof v === 'string' ? v : '';
  };
  return {
    reaPasaporteReagrupante: f('Núm. passaport'),
    reaNieReagrupante: f('NIE'),
    reaApellido1Reagrupante: f('1r cognom').trim().toUpperCase(),
    reaApellido2Reagrupante: f('2n cognom').trim().toUpperCase(),
    reaNombreReagrupante: f('Nom').trim().toUpperCase(),
    reaSexoReagrupante: mapSexo(f('Sexe')),
    reaFechaNacimientoReagrupante: isoToEs(f('Data de naixement')),
    reaEstadoCivilReagrupante: mapEstadoCivil(f('Estat civil')),
    reaLugarNacimientoReagrupante: f('Lloc de naixement').toUpperCase(),
    reaCodigoPaisNacimientoReagrupante: extractCode(f('País naixement')),
    reaCodigoNacionalidadReagrupante: extractCode(f('Nacionalitat')),
    reaPadreReagrupante: f('Nom del pare'),
    reaMadreReagrupante: f('Nom de la mare'),
    reaParentescoReagrupante: '',
    reaTipoViaReagrupante: mapTipoVia(f('Tipus via')),
    reaDomicilioReagrupante: f('Nom carrer'),
    reaNumeroReagrupante: f('Número'),
    reaPisoReagrupante: f('Pis'),
    reaLetraReagrupante: f('Lletra'),
    reaEscaleraReagrupante: f('Escala'),
    reaBloqueReagrupante: f('Bloc'),
    reaKilometroReagrupante: f('Km'),
    reaHectometroReagrupante: f('Hm'),
    reaCodigoProvinciaReagrupante: '43',
    reaCodigoMunicipioReagrupante: extractCode(f('Municipi Mercurio')),
    reaCodigoLocalidadReagrupante: f('Localitat Mercurio') || '000000',
    reaCodigoPostalReagrupante: f('CP'),
  };
}

function emptyReagrupante(): Record<string, string> {
  return {
    reaPasaporteReagrupante: '', reaNieReagrupante: '', reaApellido1Reagrupante: '',
    reaApellido2Reagrupante: '', reaNombreReagrupante: '', reaSexoReagrupante: '',
    reaFechaNacimientoReagrupante: '', reaEstadoCivilReagrupante: '',
    reaLugarNacimientoReagrupante: '', reaCodigoPaisNacimientoReagrupante: '',
    reaCodigoNacionalidadReagrupante: '', reaPadreReagrupante: '', reaMadreReagrupante: '',
    reaParentescoReagrupante: '', reaTipoViaReagrupante: '', reaDomicilioReagrupante: '',
    reaNumeroReagrupante: '', reaPisoReagrupante: '', reaLetraReagrupante: '',
    reaEscaleraReagrupante: '', reaBloqueReagrupante: '', reaKilometroReagrupante: '',
    reaHectometroReagrupante: '',
    // Buit (no-dependent). Si fos 43, fariem un canvi a rea provincia que
    // pot fer rebotar handlers globals de Mercurio i resetejar muni d'ext.
    reaCodigoProvinciaReagrupante: '',
    reaCodigoMunicipioReagrupante: '', reaCodigoLocalidadReagrupante: '',
    reaCodigoPostalReagrupante: '',
  };
}

/** Detecta quin form Mercurio (EX31 vs EX32) correspon a un cas Airtable */
export function getFormulario(rec: AirtableCase): 'EX31' | 'EX32' {
  const viaLegal = fStr(rec, 'Via legal');
  return VIA_LEGAL_MAP[viaLegal]?.formulario ?? 'EX32';
}

export { VIA_LEGAL_MAP };
