/**
 * Genera el fitxer userscript final amb els payloads embedded.
 *
 * Llegeix:
 *   - userscript/template.user.js (template amb __PAYLOADS_PLACEHOLDER__)
 *   - test/fixtures/dayner.json (i altres si volem ampliar)
 *
 * Aplica el mapper, embedeix els payloads i escriu:
 *   - userscript/dist/reus-refugi-mercurio.user.js
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { airtableToMercurio, type AirtableCase } from '../src/lib/mapping.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

interface CaseSpec {
  fixture: string;
  refFixture?: string;
  label: string;
}

// Casos a incloure al userscript. El userscript detecta automàticament EX-31
// vs EX-32 i avisa si l'URL no coincideix amb el cas seleccionat.
const CASES: CaseSpec[] = [
  { fixture: 'dayner.json', label: 'DAYNER · EX31' },
  { fixture: 'abderrahim.json', label: 'ABDERRAHIM · EX32' },
  { fixture: 'banda-ibrahim.json', label: 'BANDA Ibrahim · EX32' },
];

function loadFixture(name: string): AirtableCase {
  return JSON.parse(readFileSync(join(ROOT, 'test/fixtures', name), 'utf-8'));
}

const payloads: Record<string, Record<string, string>> = {};
for (const cs of CASES) {
  const rec = loadFixture(cs.fixture);
  const ref = cs.refFixture ? loadFixture(cs.refFixture) : undefined;
  payloads[cs.label] = airtableToMercurio(rec, undefined, ref);
}

const tpl = readFileSync(join(ROOT, 'userscript/template.user.js'), 'utf-8');
const out = tpl.replace('__PAYLOADS_PLACEHOLDER__', JSON.stringify(payloads, null, 2));

const distDir = join(ROOT, 'userscript/dist');
mkdirSync(distDir, { recursive: true });
const outPath = join(distDir, 'reus-refugi-mercurio.user.js');
writeFileSync(outPath, out);

console.log(`✅ ${outPath}`);
console.log(`   Casos inclosos: ${Object.keys(payloads).join(', ')}`);
console.log(`   Payload size: ${Object.values(payloads).map(p => Object.keys(p).length).join(', ')} fields`);
console.log(`   Total bytes: ${out.length}`);
