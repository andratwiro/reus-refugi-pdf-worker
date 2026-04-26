/**
 * Catàlegs estàtics extrets del HTML del form nuevaSolicitud-EX32.html
 * (capturat 2026-04-26 a captures/nuevaSolicitud-EX32.html).
 *
 * Aquests valors són els codis VÀLIDS que Mercurio accepta per cada select
 * estàtic. Si el POST de salvarSolicitud envia un codi fora d'aquestes llistes,
 * el mock ho marca com `invalid_catalog`.
 *
 * Els catàlegs dinàmics (municipi, localitat) viuen a getLocalidades-43-all.json.
 */

/** extSexo (codis del form): 0=Hombre, 1=Mujer, X=Indefinido */
export const SEXO = new Set(['0', '1', 'X']);

/** extEstadoCivil: S=Soltero, C=Casado, D=Divorciado, V=Viudo, P=Separado, X=Otro/Desconocido */
export const ESTADO_CIVIL = new Set(['S', 'C', 'D', 'V', 'P', 'X', 'N']);

/** Tipus document Mercurio: NF=DNI, TU=NIE, PA=Passaport (confirmat DOM EX-31).
 *  Si Mercurio admet CIF (per entitats), és un altre catàleg, no aquest. */
export const TIPO_DOC = new Set(['NF', 'TU', 'PA']);

/** extVinculoRepresentante (confirmat DOM EX-31): només per dependents familiars.
 *  No té opció per a entitat RECEX/Persona Jurídica al EX-31. */
export const VINCULO_REP = new Set(['', 'HB', 'HA', 'HD', 'MT']);

/** Tipus de via — codis 2-3 lletres del catàleg Mercurio */
export const TIPO_VIA = new Set([
  'AD', 'AF', 'AH', 'AK', 'AR', 'AX', 'AZ', 'BF', 'BH', 'BK', 'BZ', 'CF', 'CK',
  'CT', 'CV', 'DR', 'DV', 'ED', 'EF', 'EH', 'EK', 'EP', 'EV', 'FF', 'FK', 'FR',
  'FT', 'FV', 'GB', 'GD', 'GH', 'GK', 'GM', 'GR', 'GT', 'GV', 'GX', 'HD', 'HH',
  'ZZ', 'HJ', 'HR', 'HZ', 'JM', 'JS', 'JT', 'KT', 'GA', 'LH', 'LK', 'LP', 'NZ',
  'PD', 'PX', 'QD', 'QE', 'QG', 'QK', 'QM', 'QR', 'QX', 'QZ', 'RB', 'RZ', 'SB',
  'SF', 'SH', 'SK', 'PG', 'TB', 'TF', 'TM', 'TX', 'TZ', 'UM', 'UT', 'UZ', 'VD',
  'VF', 'SD', 'VV', 'VX', 'WH', 'WK', 'WT', 'WX', 'XD', 'XR', 'YB', 'YC', 'YD',
  'YF', '2', '1', 'YH', 'YV', 'YZ', 'ZD',
]);

/** Codis país (extCodigoNacionalidad i extCodigoPaisNacimiento) */
export const CODIGO_PAIS = new Set([
  '401', '102', '103', '133', '301', '258', '255', '200', '403', '304', '202',
  '142', '257', '500', '104', '143', '203', '405', '432', '205', '105', '207',
  '407', '144', '204', '156', '305', '206', '409', '134', '303', '321', '315',
  '402', '308', '208', '372', '157', '210', '406', '107', '136', '212', '312',
  '460', '410', '314', '214', '140', '216', '108', '317', '217', '222', '300',
  '220', '429', '384', '158', '141', '109', '224', '137', '318', '550', '411',
  '110', '111', '320', '323', '145', '322', '113', '228', '328', '325', '324',
  '225', '230', '232', '114', '412', '414', '413', '415', '115', '116', '311',
  '436', '520', '349', '551', '417', '117', '233', '416', '419', '146', '336',
  '147', '501', '421', '418', '337', '138', '423', '342', '344', '118', '139',
  '119', '463', '159', '354', '425', '346', '347', '120', '348', '350', '234',
  '525', '148', '121', '427', '351', '400', '353', '541', '420', '236', '360',
  '352', '999', '122', '540', '444', '998', '123', '424', '441', '238', '542',
  '240', '242', '124', '125', '244', '431', '112', '310', '302', '229', '160',
  '566', '155', '380', '218', '367', '355', '306', '127', '149', '552', '256',
  '135', '254', '253', '361', '362', '363', '364', '426', '433', '365', '404',
  '368', '369', '128', '129', '250', '371', '154', '408', '370', '428', '465',
  '374', '554', '245', '378', '151', '130', '560', '152', '358', '246', '153',
  '565', '248', '430', '434', '382', '357',
]);

