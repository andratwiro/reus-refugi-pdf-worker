/**
 * Mercurio mock server.
 *
 * Replica les rutes mínimes de https://mercurio.delegaciondelgobierno.gob.es
 * necessàries per provar el userscript de Reus Refugi sense xarxa externa.
 *
 * Rutes implementades:
 *   GET  /mercurio/nuevaSolicitud-EX32.html   → form HTML real (capturat)
 *   POST /mercurio/nuevaSolicitud-EX32.html   → idem (alguns flows del HAR són POST)
 *   GET  /mercurio/resources/...              → assets estàtics del form
 *   GET  /mercurio/img/...                    → idem
 *   POST /mercurio/util/getProvincias         → no-op (no usat per Reus Refugi)
 *   POST /mercurio/util/getMunicipios/:prov   → JSON capturat
 *   POST /mercurio/util/getLocalidades/:prov/:mun → JSON capturat
 *   POST /mercurio/salvarSolicitud.html       → valida 143 camps, retorna report
 *   GET  /mercurio/finalizacionSolicitud.html → pàgina d'èxit (post-302)
 *   POST /mercurio/uploadDocumento            → multipart, valida parts
 *
 * Variables d'entorn:
 *   PORT (default 3001)
 */

import express from 'express';
import multer from 'multer';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { validatePostBody } from './schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CAPTURES = resolve(__dirname, '../../../captures');

const app = express();
const PORT = Number(process.env.PORT) || 3001;

// Body parsers
app.use(express.urlencoded({ extended: false, limit: '5mb' }));
app.use(express.json({ limit: '5mb' }));

