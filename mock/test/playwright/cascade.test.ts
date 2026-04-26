/**
 * E2E test del userscript contra el mock Mercurio amb Playwright.
 *
 * Objectiu: validar que les cascades Provincia → Municipi → Localitat
 * funcionen quan el userscript dispara els events.
 *
 * Pre: mock corrent a localhost:3001 (npm start a mock/).
 *
 * Run: npm run test:e2e
 */

import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOCK_URL = process.env.MOCK_URL ?? 'http://localhost:3001';

async function main() {
  // Carrega userscript final (sense el header Tampermonkey)
  const userscriptFull = readFileSync(
    resolve(__dirname, '../../userscript/dist/reus-refugi-mercurio.user.js'),
    'utf-8'
  );
  // Strip metadata header (les linies començant amb // ==UserScript==)
  const userscript = userscriptFull.replace(/^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\n/, '');

  const browser = await chromium.launch({ headless: !process.env.HEADED });
  const context = await browser.newContext();

  // Inject userscript before any page loads
  await context.addInitScript({ content: userscript });

  const page = await context.newPage();

  // Captura xarxa i logs
  const xhrLog: { url: string; status: number }[] = [];
  page.on('response', r => {
    const u = r.url();
    if (u.includes('/util/get')) xhrLog.push({ url: u, status: r.status() });
  });
  page.on('console', m => console.log(`  [browser ${m.type()}]`, m.text()));

  console.log(`\n→ Loading ${MOCK_URL}/mercurio/nuevaSolicitud-EX31.html`);
  await page.goto(`${MOCK_URL}/mercurio/nuevaSolicitud-EX31.html`, { waitUntil: 'networkidle' });

  console.log('→ Waiting for userscript button…');
  const btnSelector = 'button:has-text("Omplir REDACTED")';
  await page.waitForSelector(btnSelector, { timeout: 5000 });

  console.log('→ Click REDACTED');
  await page.click(btnSelector);

  // Donem temps a les cascades AJAX
  await page.waitForTimeout(2000);

  // Verificacions — passem un string per evitar TS emit issues amb tsx
  const result: any = await page.evaluate(`
    (function() {
      function val(n) {
        var e = document.querySelector('[name="' + n + '"]');
        return e ? e.value : null;
      }
      function optCount(n) {
        var e = document.querySelector('[name="' + n + '"]');
        return e && e.options ? e.options.length : 0;
      }
      function optSample(n) {
        var e = document.querySelector('[name="' + n + '"]');
        if (!e || !e.options) return [];
        return Array.from(e.options).slice(0, 5).map(function(o) { return o.value + '=' + o.text; });
      }
      var checkedRadio = document.querySelector('input[name="datosForAut"]:checked');
      return {
        provinciaValue: val('extCodigoProvincia'),
        provinciaOptions: optCount('extCodigoProvincia'),
        municipiValue: val('extCodigoMunicipio'),
        municipiOptions: optCount('extCodigoMunicipio'),
        municipiSample: optSample('extCodigoMunicipio'),
        localitatValue: val('extCodigoLocalidad'),
        localitatOptions: optCount('extCodigoLocalidad'),
        pasaporte: val('extPasaporte'),
        apellido1: val('extApellido1'),
        datosForAut: checkedRadio ? checkedRadio.value : null,
        expAsilo: val('expAsilo'),
      };
    })()
  `);

  console.log('\n=== Resultat ===');
  console.log(JSON.stringify(result, null, 2));
  console.log('\n=== AJAX calls observades ===');
  for (const x of xhrLog) console.log(`  ${x.status} ${x.url}`);

  // Pass/fail
  const ok =
    result.provinciaValue === '43' &&
    result.municipiOptions > 1 &&
    result.municipiValue === '123' &&
    result.localitatOptions > 1;

  console.log(`\n${ok ? '✅ PASS' : '❌ FAIL'} — cascade Provincia → Municipi → Localitat`);

  if (!process.env.HEADED) await browser.close();
  process.exit(ok ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
