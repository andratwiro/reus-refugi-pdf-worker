/**
 * Schema dels 143 camps del POST `salvarSolicitud.html` per al formulari EX-32.
 *
 * Cada camp té un "kind" que defineix la seva validació:
 *   - constant     : valor exacte hardcoded
 *   - empty        : ha de ser cadena buida
 *   - text_required: text no buit
 *   - text_optional: text qualsevol (inclòs buit)
 *   - email        : format email si no buit
 *   - date_es      : DD/MM/YYYY si no buit
 *   - cp           : 5 dígits si no buit
 *   - phone        : 9 dígits si no buit
 *   - catalog      : valor dins d'un Set (catàleg estàtic)
 *   - municipi_tgn : codi municipi vàlid (Tarragona)
 *   - localitat    : codi localitat vàlid per al municipi triat
 *   - chk_on       : "on" sempre (shadow d'un checkbox)
 *   - chk_bool     : "true" si marcat, sinó absent
 *   - opcion_aut   : codi numèric d'opció d'autorització
 *   - cod_aut      : format EX-XX-N-NN
 *   - numeric      : només dígits
 */

import {
  SEXO, ESTADO_CIVIL, TIPO_DOC, VINCULO_REP, TIPO_VIA, CODIGO_PAIS,
  CODIGO_PROVINCIA, VIA_ACCESO_NEW, TIPO_PERMISO_NEW, COD_PARENTESCO,
  MUNICIPI_TARRAGONA, LOCALITATS_PER_MUNICIPI,
} from '../../src/mercurio/catalogs.js';

export type FieldKind =
  | { type: 'constant'; value: string }
  | { type: 'empty' }
  | { type: 'text_required'; max?: number }
  | { type: 'text_optional'; max?: number }
  | { type: 'email_optional' }
  | { type: 'email_required' }
  | { type: 'date_es_required' }
  | { type: 'date_es_optional' }
  | { type: 'cp' }
  | { type: 'phone_optional' }
  | { type: 'catalog'; allowed: Set<string>; allowEmpty?: boolean }
  | { type: 'municipi_tgn' }
  | { type: 'localitat'; municipiField: string }
  | { type: 'chk_on' }
  | { type: 'chk_bool' }
  | { type: 'opcion_aut' }
  | { type: 'cod_aut' }
  | { type: 'numeric_optional' };