// CORS-friendly logging middleware
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString().slice(11, 19)} ${req.method} ${req.url}`);
  next();
});

// ─── Form HTML (EX-31 + EX-32) ────────────────────────────────────────
function loadForm(filename: string): string {
  let html = readFileSync(join(CAPTURES, filename), 'utf-8');
  // Strip CSP meta tag (impedeix que jQuery/scripts in-line del form funcionin)
  html = html.replace(/<meta[^>]*Content-Security-Policy[^>]*>/gi, '');
  return html;
}
const FORM_EX32 = loadForm('nuevaSolicitud-EX32.html');
const FORM_EX31 = loadForm('nuevaSolicitud-ex31.html');

app.get('/mercurio/nuevaSolicitud-EX32.html', (_req, res) => res.type('html').send(FORM_EX32));
app.post('/mercurio/nuevaSolicitud-EX32.html', (_req, res) => res.type('html').send(FORM_EX32));
app.get('/mercurio/nuevaSolicitud-EX31.html', (_req, res) => res.type('html').send(FORM_EX31));
app.post('/mercurio/nuevaSolicitud-EX31.html', (_req, res) => res.type('html').send(FORM_EX31));

// El "Save Page As" de Chrome rewriteia els URLs dels assets per apuntar a
// `nuevaSolicitud-EX32_files/*` (relatius). Servim aquestes paths també.
function serveFromAssetDir(dirName: string) {
  return (req: any, res: any, next: any) => {
    const filename = req.path.split('/').pop();
    if (!filename) return next();
    const fp = join(CAPTURES, dirName, filename);
    if (existsSync(fp)) {
      // Inferir mime des de l'extensió
      const ext = filename.split('.').pop()?.toLowerCase();
      const mime: Record<string, string> = {
        js: 'application/javascript', css: 'text/css',
        png: 'image/png', gif: 'image/gif', svg: 'image/svg+xml',
        woff: 'font/woff', woff2: 'font/woff2',
      };
      if (ext && mime[ext]) res.type(mime[ext]);
      return res.sendFile(fp);
    }
    next();
  };
}
app.use('/mercurio/nuevaSolicitud-EX32_files', serveFromAssetDir('nuevaSolicitud-EX32_files'));
app.use('/mercurio/nuevaSolicitud-ex31_files', serveFromAssetDir('nuevaSolicitud-ex31_files'));

// ─── Static assets (CSS, JS, imatges del form) ────────────────────────
// Per simetria: assets dels dos forms (es comparteixen els mateixos noms)
const ASSETS_DIR = join(CAPTURES, 'nuevaSolicitud-EX32_files');
const ASSETS_DIR_EX31 = join(CAPTURES, 'nuevaSolicitud-ex31_files');
function serveStatic(req: any, res: any, next: any) {
  const filename = req.path.split('/').pop();
  if (!filename) return next();
  for (const dir of [ASSETS_DIR, ASSETS_DIR_EX31]) {
    const fp = join(dir, filename);
    if (existsSync(fp)) return res.sendFile(fp);
  }
  next();
}
app.use('/mercurio/resources', serveStatic);
app.use('/mercurio/img', serveStatic);

// ─── Cascades AJAX ────────────────────────────────────────────────────
const LOC_DATA = JSON.parse(readFileSync(join(CAPTURES, 'getLocalidades-43-all.json'), 'utf-8'));

app.post('/mercurio/util/getProvincias', (_req, res) => {
  // Static per Reus Refugi: només Tarragona té sentit. Retorno mínim.
  res.json({ resultado: '<option selected="selected" value="">--</option><option value="43">TARRAGONA</option>' });
});

app.post('/mercurio/util/getMunicipios/:prov', (req, res) => {
  const prov = req.params.prov;
  if (prov !== '43') return res.json({ resultado: '<option value="">--</option>' });
  // Construeix les <option> a partir del JSON
  const opts = LOC_DATA.municipios
    .map((m: any) => `<option value="${m.code}">${escapeHtml(m.name)}</option>`)
    .join('');
  res.json({ resultado: '<option selected="selected" value="">--</option>' + opts });
});

app.post('/mercurio/util/getLocalidades/:prov/:mun', (req, res) => {
  const { prov, mun } = req.params;
  if (prov !== '43') return res.json({ resultado: '<option value="">--</option>' });
  const info = LOC_DATA.localidades[mun];
  if (!info?.resultado) return res.json({ resultado: '<option selected="selected" value="">--</option>' });
  res.json({ resultado: info.resultado });
});

// ─── salvarSolicitud (el plat fort) ──────────────────────────────────
const submissions: any[] = [];

app.post('/mercurio/salvarSolicitud.html', (req, res) => {
  const body = (req.body || {}) as Record<string, string>;
  const report = validatePostBody(body);

  // Format del response: JSON detallat + headers per a debug
  const submissionId = `MOCK-${Date.now()}`;
  submissions.push({ id: submissionId, body, report, ts: new Date().toISOString() });

  // Si hi ha format=json al query, retornem report. Si no, simulem el 302 real.
  if (req.query.format === 'json' || req.headers.accept?.includes('json')) {
    res.json({
      submissionId,
      ...report,
      summary: summarize(report),
    });
  } else {
    // Mercurio real fa 302 → finalizacionSolicitud.html. Per al mock, escrivim el report
    // a /tmp/last-submission.json perquè el userscript/test el pugui llegir, i fem el redirect.
    writeFileSync('/tmp/mercurio-mock-last-submission.json', JSON.stringify({ submissionId, ...report }, null, 2));
    res.redirect(302, '/mercurio/finalizacionSolicitud.html');
  }
});

app.get('/mercurio/finalizacionSolicitud.html', (_req, res) => {
  const last = submissions[submissions.length - 1];
  res.type('html').send(`
    <!DOCTYPE html>
    <html><head><meta charset="utf-8"><title>Finalización - Mercurio Mock</title></head>
    <body style="font-family:system-ui;max-width:800px;margin:2em auto;padding:0 1em">
      <h1>✅ Solicitud salvada (mock)</h1>
      <p>ID: <code>${last?.id ?? 'unknown'}</code></p>
      <p>Resultat: <strong>${last ? summarize(last.report) : 'cap'}</strong></p>
      <p><a href="/mock/last-report">Veure report JSON detallat</a></p>
    </body></html>
  `);
});

// ─── uploadDocumento + presentacionTelematicaDocumentacion ──────────
//
// Modelem una "sessió" in-memory: una pantalla d'upload amb un supuesto fix
// (per defecte EX-32-1-03, igual que el HAR captat) i una llista de docs que
// s'hi van afegint. Cada POST /uploadDocumento afegeix una entrada i retorna
// la `<table id="tabla_datos_adj">` REGENERADA — exactament com fa Mercurio
// real, on el JS de plupload fa `$("#cont_tabla_datos_adj").html(ret.response)`.
//
// Endpoints associats:
//   POST /mock/uploads/reset → buida la sessió (per al test runner)
//   GET  /mock/uploads       → estat actual (debug)
//
// Catàleg de tipus document — els 6 codis observats al `<select id="docAdjuntar
// Adjuntos">` de Mercurio. El 188 i 189 són variants segons via legal: aquí
// modelem l'EX-32 (188 = doc. cert. entidad colaboradora). El userscript ha de
// fer match per substring del label, NO per codi.
interface MercurioDocOption { code: string; label: string; }
const MERCURIO_DOC_OPTIONS: MercurioDocOption[] = [
  { code: '1',   label: 'Pasaporte, título de viaje o cédula de inscripción completos, válidos y en vigor de la persona extranjera.' },
  { code: '30',  label: 'Certificado de antecedentes penales del país de origen o de procedencia' },
  { code: '43',  label: 'Justificante del abono de la tasa obligatoria para la tramitación del procedimiento' },
  { code: '187', label: 'Documentación acreditativa de la permanencia en territorio nacional antes de 1 de enero de 2026 y 5 meses ininterrumpidos antes de la solicitud' },
  { code: '188', label: 'Documentación, certificado de entidad colaboradora que acredite la situación de vulnerabilidad' },
  { code: '999', label: 'Otros documentos que desee aportar' },
];
// Codis que Mercurio marca com obligatoris per aquesta via legal. Coincideix amb
// el `listaIdsDocOb` del DOM real captat (1|30|187|188).
const MERCURIO_DOC_OBLIGATORIS = ['1', '30', '187', '188'];
const MERCURIO_SUPUESTO = 'EX-32-1-03';

interface UploadedDoc {
  serverId: string;       // id de la <tr> (server-generated)
  filename: string;       // name field del multipart
  description: string;    // de_documento (label de l'option triat)
  md5: string;
  tipoDocumento: string;  // id_tipo_documento ("1", "30", etc.)
  ts: string;
}
let mockSession: { docs: UploadedDoc[] } = { docs: [] };

const upload = multer({ storage: multer.memoryStorage() });
const uploads: any[] = []; // historial complet (debug, no es reseteja)

function escAttr(s: string): string { return escapeHtml(s); }

/**
 * Renderitza la `<table id="tabla_datos_adj">` que el client injecta a
 * `#cont_tabla_datos_adj` després de cada upload. Imita l'estructura real
 * captada a captures/abde-after-attachments.html (línies 662-708):
 *   col 0: botó Eliminar (onclick="eliminadocAdjuntos(this)")
 *   col 1: nom fitxer
 *   col 2: descripció (label option)
 *   col 3: MD5 hash (visible)
 *   col 4: codi tipus document (display:none — el userscript llegeix d'aquí)
 * L'`id` de cada `<tr>` és l'ID server-side (serveix per identificar la fila
 * a l'hora d'esborrar).
 */