/** Codis província — Mercurio té 53 (totes les espanyoles + Ceuta/Melilla) */
export const CODIGO_PROVINCIA = new Set([
  '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13',
  '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26',
  '27', '28', '29', '30', '31', '32', '33', '34', '35', '36', '37', '38', '39',
  '40', '41', '42', '43', '44', '45', '46', '47', '48', '49', '50', '51', '52',
]);

/** viaAccesoNew — codis confirmats del DOM del form EX-32 (2026-04-26) */
export const VIA_ACCESO_NEW = new Set([
  'ARL',  // Haber trabajado / contrato (DA 21ª Laboral)
  'AUF',  // Permanecer junto unidad familiar (DA 21ª Familiar)
  'ASV',  // Encontrarse en situación de vulnerabilidad (DA 21ª Vulnerabilitat)
  'HNA',  // Hijo menor nacido en España
  'NNA',  // Hijo menor no nacido en España
  'ASF',  // Familiar de Sol·licitant DA 21
  'PAL',  // Pròrroga búsqueda activa de empleo
  'PAX',  // Pròrroga extraordinària per malaltia/discapacitat/jubilació
  'PRI',  // Sol·licitant Protecció Internacional (DA 20ª) — només a EX-31
]);

/** tipoPermisoNew — DA20/DA21 i variants */
export const TIPO_PERMISO_NEW = new Set(['D20', 'D21', '']);

/** codParentesco — codis observats (catàleg parental Mercurio) */
export const COD_PARENTESCO = new Set(['', '01', '02', '03', '04', '05', '06', '07']);

/** Pisos i escales — extreta del form (65 i 36 opcions). Per ara permissive: */
export const PISO_VALIDO = (v: string) => v === '' || /^[0-9A-Z]{1,3}$/i.test(v);
export const ESCALERA_VALIDO = (v: string) => v === '' || /^[0-9A-Z]{1,2}$/i.test(v);

/** Carrega la llista de municipis i localitats vàlides per a Tarragona (43)
 *  des d'un JSON local. Funciona tant amb tsx (Node) com amb Cloudflare Workers
 *  (que també suporten ESM JSON imports). */
// resolveJsonModule habilitat al tsconfig (Node + Cloudflare Workers el suporten)
import LOC_JSON from './data/localidades-43.json';

interface LocInfo { name: string; resultado?: string; }
const munis: { code: string; name: string }[] = (LOC_JSON as any).municipios;
const localidades: Record<string, LocInfo> = (LOC_JSON as any).localidades;

export const MUNICIPI_TARRAGONA = new Set<string>(
  munis.map(m => String(m.code))
);

/** Map municipi → set de localitats vàlides */
export const LOCALITATS_PER_MUNICIPI = new Map<string, Set<string>>();
for (const [munCode, info] of Object.entries(localidades)) {
  if (!info.resultado) continue;
  const codes = [...info.resultado.matchAll(/value="(\d{6})"/g)].map(m => m[1]);
  LOCALITATS_PER_MUNICIPI.set(String(munCode), new Set(codes));
}

/** Llista municipis exposable (pels endpoints/userscript que vulguin omplir
 *  un autocomplete). */
export const MUNICIPIOS_TARRAGONA: { code: string; name: string }[] = munis;
