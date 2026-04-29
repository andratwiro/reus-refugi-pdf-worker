/**
 * Test runner Fase 2.
 *
 * 1. Carrega tots els fixtures de test/fixtures/*.json
 * 2. Per cada cas:
 *    - Construeix payload via airtableToMercurio()
 *    - POST al mock /salvarSolicitud.html?format=json
 *    - Recull el report
 * 3. Genera test/output/REPORT.md amb pass/fail per cas i per camp
 *
 * Assumeix que el mock està en marxa a http://localhost:3001 (o $MOCK_URL).
 * Si no ho està, falla amb missatge clar.
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
// Importa el mapper del Worker (font canònica). El mock NO duplica codi.
import { airtableToMercurio, type AirtableCase, type PresentadorConfig } from '../../src/mercurio/mapping.js';

// Stub presentador per a tests — valors fake, mai surten de localhost.
const TEST_PRESENTADOR: PresentadorConfig = {
  nombre: 'TEST PRESENTADOR',
  nie: '00000000T',
  tipoDoc: 'NF',
  mobil: '600000000',
  email: 'test@example.org',
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, 'fixtures');
const OUTPUT_DIR = resolve(__dirname, 'output');
const MOCK_URL = process.env.MOCK_URL ?? 'http://localhost:3001';

// Definició de la llista de casos a executar amb les seves relacions
interface TestCase {
  fixture: string;
  refFixture?: string;       // si és dependent (Banda Fatou/Amadou → Ibrahim)
  expectFailures?: string[]; // camps que sabem que fallaran (no comptat com a regression)
  notes?: string;
}

const CASES: TestCase[] = [
  { fixture: 'case01.json', notes: 'Sintètic. DA 21ª Vulnerabilitat amb circumstàncies.' },
  {
    fixture: 'case02.json',
    notes: 'Sintètic. DA 20ª sense domicili → errors d\'adreça esperats (test de robustesa).',
    expectFailures: ['extTipoVia', 'extDomicilio', 'extNumero', 'extCodigoMunicipio', 'extCodigoPostal'],
  },
  { fixture: 'case03.json', notes: 'Sintètic. DA 20ª complet amb NIE i contracte.' },
  { fixture: 'banda-ibrahim.json', notes: 'Sintètic. DA 21ª Laboral, principal de família.' },
  { fixture: 'banda-fatou.json', refFixture: 'banda-ibrahim.json', notes: 'Sintètic. Cònjuge dependent d\'Ibrahim.' },
  { fixture: 'banda-amadou.json', refFixture: 'banda-ibrahim.json', notes: 'Sintètic. Fill menor dependent d\'Ibrahim.' },
];

interface RunResult {
  caseId: string;
  fixture: string;
  notes?: string;
  ok: boolean;
  summary: string;
  totalFields: number;
  byStatus: Record<string, number>;
  errors: { field: string; status: string; received?: string; reason?: string }[];
  unknownFields: string[];
  expectedFailures: string[];
  unexpectedFailures: string[];
}

async function runOne(tc: TestCase): Promise<RunResult> {
  const rec: AirtableCase = JSON.parse(readFileSync(join(FIXTURES_DIR, tc.fixture), 'utf-8'));
  const refRec: AirtableCase | undefined = tc.refFixture
    ? JSON.parse(readFileSync(join(FIXTURES_DIR, tc.refFixture), 'utf-8'))
    : undefined;

  const payload = airtableToMercurio(rec, TEST_PRESENTADOR, refRec);
  const body = new URLSearchParams(payload).toString();

  const res = await fetch(`${MOCK_URL}/mercurio/salvarSolicitud.html?format=json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const report: any = await res.json();

  const errors = Object.entries(report.fields)
    .filter(([_, f]: any) => f.status !== 'ok')
    .map(([name, f]: any) => ({
      field: name, status: f.status, received: f.received,
      reason: f.reason ?? f.expected,
    }));

  const expectedFailures = tc.expectFailures ?? [];
  const unexpectedFailures = errors
    .filter(e => !expectedFailures.includes(e.field))
    .map(e => e.field);

  return {
    caseId: rec.fields['ID Cas'] ?? rec.id,
    fixture: tc.fixture,
    notes: tc.notes,
    ok: report.ok,
    summary: report.summary ?? '',
    totalFields: report.totalFields,
    byStatus: report.byStatus,
    errors,
    unknownFields: report.unknownFields ?? [],
    expectedFailures,
    unexpectedFailures,
  };
}

async function main() {
  console.log(`\nRunning ${CASES.length} test cases against ${MOCK_URL}\n`);

  // Quick health check
  try {
    const h = await fetch(`${MOCK_URL}/mock/health`).then(r => r.json() as Promise<any>);
    if (!h.ok) throw new Error('mock not healthy');
  } catch (e) {
    console.error(`\n❌ Mock no respon a ${MOCK_URL}/mock/health`);
    console.error(`   Llança el mock primer: cd mock && npm start`);
    process.exit(1);
  }

  const results: RunResult[] = [];
  for (const tc of CASES) {
    process.stdout.write(`  ${tc.fixture.padEnd(28)}`);
    try {
      const r = await runOne(tc);
      results.push(r);
      const status = r.ok ? '✅' : (r.unexpectedFailures.length === 0 ? '🟡' : '❌');
      console.log(`${status}  ${r.summary}`);
    } catch (e: any) {
      console.log(`❌  ${e.message}`);
      results.push({
        caseId: tc.fixture, fixture: tc.fixture, ok: false, summary: 'ERROR',
        totalFields: 0, byStatus: {}, errors: [{ field: '_runner', status: 'error', reason: e.message }],
        unknownFields: [], expectedFailures: [], unexpectedFailures: ['_runner'],
      });
    }
  }

  const md = renderMarkdown(results);
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(join(OUTPUT_DIR, 'REPORT.md'), md);
  console.log(`\n📄 Report: ${join(OUTPUT_DIR, 'REPORT.md')}\n`);

  // Exit code: 0 if no UNEXPECTED failures, else 1
  const hasUnexpected = results.some(r => r.unexpectedFailures.length > 0);
  process.exit(hasUnexpected ? 1 : 0);
}

function renderMarkdown(results: RunResult[]): string {
  const lines: string[] = [];
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  lines.push(`# Mercurio Mock — Test Report`);
  lines.push(``);
  lines.push(`Generat: \`${ts}\` · Mock: \`${MOCK_URL}\``);
  lines.push(``);

  // Summary table
  lines.push(`## Resum`);
  lines.push(``);
  lines.push(`| Cas | Estat | Score | OK | Missing | Invalid | Unknown |`);
  lines.push(`|-----|-------|-------|----|---------|---------|---------|`);
  for (const r of results) {
    const status = r.ok ? '✅ OK' : (r.unexpectedFailures.length === 0 ? '🟡 esperat' : '❌ FAIL');
    const inv = (r.byStatus.invalid_constant ?? 0) + (r.byStatus.invalid_format ?? 0) +
                (r.byStatus.invalid_catalog ?? 0) + (r.byStatus.invalid_localitat ?? 0);
    lines.push(`| \`${r.caseId}\` | ${status} | ${r.byStatus.ok ?? 0}/${r.totalFields} | ${r.byStatus.ok ?? 0} | ${r.byStatus.missing ?? 0} | ${inv} | ${r.unknownFields.length} |`);
  }
  lines.push(``);

  // Per-case detail
  lines.push(`## Detall per cas`);
  lines.push(``);
  for (const r of results) {
    lines.push(`### \`${r.caseId}\` — ${r.fixture}`);
    if (r.notes) lines.push(`> ${r.notes}`);
    lines.push(``);
    lines.push(`Score: **${r.byStatus.ok ?? 0}/${r.totalFields}** · ${r.summary}`);
    lines.push(``);
    if (r.errors.length === 0) {
      lines.push(`✅ Tots els camps validen correctament.`);
    } else {
      lines.push(`#### Errors (${r.errors.length})`);
      lines.push(``);
      lines.push(`| Camp | Estat | Rebut | Raó |`);
      lines.push(`|------|-------|-------|-----|`);
      for (const e of r.errors) {
        const expected = r.expectedFailures.includes(e.field) ? ' (esperat)' : '';
        lines.push(`| \`${e.field}\`${expected} | ${e.status} | \`${escape(e.received)}\` | ${escape(e.reason)} |`);
      }
    }
    if (r.unknownFields.length > 0) {
      lines.push(``);
      lines.push(`#### Camps desconeguts al schema (${r.unknownFields.length})`);
      lines.push(r.unknownFields.map(f => `- \`${f}\``).join('\n'));
    }
    lines.push(``);
  }

  // Footer notes
  lines.push(`## Notes`);
  lines.push(``);
  lines.push(`- Estat **🟡 esperat**: el cas té errors però són tots als \`expectFailures\` (limitacions conegudes).`);
  lines.push(`- Estat **❌ FAIL**: hi ha errors no esperats — cal mirar el detall.`);
  lines.push(`- Codis \`viaAccesoNew\` / \`idOpcionAutorizacion\` per a vies diferents de DA 21ª Laboral són ESTIMATS — cal capturar-los a Mercurio real per a confirmació.`);
  lines.push(``);
  return lines.join('\n');
}

function escape(s: any): string {
  if (s === undefined || s === null) return '';
  return String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 80);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
