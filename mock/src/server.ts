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

// ─── uploadDocumento ─────────────────────────────────────────────────
const upload = multer({ storage: multer.memoryStorage() });
const uploads: any[] = [];

app.post('/mercurio/uploadDocumento', upload.single('file'), (req, res) => {
  const errors: string[] = [];
  const fields = req.body as Record<string, string>;

  if (!fields.id_tipo_documento) errors.push('missing id_tipo_documento');
  if (!fields.de_documento) errors.push('missing de_documento');
  if (!fields.name) errors.push('missing name');
  if (!req.file) errors.push('missing file');
  if (req.file && !req.file.mimetype.includes('pdf')) errors.push(`expected PDF, got ${req.file.mimetype}`);

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
  res.type('html').send(`<html><body>OK ${md5}</body></html>`);
});

// ─── Mock-only endpoints (debug) ─────────────────────────────────────
app.get('/mock/last-report', (_req, res) => {
  res.json(submissions[submissions.length - 1] ?? { error: 'no submissions yet' });
});
app.get('/mock/submissions', (_req, res) => res.json(submissions));
app.get('/mock/uploads', (_req, res) => res.json(uploads));
app.get('/mock/health', (_req, res) => res.json({ ok: true, port: PORT, captures: CAPTURES }));

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