function renderTablaDatosAdj(): string {
  // Estructura idèntica a Mercurio real (captures/abde-after-attachments.html):
  // la classe `clAdjunDes` està al <span> dins del <td>, NO al <td> directament.
  // Si la posem malament, el pre-check de duplicats del userscript no troba res
  // en producció — bug detectat en proves reals d'Abderrahim el 28-29/04/2026.
  const rows = mockSession.docs.map(d => `
    <tr id="${escAttr(d.serverId)}">
      <td><span class="mf-table-responsive--pseudotd"><a onclick="eliminadocAdjuntos(this)">Eliminar</a></span></td>
      <td><span class="mf-table-responsive--pseudotd clAdjunDes">${escAttr(d.filename)}</span></td>
      <td><span class="mf-table-responsive--pseudotd">${escAttr(d.description)}</span></td>
      <td><span class="mf-table-responsive--pseudotd">${escAttr(d.md5)}</span></td>
      <td style="display: none;"><span class="mf-table-responsive--pseudotd">${escAttr(d.tipoDocumento)}</span></td>
    </tr>`).join('');
  return `<table id="tabla_datos_adj" class="mf-table-responsive mf-table-data mf-table-data__zebra"><tbody>${rows}</tbody></table>`;
}

/**
 * Renderitza la pantalla d'upload sencera. HTML mínim però amb tots els
 * elements que el userscript llegeix:
 *   - <select id="docAdjuntarAdjuntos"> amb 6 options (codi + label)
 *   - <input id="listaIdsDocOb" value="1|30|187|188">
 *   - <input id="supuestoSeleccionadoSup" value="EX-32-1-03">
 *   - <div id="cont_tabla_datos_adj"> envoltant la <table id="tabla_datos_adj">
 *   - <input type="file" id="html5_..."> (necessari? el userscript NO l'usa
 *     directament — fa la crida AJAX manualment. L'incloc per fidelitat.)
 */