export const SCHEMA: Record<string, FieldKind> = {
  // ─── Header / form metadata (38) ──────────────────────────────────
  tipoSolicitud: { type: 'constant', value: 'INI' },
  tipoSolicitudRI: { type: 'constant', value: 'E' },
  // tipoFormulario admet EX31 o EX32 segons el cas
  tipoFormulario: { type: 'catalog', allowed: new Set(['EX31', 'EX32']) },
  tipoFormularioDes: { type: 'text_required' },
  provincia: { type: 'constant', value: '43' },
  tipoPermiso: { type: 'empty' },
  viaAcceso: { type: 'empty' },
  expedienteCaduca: { type: 'empty' },
  expedientePregrabado: { type: 'empty' },
  idExpediente: { type: 'empty' },
  fechaCaducidad: { type: 'empty' },
  fechaCaducidadExpCaduca: { type: 'empty' },
  viaAccesoOld: { type: 'empty' },
  viaAccesoNew: { type: 'catalog', allowed: VIA_ACCESO_NEW },
  tipoPermisoNew: { type: 'catalog', allowed: TIPO_PERMISO_NEW, allowEmpty: true },
  codigoMeyss: { type: 'empty' },
  tipoPermisoOld: { type: 'empty' },
  idGesDocum: { type: 'empty' },
  id: { type: 'empty' },
  idInicial: { type: 'empty' },
  idEmpresa: { type: 'empty' },
  situacionProcede: { type: 'empty' },
  idExtranjero: { type: 'empty' },
  extReferenciaExtranjeroPolicia: { type: 'empty' },
  idCatalogoOcupacionesEmpresa: { type: 'empty' },
  actividadEmpresaOTrabajoCuentaPropia: { type: 'empty' },
  domicilioEnExtranjero: { type: 'empty' },
  reagrupanteDocumentoExpNuevo: { type: 'empty' },
  filiacionFamiliar: { type: 'empty' },
  codParentesco: { type: 'catalog', allowed: COD_PARENTESCO, allowEmpty: true },
  dirParentescoFamDirecto: { type: 'empty' },
  descripcionDesplegable: { type: 'empty' },
  cod1: { type: 'empty' },
  acompante: { type: 'empty' },
  acompananteDocumento: { type: 'empty' },
  acompananteTitulo: { type: 'empty' },
  idOpcionAutorizacion: { type: 'opcion_aut' },
  codOpcionAutorizacion: { type: 'cod_aut' },
  datosForAut: { type: 'opcion_aut' },
  descActividadDecla3: { type: 'text_optional' },

  // ─── Checkboxes declaracions ──────────────────────────────────────
  chkDecla1: { type: 'chk_bool' },
  _chkDecla1: { type: 'chk_on' },
  chkDecla2: { type: 'chk_bool' },
  _chkDecla2: { type: 'chk_on' },
  _chkDecla3: { type: 'chk_on' },
  _chkConsientoConsultaDocumentos: { type: 'chk_on' },
  docsAutoriza: { type: 'text_optional' },
  docsDeniega: { type: 'text_optional' },

  // ─── Sol·licitant (ext*) — 36 ────────────────────────────────────
  extPasaporte: { type: 'text_optional', max: 30 },     // o NIE
  extNie: { type: 'text_optional', max: 12 },
  extApellido1: { type: 'text_required', max: 40 },
  extApellido2: { type: 'text_optional', max: 40 },
  extNombre: { type: 'text_required', max: 40 },
  extSexo: { type: 'catalog', allowed: SEXO },
  extFechaNacimiento: { type: 'date_es_required' },
  extEstadoCivil: { type: 'catalog', allowed: ESTADO_CIVIL },
  extLugarNacimiento: { type: 'text_required', max: 40 },
  extCodigoPaisNacimiento: { type: 'catalog', allowed: CODIGO_PAIS, allowEmpty: true },
  extCodigoNacionalidad: { type: 'catalog', allowed: CODIGO_PAIS },
  extPadre: { type: 'text_optional', max: 40 },
  extMadre: { type: 'text_optional', max: 40 },
  _chkIncapacidad: { type: 'chk_on' },
  extCatalogoNacional: { type: 'empty' },
  extTipoVia: { type: 'catalog', allowed: TIPO_VIA },
  extDomicilio: { type: 'text_required', max: 80 },
  extNumero: { type: 'text_required', max: 8 },
  extPiso: { type: 'text_optional', max: 4 },
  extLetra: { type: 'text_optional', max: 4 },
  extEscalera: { type: 'text_optional', max: 4 },
  extBloque: { type: 'text_optional', max: 4 },
  extKilometro: { type: 'text_optional', max: 6 },
  extHectometro: { type: 'text_optional', max: 6 },
  extCodigoProvincia: { type: 'constant', value: '43' },
  extCodigoMunicipio: { type: 'municipi_tgn' },
  extCodigoLocalidad: { type: 'localitat', municipiField: 'extCodigoMunicipio' },
  extCodigoPostal: { type: 'cp' },
  extTelefono: { type: 'phone_optional' },
  extTelefonoMovil: { type: 'phone_optional' },
  extEmail: { type: 'email_optional' },
  extNombreRepresentante: { type: 'text_optional', max: 80 },
  extTipodocumentoRepresentante: { type: 'catalog', allowed: TIPO_DOC, allowEmpty: true },
  extNieRepresentante: { type: 'text_optional', max: 12 },
  extTituloRepresentante: { type: 'text_optional', max: 40 },
  extVinculoRepresentante: { type: 'catalog', allowed: VINCULO_REP, allowEmpty: true },

  // ─── Reagrupante / cas referent (rea*) — 28 — tots optional ──────
  reaPasaporteReagrupante: { type: 'text_optional' },
  reaNieReagrupante: { type: 'text_optional' },
  reaApellido1Reagrupante: { type: 'text_optional' },
  reaApellido2Reagrupante: { type: 'text_optional' },
  reaNombreReagrupante: { type: 'text_optional' },
  reaSexoReagrupante: { type: 'catalog', allowed: SEXO, allowEmpty: true },
  reaFechaNacimientoReagrupante: { type: 'date_es_optional' },
  reaEstadoCivilReagrupante: { type: 'catalog', allowed: ESTADO_CIVIL, allowEmpty: true },
  reaLugarNacimientoReagrupante: { type: 'text_optional' },
  reaCodigoPaisNacimientoReagrupante: { type: 'catalog', allowed: CODIGO_PAIS, allowEmpty: true },
  reaCodigoNacionalidadReagrupante: { type: 'catalog', allowed: CODIGO_PAIS, allowEmpty: true },
  reaPadreReagrupante: { type: 'text_optional' },
  reaMadreReagrupante: { type: 'text_optional' },
  reaParentescoReagrupante: { type: 'catalog', allowed: COD_PARENTESCO, allowEmpty: true },
  reaTipoViaReagrupante: { type: 'catalog', allowed: TIPO_VIA, allowEmpty: true },
  reaDomicilioReagrupante: { type: 'text_optional' },
  reaNumeroReagrupante: { type: 'text_optional' },
  reaPisoReagrupante: { type: 'text_optional' },
  reaLetraReagrupante: { type: 'text_optional' },
  reaEscaleraReagrupante: { type: 'text_optional' },
  reaBloqueReagrupante: { type: 'text_optional' },
  reaKilometroReagrupante: { type: 'text_optional' },
  reaHectometroReagrupante: { type: 'text_optional' },
  reaCodigoProvinciaReagrupante: { type: 'catalog', allowed: CODIGO_PROVINCIA, allowEmpty: true },
  reaCodigoMunicipioReagrupante: { type: 'text_optional' }, // cross-province, no validem catàleg
  reaCodigoLocalidadReagrupante: { type: 'text_optional' },
  reaCodigoPostalReagrupante: { type: 'text_optional' },

  // ─── Documents (4) ───────────────────────────────────────────────
  docInteresado: { type: 'text_optional' },
  docRepresentante: { type: 'text_optional', max: 12 },

  // ─── Presentador (pre*) — 23 ─────────────────────────────────────
  preNombrePresentador: { type: 'text_required', max: 80 },
  preTipodocumentoPresentador: { type: 'catalog', allowed: TIPO_DOC },
  preNiePresentador: { type: 'text_required', max: 12 },
  preTipoViaPresentador: { type: 'catalog', allowed: TIPO_VIA, allowEmpty: true },
  preDomicilioPresentador: { type: 'text_optional' },
  preNumeroPresentador: { type: 'text_optional' },
  prePisoPresentador: { type: 'text_optional' },
  preLetraPresentador: { type: 'text_optional' },
  preEscaleraPresentador: { type: 'text_optional' },
  preBloquePresentador: { type: 'text_optional' },
  preKilometroPresentador: { type: 'text_optional' },
  preHectometroPresentador: { type: 'text_optional' },
  preCodigoProvinciaPresentador: { type: 'catalog', allowed: CODIGO_PROVINCIA, allowEmpty: true },
  preCodigoMunicipioPresentador: { type: 'text_optional' },
  preCodigoLocalidadPresentador: { type: 'text_optional' },
  preCodigoPostalPresentador: { type: 'text_optional' },
  preTelefonoPresentador: { type: 'phone_optional' },
  preTelefonoMovilPresentador: { type: 'phone_optional' },
  preEmailPresentador: { type: 'email_required' },
  preNombreRepresentantePresentador: { type: 'text_optional' },
  preTipodocumentoRepresentantePresentador: { type: 'catalog', allowed: TIPO_DOC, allowEmpty: true },
  preNieRepresentantePresentador: { type: 'text_optional' },
  preTituloRepresentantePresentador: { type: 'text_optional' },

  // ─── Notificació (not*) — 5 + 2 chk ──────────────────────────────
  // ─── Camps dinàmics (apareixen segons radio supuesto) ────
  /** Número expediente OAR. Apareix només si datosForAut=284 (DA 20ª PI). */
  expAsilo: { type: 'text_optional', max: 20 },

  notNombreNotificacion: { type: 'text_required', max: 80 },
  notTipodocumentoNotificacion: { type: 'catalog', allowed: TIPO_DOC },
  notNieNotificacion: { type: 'text_required', max: 12 },
  notEmailNotificacion: { type: 'email_required' },
  notTelefonoMovilNotificacion: { type: 'phone_optional' },
  chkConsentimientoNotificacion: { type: 'chk_bool' },
  _chkConsentimientoNotificacion: { type: 'chk_on' },
};

