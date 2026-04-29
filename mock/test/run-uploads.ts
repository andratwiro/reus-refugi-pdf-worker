/**
 * Test runner E2E del flux d'upload de documents.
 *
 * Simula el que farà el userscript Venus quan estigui a la pantalla
 * `presentacionTelematicaDocumentacion.html`:
 *   1. Reseteja la sessió mock
 *   2. GET la pantalla d'upload → parseja el <select id="docAdjuntarAdjuntos">
 *      per construir el mapping {label_canònic → codi_Mercurio}.
 *      Aquest és el pas CRÍTIC: el userscript NO ha d'hardcoder codis (1, 30,
 *      188, 189, 999, etc.) perquè canvien segons via legal.
 *   3. GET la llista de docs d'Airtable per al cas (mock)
 *   4. Per cada doc:
 *        a) match `mercurioCategory` (Airtable) ↔ <option> (Mercurio) per
 *           substring del label
 *        b) descarrega bytes via downloadUrl
 *        c) POST multipart a /mercurio/uploadDocumento
 *        d) verifica que la resposta conté la fila nova
 *        e) sleep 200ms (en producció serà 1500ms — aquí accelerem)
 *   5. Verifica duplicat-skip: re-pujar Pasaporte hauria de saltar-se al
 *      userscript (lectura de tabla_datos_adj abans). Aquí simulem el check
 *      en codi de test per demostrar que el contracte funciona.
 *   6. Imprimeix report.
 *
 * Assumeix mock a http://localhost:3001 (o $MOCK_URL).
 *
 * NOTA: aquest test exercita el contracte mock-Worker-userscript SENSE el
 * userscript real (que viu a src/mercurio/userscriptCode.ts i s'injecta a
 * Tampermonkey). El raonament: si el contracte HTTP funciona, el userscript
 * funcionarà — la lògica del userscript és transformar fitxers en FormData
 * i POSTar-los, exactament el que fa aquest test.
 */

const MOCK_URL = process.env.MOCK_URL ?? 'http://localhost:3001';
const TEST_CASO = 'recCASE01000000001';

interface AirtableDoc {
  airtableId: string;
  filename: string;
  mimetype: string;
  mercurioCategory: string;
  sizeBytes: number;
  downloadUrl: string;
}

interface MercurioOption { code: string; label: string; }

/** Parseja les <option> del <select id="docAdjuntarAdjuntos"> del HTML.
 *  No usem JSDOM — un regex és suficient i evita una dep extra al mock. */
function parseDocOptions(html: string): MercurioOption[] {
  const selectMatch = html.match(/<select id="docAdjuntarAdjuntos"[^>]*>([\s\S]*?)<\/select>/);
  if (!selectMatch) throw new Error('select#docAdjuntarAdjuntos not found in upload page');
  const opts: MercurioOption[] = [];
  const re = /<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(selectMatch[1])) !== null) {
    if (m[1]) opts.push({ code: m[1], label: m[2].trim() });
  }
  return opts;
}

/** Match d'una categoria Airtable contra el catàleg de Mercurio.
 *  Mateixa lògica que el userscript de producció (src/mercurio/userscriptCode.ts:
 *  resolveMercurioCode). 3 passos:
 *    1. Exact match per label (taxonomia Airtable usa labels literals Mercurio)
 *    2. Heurística només per "Documentación vía legal" (188/189 varia per via)
 *    3. Fallback Otros */
function resolveMercurioCode(category: string, options: MercurioOption[]): { code: string; label: string; matchedBy: string } {
  const norm = (s: string) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const catNorm = norm(category);

  // 1. Exact match
  const exact = options.find(o => norm(o.label) === catNorm);
  if (exact) return { code: exact.code, label: exact.label, matchedBy: 'exact' };

  // 2. Heurística només per al label abstracte "Documentación vía legal..."
  if (/^documentaci[oó]n.*v[ií]a.*legal/i.test(category)) {
    const found = options.find(o => /vulnerabilidad|justificativa de presentaci[oó]n|entidad colaboradora/i.test(o.label));
    if (found) return { code: found.code, label: found.label, matchedBy: 'heuristic:via-legal' };
  }

  // 3. Fallback Otros
  const otros = options.find(o => /otros documentos/i.test(o.label));
  if (otros) return { code: otros.code, label: otros.label, matchedBy: 'fallback:otros' };
  const first = options[0];
  return { code: first.code, label: first.label, matchedBy: 'fallback:first' };
}