function renderUploadPage(): string {
  const optionsHtml = MERCURIO_DOC_OPTIONS
    .map(o => `<option value="${escAttr(o.code)}">${escAttr(o.label)}</option>`)
    .join('');
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><title>Mercurio Mock — Upload de Documents</title></head>
<body class="sede mf-long-menu">
  <h1>Presentación telemática — Documentación</h1>
  <form name="FrmDatos" id="FrmDatos" action="/mercurio/registroEntrada.html" method="POST">
    <input type="hidden" id="listaIdsDocOb" name="listaIdsDocOb" value="${MERCURIO_DOC_OBLIGATORIS.join('|')}">
    <input type="hidden" id="listaIdsDocObAUX" name="listaIdsDocObAUX" value="">
    <input type="hidden" id="supuestoSeleccionadoSup" name="supuestoSeleccionadoSup" value="${MERCURIO_SUPUESTO}">
    <div>
      <label>* Documento</label>
      <input type="file" id="html5_mockfileinput" accept=".jpg,.jpeg,.gif,.png,.bmp,.tif,.tiff,.pdf">
    </div>
    <div>
      <label>* Descripción</label>
      <input type="text" id="desDocumentoAdjuntos" maxlength="500">
      <select id="docAdjuntarAdjuntos" onchange="setDocAdjuntarAdjuntos()">
        <option value="">Seleccione tipo de documento...</option>
        ${optionsHtml}
      </select>
    </div>
    <div id="cont_tabla_datos_adj">${renderTablaDatosAdj()}</div>
    <button type="button" id="continuaNot" onclick="continuarPre();">Continuar</button>
  </form>
</body></html>`;
}

app.get('/mercurio/presentacionTelematicaDocumentacion.html', (_req, res) => {
  res.type('html').send(renderUploadPage());
});

app.post('/mercurio/uploadDocumento', upload.single('file'), (req, res) => {
  const errors: string[] = [];
  const fields = req.body as Record<string, string>;

  if (!fields.id_tipo_documento) errors.push('missing id_tipo_documento');
  if (!fields.de_documento) errors.push('missing de_documento');
  if (!fields.name) errors.push('missing name');
  if (!req.file) errors.push('missing file');
  if (req.file && !req.file.mimetype.includes('pdf')) errors.push(`expected PDF, got ${req.file.mimetype}`);

  // Validem que el codi tipus document existeix al catàleg — Mercurio rebutja
  // codis fora del select. Útil per detectar bugs de mapping al userscript.
  if (fields.id_tipo_documento && !MERCURIO_DOC_OPTIONS.some(o => o.code === fields.id_tipo_documento)) {
    errors.push(`unknown id_tipo_documento ${fields.id_tipo_documento}`);
  }

  const md5 = req.file
    ? createHash('md5').update(req.file.buffer).digest('hex').toUpperCase()
    : null;

  const result = {
    ok: errors.length === 0,
    errors,
    fields,
    file: req.file ? {
      originalname: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
      md5,
    } : null,
  };
  uploads.push({ ...result, ts: new Date().toISOString() });

  if (errors.length) return res.status(400).json(result);

  // Afegim a la sessió i retornem la <table> regenerada — format que el client
  // (plupload FileUploaded callback) espera per fer html() del contenidor.
  const serverId = String(60000000 + mockSession.docs.length + Math.floor(Math.random() * 1000));
  mockSession.docs.push({
    serverId,
    filename: fields.name,
    description: fields.de_documento,
    md5: md5!,
    tipoDocumento: fields.id_tipo_documento,
    ts: new Date().toISOString(),
  });
  res.type('html').send(renderTablaDatosAdj());
});

app.post('/mock/uploads/reset', (_req, res) => {
  mockSession = { docs: [] };
  res.json({ ok: true });
});

// ─── Mock-only endpoints (debug) ─────────────────────────────────────
app.get('/mock/last-report', (_req, res) => {
  res.json(submissions[submissions.length - 1] ?? { error: 'no submissions yet' });
});
app.get('/mock/submissions', (_req, res) => res.json(submissions));
app.get('/mock/uploads', (_req, res) => res.json({ history: uploads, session: mockSession }));
app.get('/mock/health', (_req, res) => res.json({ ok: true, port: PORT, captures: CAPTURES }));

// ─── Mock Airtable (per testar el flux upload sense base real) ──────
//
// Serveix la mateixa forma de payload que el Worker hauria de tornar al
// userscript via /mercurio/documents — així el test runner pot apuntar-hi
// directament. Quan implementem el Worker handler real, només canviem
// l'URL al userscript.
//
// Format de cada document:
//   { airtableId, filename, mimetype, mercurioCategory, sizeBytes, downloadUrl }
//
// `mercurioCategory` és el LABEL canònic d'Airtable (single select "Mercurio
// tipus document"), NO un codi. El userscript fa match per substring del
// label contra les <option> del <select id="docAdjuntarAdjuntos"> del DOM.
//
// `downloadUrl` apunta a /mock/airtable/document/:slug d'aquest mateix server,
// que retorna bytes generats en runtime (PDFs trivials, ~200B cada).
const AIRTABLE_FIXTURES_DIR = resolve(__dirname, '../test/fixtures/uploads');

app.get('/mock/airtable/documents', (req, res) => {
  const caso = String(req.query.caso ?? '');
  // Per ara només tenim Abderrahim. Si demanen un altre cas, error.
  if (!caso || !/abderrahim/i.test(caso)) {
    return res.status(404).json({ error: `no fixture for caso=${caso}. Try caso=recABDERRAHIM00001` });
  }
  try {
    const fixture = JSON.parse(readFileSync(join(AIRTABLE_FIXTURES_DIR, 'abderrahim-documents.json'), 'utf-8'));
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const docs = (fixture.documents as any[]).map(d => ({
      airtableId: d.airtableId,
      filename: d.filename,
      mimetype: d.mimetype,
      mercurioCategory: d.mercurioCategory,
      sizeBytes: d.sizeBytes,
      downloadUrl: `${baseUrl}/mock/airtable/document/${d._pdfSlug}`,
    }));
    res.json({ caso: fixture.caseId, idCas: fixture.idCas, documents: docs });
  } catch (e: any) {
    res.status(500).json({ error: `fixture load failed: ${e.message}` });
  }
});

/**
 * Genera un PDF mínim valid (~250B) en runtime. NO usa pdf-lib — un PDF
 * trivial 1-page és prou senzill per fer-ho a mà i evita dependències extra.
 * El label es renderitza al cos perquè cada doc tingui un MD5 diferent.
 */
function makeFakePdf(label: string): Buffer {
  const content = `BT /F1 12 Tf 50 750 Td (${label.replace(/[()\\]/g, '')}) Tj ET`;
  const len = content.length;
  // Calcul d'offsets manualment per a un xref correcte. Si fem servir pdf-lib
  // això es reduiria a 3 línies, però volem zero deps al mock.
  const parts: string[] = [];
  const offsets: number[] = [];
  let pos = 0;
  function add(s: string) { offsets.push(pos); parts.push(s); pos += s.length; }
  const header = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  pos = Buffer.byteLength(header, 'binary');
  parts.push(header);
  add('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  add('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  add('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n');
  add(`4 0 obj\n<< /Length ${len} >>\nstream\n${content}\nendstream\nendobj\n`);
  add('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');
  const xrefPos = pos;
  let xref = `xref\n0 6\n0000000000 65535 f \n`;
  for (const o of offsets) xref += String(o).padStart(10, '0') + ' 00000 n \n';
  parts.push(xref);
  parts.push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);
  return Buffer.from(parts.join(''), 'binary');
}

app.get('/mock/airtable/document/:slug', (req, res) => {
  const slug = req.params.slug;
  const pdf = makeFakePdf(`Mock document: ${slug}`);
  res.type('application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${slug}.pdf"`);
  res.send(pdf);
});

// ─── Helpers ─────────────────────────────────────────────────────────
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function summarize(report: any): string {
  const ok = report.byStatus.ok;
  const total = report.totalFields;
  return `${ok}/${total} ok · missing=${report.byStatus.missing} · invalid=${
    report.byStatus.invalid_constant + report.byStatus.invalid_format +
    report.byStatus.invalid_catalog + report.byStatus.invalid_localitat
  } · unknown=${report.unknownFields.length}`;
}

// ─── Start ───────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🟢 Mercurio mock listening on http://localhost:${PORT}`);
  console.log(`   Form:    http://localhost:${PORT}/mercurio/nuevaSolicitud-EX32.html`);
  console.log(`   Health:  http://localhost:${PORT}/mock/health`);
  console.log(`   Submit:  POST http://localhost:${PORT}/mercurio/salvarSolicitud.html`);
  console.log(`   Last:    http://localhost:${PORT}/mock/last-report`);
  console.log();
});