/* Sanity check: el schema cobreix exactament 143 camps */
const COUNT = Object.keys(SCHEMA).length;
if (COUNT !== 143) {
  console.warn(`[schema] camps definits: ${COUNT}, esperats: 143`);
}

// ─── VALIDADOR ───────────────────────────────────────────────────────

export type FieldStatus =
  | 'ok'
  | 'missing'           // camp absent del POST
  | 'invalid_constant'  // valor != constant esperada
  | 'invalid_format'    // format incorrecte (date, email, etc.)
  | 'invalid_catalog'   // valor fora del catàleg
  | 'invalid_localitat' // localitat no vàlida per al municipi
  | 'unknown_field';    // camp rebut però no està al schema

export interface FieldReport {
  status: FieldStatus;
  received?: string;
  expected?: string;
  reason?: string;
}

export interface ValidationReport {
  ok: boolean;
  totalFields: number;
  bySchema: number;
  byStatus: Record<FieldStatus, number>;
  fields: Record<string, FieldReport>;
  unknownFields: string[];
}

const RE_DATE = /^\d{2}\/\d{2}\/\d{4}$/;
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RE_CP = /^\d{5}$/;
const RE_PHONE = /^\d{9}$/;
const RE_NUMERIC = /^\d+$/;
const RE_OPCION_AUT = /^\d{1,5}$/;
const RE_COD_AUT = /^EX-\d{2}-\d{1,2}-\d{2}$/;