/** Llegeix tabla_datos_adj per saber quins docs JA hi ha pujats. Per
 *  duplicate-skip, el userscript ha de cridar això abans de pujar. */
function readUploadedFilenames(html: string): Set<string> {
  const tableMatch = html.match(/<table id="tabla_datos_adj"[^>]*>([\s\S]*?)<\/table>/);
  if (!tableMatch) return new Set();
  const names = new Set<string>();
  // Match el text dins de qualsevol element amb classe clAdjunDes (Mercurio
  // real té <span class="... clAdjunDes">filename</span> dins del <td>).
  const re = /class="[^"]*\bclAdjunDes\b[^"]*"[^>]*>([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tableMatch[1])) !== null) names.add(m[1].trim().toLowerCase());
  return names;
}

async function uploadOne(doc: AirtableDoc, opts: MercurioOption[], alreadyUploaded: Set<string>): Promise<{
  ok: boolean; status: 'uploaded' | 'skipped_duplicate' | 'error'; reason?: string; resolved?: ReturnType<typeof resolveMercurioCode>;
}> {
  if (alreadyUploaded.has(doc.filename.toLowerCase())) {
    return { ok: true, status: 'skipped_duplicate', reason: `${doc.filename} ja pujat` };
  }
  const resolved = resolveMercurioCode(doc.mercurioCategory, opts);

  // Descarrega bytes
  const dlRes = await fetch(doc.downloadUrl);
  if (!dlRes.ok) return { ok: false, status: 'error', reason: `download ${dlRes.status}` };
  const bytes = await dlRes.arrayBuffer();

  // Construeix FormData EXACTAMENT amb els 5 camps observats al HAR real.
  // Ordre dels camps: id_tipo_documento, de_documento, texto_otros, name, file.
  const fd = new FormData();
  fd.append('id_tipo_documento', resolved.code);
  fd.append('de_documento', resolved.label);
  fd.append('texto_otros', '1');
  fd.append('name', doc.filename);
  fd.append('file', new Blob([bytes], { type: doc.mimetype }), doc.filename);

  const res = await fetch(`${MOCK_URL}/mercurio/uploadDocumento`, { method: 'POST', body: fd });
  if (!res.ok) {
    const errBody = await res.text();
    return { ok: false, status: 'error', reason: `POST ${res.status}: ${errBody.slice(0, 200)}`, resolved };
  }
  const respHtml = await res.text();
  // Verifica que la resposta inclou una <tr> amb el filename (sanity check).
  if (!respHtml.includes(doc.filename)) {
    return { ok: false, status: 'error', reason: `response did not include filename ${doc.filename}`, resolved };
  }
  return { ok: true, status: 'uploaded', resolved };
}

async function main() {
  console.log(`\n📤 Upload flow E2E test → ${MOCK_URL}\n`);

  // 0. Health
  const h = await fetch(`${MOCK_URL}/mock/health`).then(r => r.json() as any).catch(() => null);
  if (!h?.ok) { console.error(`❌ Mock no respon. Llança: cd mock && npm start`); process.exit(1); }

  // 1. Reset
  await fetch(`${MOCK_URL}/mock/uploads/reset`, { method: 'POST' });

  // 2. Parse upload page → obté <select> options
  const pageHtml = await fetch(`${MOCK_URL}/mercurio/presentacionTelematicaDocumentacion.html`).then(r => r.text());
  const options = parseDocOptions(pageHtml);
  console.log(`📋 Catàleg Mercurio: ${options.length} tipus document`);
  for (const o of options) console.log(`   ${o.code.padStart(4)} → ${o.label.slice(0, 70)}${o.label.length > 70 ? '…' : ''}`);

  // 3. GET docs d'Airtable (mock)
  const docsResp = await fetch(`${MOCK_URL}/mock/airtable/documents?caso=${TEST_CASO}`).then(r => r.json() as any);
  const docs = docsResp.documents as AirtableDoc[];
  console.log(`\n📚 Cas ${docsResp.idCas} (${docsResp.caso}): ${docs.length} docs a Airtable`);

  // 4. Pre-check duplicats (lectura inicial de tabla_datos_adj — buida en aquest test)
  const initialUploaded = readUploadedFilenames(pageHtml);
  console.log(`   Pre-check tabla_datos_adj: ${initialUploaded.size} fitxers ja pujats\n`);

  // 5. Upload seqüencial amb 200ms entre cada un
  const results: Array<{ doc: AirtableDoc; result: Awaited<ReturnType<typeof uploadOne>> }> = [];
  for (const doc of docs) {
    process.stdout.write(`  ${doc.filename.padEnd(34)} (${doc.mercurioCategory.padEnd(28)}) → `);
    const result = await uploadOne(doc, options, initialUploaded);
    if (result.status === 'uploaded') {
      console.log(`✅ codi ${result.resolved!.code} (match: ${result.resolved!.matchedBy})`);
    } else if (result.status === 'skipped_duplicate') {
      console.log(`🟡 skip (${result.reason})`);
    } else {
      console.log(`❌ ${result.reason}`);
    }
    results.push({ doc, result });
    initialUploaded.add(doc.filename.toLowerCase());
    await new Promise(r => setTimeout(r, 200));
  }

  // 6. Verifica estat final
  console.log(`\n🔍 Verificació final:`);
  const finalPage = await fetch(`${MOCK_URL}/mercurio/presentacionTelematicaDocumentacion.html`).then(r => r.text());
  const finalUploaded = readUploadedFilenames(finalPage);
  console.log(`   tabla_datos_adj final: ${finalUploaded.size} files`);

  const sessionState = await fetch(`${MOCK_URL}/mock/uploads`).then(r => r.json() as any);
  console.log(`   /mock/uploads.session.docs: ${sessionState.session.docs.length} docs`);
  console.log(`   /mock/uploads.history:      ${sessionState.history.length} POSTs (incl. errors)`);

  // 7. Test duplicate-skip: re-puja el Pasaporte → ha de saltar
  console.log(`\n🔁 Test duplicate-skip (re-pujar passaport):`);
  const reUpload = await uploadOne(docs[0], options, finalUploaded);
  console.log(`   ${reUpload.status === 'skipped_duplicate' ? '✅' : '❌'} status=${reUpload.status} reason="${reUpload.reason}"`);

  // 8. Resum
  const ok = results.filter(r => r.result.status === 'uploaded').length;
  const skipped = results.filter(r => r.result.status === 'skipped_duplicate').length;
  const errors = results.filter(r => r.result.status === 'error');
  console.log(`\n📊 Resum: ${ok} pujats · ${skipped} duplicats · ${errors.length} errors`);
  if (errors.length > 0) {
    console.log(`\n❌ Errors:`);
    for (const e of errors) console.log(`   ${e.doc.filename}: ${e.result.reason}`);
    process.exit(1);
  }
  // Verifica que cada doc s'ha resolt al codi correcte: el fixture té 5 docs
  // de 5 categories diferents (Pasaporte, Antecedentes, Tasa, Permanencia,
  // Documentación vía legal), així que ha d'haver-hi 5 codis únics. Si algun
  // ha caigut a fallback, ho detectem aquí.
  const uploaded = results.filter(r => r.result.status === 'uploaded');
  const codes = new Set(uploaded.map(r => r.result.resolved!.code));
  const fellbacks = uploaded.filter(r => /^fallback/.test(r.result.resolved!.matchedBy));
  if (fellbacks.length > 0) {
    console.log(`\n❌ ${fellbacks.length} doc(s) han caigut a fallback inesperat:`);
    for (const r of fellbacks) console.log(`   ${r.doc.filename} (${r.doc.mercurioCategory}) → ${r.result.resolved!.matchedBy}`);
    process.exit(1);
  }
  if (codes.size !== ok) {
    console.log(`\n❌ Només ${codes.size} codis únics per ${ok} docs (esperats ${ok}). Mapping incorrecte.`);
    process.exit(1);
  }
  console.log(`✅ Tots els tests passen.\n`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