export function validatePostBody(body: Record<string, string>): ValidationReport {
  const fields: Record<string, FieldReport> = {};
  const unknownFields: string[] = [];

  // 1. Validate every field declared in schema
  for (const [name, kind] of Object.entries(SCHEMA)) {
    const v = body[name];
    fields[name] = validateOne(name, kind, v, body);
  }

  // 2. Detect extra fields not in schema
  for (const k of Object.keys(body)) {
    if (!(k in SCHEMA)) {
      unknownFields.push(k);
      fields[k] = { status: 'unknown_field', received: body[k] };
    }
  }

  // 3. Aggregate
  const byStatus: Record<FieldStatus, number> = {
    ok: 0, missing: 0, invalid_constant: 0, invalid_format: 0,
    invalid_catalog: 0, invalid_localitat: 0, unknown_field: 0,
  };
  for (const r of Object.values(fields)) byStatus[r.status]++;

  return {
    ok: byStatus.ok === Object.keys(SCHEMA).length && unknownFields.length === 0,
    totalFields: Object.keys(fields).length,
    bySchema: Object.keys(SCHEMA).length,
    byStatus,
    fields,
    unknownFields,
  };
}

function validateOne(
  name: string,
  kind: FieldKind,
  v: string | undefined,
  body: Record<string, string>
): FieldReport {
  // chk_bool is special: absent OR "true" both OK
  if (kind.type === 'chk_bool') {
    if (v === undefined) return { status: 'ok', received: '<absent>' };
    if (v === 'true') return { status: 'ok', received: v };
    return { status: 'invalid_format', received: v, expected: 'true or absent' };
  }

  if (v === undefined) return { status: 'missing' };

  switch (kind.type) {
    case 'constant':
      return v === kind.value
        ? { status: 'ok', received: v }
        : { status: 'invalid_constant', received: v, expected: kind.value };

    case 'empty':
      return v === ''
        ? { status: 'ok', received: v }
        : { status: 'invalid_constant', received: v, expected: '<empty>' };

    case 'text_required':
      if (v === '') return { status: 'invalid_format', received: v, reason: 'required' };
      if (kind.max && v.length > kind.max)
        return { status: 'invalid_format', received: v, reason: `max ${kind.max} chars` };
      return { status: 'ok', received: v };

    case 'text_optional':
      if (kind.max && v.length > kind.max)
        return { status: 'invalid_format', received: v, reason: `max ${kind.max} chars` };
      return { status: 'ok', received: v };

    case 'email_required':
      if (v === '') return { status: 'invalid_format', received: v, reason: 'required' };
      return RE_EMAIL.test(v) ? { status: 'ok', received: v } : { status: 'invalid_format', received: v, reason: 'email format' };

    case 'email_optional':
      if (v === '') return { status: 'ok', received: v };
      return RE_EMAIL.test(v) ? { status: 'ok', received: v } : { status: 'invalid_format', received: v, reason: 'email format' };

    case 'date_es_required':
      if (v === '') return { status: 'invalid_format', received: v, reason: 'required DD/MM/YYYY' };
      return RE_DATE.test(v) ? { status: 'ok', received: v } : { status: 'invalid_format', received: v, reason: 'DD/MM/YYYY' };

    case 'date_es_optional':
      if (v === '') return { status: 'ok', received: v };
      return RE_DATE.test(v) ? { status: 'ok', received: v } : { status: 'invalid_format', received: v, reason: 'DD/MM/YYYY' };

    case 'cp':
      if (v === '') return { status: 'invalid_format', received: v, reason: 'required 5 digits' };
      return RE_CP.test(v) ? { status: 'ok', received: v } : { status: 'invalid_format', received: v, reason: '5 digits' };

    case 'phone_optional':
      if (v === '') return { status: 'ok', received: v };
      return RE_PHONE.test(v) ? { status: 'ok', received: v } : { status: 'invalid_format', received: v, reason: '9 digits' };

    case 'catalog':
      if (v === '' && kind.allowEmpty) return { status: 'ok', received: v };
      return kind.allowed.has(v)
        ? { status: 'ok', received: v }
        : { status: 'invalid_catalog', received: v, reason: 'not in catalog' };

    case 'municipi_tgn':
      return MUNICIPI_TARRAGONA.has(v)
        ? { status: 'ok', received: v }
        : { status: 'invalid_catalog', received: v, reason: 'not a Tarragona municipi code' };

    case 'localitat': {
      const muni = body[kind.municipiField];
      if (!muni || !MUNICIPI_TARRAGONA.has(muni)) {
        // can't validate if municipi is invalid
        return { status: 'ok', received: v, reason: 'parent municipi invalid; skipped' };
      }
      const allowed = LOCALITATS_PER_MUNICIPI.get(muni);
      if (!allowed) return { status: 'ok', received: v };
      return allowed.has(v)
        ? { status: 'ok', received: v }
        : { status: 'invalid_localitat', received: v, reason: `not valid for municipi ${muni}` };
    }

    case 'chk_on':
      return v === 'on'
        ? { status: 'ok', received: v }
        : { status: 'invalid_constant', received: v, expected: 'on' };

    case 'opcion_aut':
      return RE_OPCION_AUT.test(v)
        ? { status: 'ok', received: v }
        : { status: 'invalid_format', received: v, reason: 'numeric 1-5 digits' };

    case 'cod_aut':
      return RE_COD_AUT.test(v)
        ? { status: 'ok', received: v }
        : { status: 'invalid_format', received: v, reason: 'EX-NN-N-NN' };

    case 'numeric_optional':
      if (v === '') return { status: 'ok', received: v };
      return RE_NUMERIC.test(v) ? { status: 'ok', received: v } : { status: 'invalid_format', received: v, reason: 'numeric' };
  }
}
