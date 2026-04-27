/**
 * Userscript de PRODUCCIÓ — Venus (eina interna Reus Refugi) per Mercurio.
 *
 * Diferent del MVP (mock/userscript/template.user.js) en què:
 *   - No té payloads hardcoded; cerca i llegeix d'Airtable via Worker
 *   - @updateURL apunta al Worker per auto-update via Tampermonkey
 *   - Inclou caixa de cerca per nom/cognom/passaport
 *
 * Es serveix des de la ruta `GET /mercurio.user.js` del Worker, que
 * substitueix els placeholders `__WORKER_URL__` i `__SHARED_SECRET__`
 * a runtime amb la URL pública del Worker i el secret.
 *
 * El userscript s'injecta a tres pantalles de Mercurio:
 *   - seleccionModelo-XX.html        → MODE INFO: clica cas, et diu si és EX31/EX32
 *   - nuevaSolicitud-EX31/EX32.html  → MODE OMPLIR: clica cas, omple 144 camps
 *
 * Nota seguretat: el SHARED_SECRET viatja embedded al userscript.
 * El nostre threat model: voluntaris RECEX de confiança + audit logs
 * Cloudflare. Si això canvia, considerar OAuth per voluntari.
 */
export const USERSCRIPT_TEMPLATE = `// ==UserScript==
// @name         Venus — Auto-Fill Mercurio
// @namespace    https://reusrefugi.cat
// @version      __VERSION__
// @description  Cerca un cas d'Airtable Venus i omple el form EX-31/EX-32 de Mercurio amb 1 click. NO submiteja.
// @author       Reus Refugi
// @match        https://mercurio.delegaciondelgobierno.gob.es/mercurio/seleccionModelo-*.html*
// @match        https://mercurio.delegaciondelgobierno.gob.es/mercurio/nuevaSolicitud-EX31.html*
// @match        https://mercurio.delegaciondelgobierno.gob.es/mercurio/nuevaSolicitud-EX32.html*
// @updateURL    __WORKER_URL__/mercurio.user.js
// @downloadURL  __WORKER_URL__/mercurio.user.js
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  const WORKER_URL = '__WORKER_URL__';
  const SHARED_SECRET = '__SHARED_SECRET__';

  // ─── Skip lists ─────────────────────────────────────────────────────
  const CASCADE_FIELDS = new Set([
    'extCodigoProvincia', 'extCodigoMunicipio', 'extCodigoLocalidad',
    'reaCodigoProvinciaReagrupante', 'reaCodigoMunicipioReagrupante', 'reaCodigoLocalidadReagrupante',
    'preCodigoProvinciaPresentador', 'preCodigoMunicipioPresentador', 'preCodigoLocalidadPresentador',
  ]);
  const SKIP_FIELDS = new Set([
    'reaCodigoMunicipioReagrupante', 'reaCodigoLocalidadReagrupante',
    'preCodigoMunicipioPresentador', 'preCodigoLocalidadPresentador',
    'preNombrePresentador', 'preTipodocumentoPresentador', 'preNiePresentador',
    'notNombreNotificacion', 'notTipodocumentoNotificacion', 'notNieNotificacion',
    '_chkDecla1', '_chkDecla2', '_chkDecla3',
    '_chkIncapacidad', '_chkConsientoConsultaDocumentos', '_chkConsentimientoNotificacion',
  ]);

  // ─── Worker fetch helpers ───────────────────────────────────────────
  async function workerGet(path) {
    const r = await fetch(WORKER_URL + path, {
      headers: { 'Authorization': 'Bearer ' + SHARED_SECRET },
    });
    if (!r.ok) throw new Error(\`\${r.status} \${await r.text()}\`);
    return r.json();
  }

  // ─── Form fill primitives ───────────────────────────────────────────
  function fireEvents(el, types) {
    for (const t of types) el.dispatchEvent(new Event(t, { bubbles: true }));
    if (window.jQuery) {
      try { for (const t of types) window.jQuery(el).trigger(t); } catch (e) {}
    }
  }

  function setField(name, value) {
    if (SKIP_FIELDS.has(name)) return { name, status: 'skipped' };
    const els = document.querySelectorAll('[name="' + CSS.escape(name) + '"]');
    if (els.length === 0) return { name, status: 'not_found', value };
    const el = els[0];
    const tag = el.tagName.toLowerCase();
    const type = (el.type || '').toLowerCase();
    try {
      if (tag === 'select') {
        const opt = [...el.options].find(o => o.value === value);
        if (!opt) return { name, status: 'invalid_option', value };
        el.value = value;
        fireEvents(el, ['change']);
        return { name, status: 'ok', value };
      }
      if (type === 'checkbox') {
        const want = value === 'true' || value === 'on';
        if (el.checked !== want) { el.checked = want; fireEvents(el, ['change']); }
        return { name, status: 'ok', value: want ? 'checked' : 'unchecked' };
      }
      if (type === 'radio') {
        // Per radios, native click() és més segur: dispara el handler complet
        // de Mercurio (que p.ex. mostra inputs dinàmics com expAsilo). 'change'
        // event sol no els activa.
        for (const r of els) if (r.value === value) { r.click(); break; }
        return { name, status: 'ok', value };
      }
      el.value = value;
      fireEvents(el, ['input', 'change']);
      return { name, status: 'ok', value };
    } catch (e) { return { name, status: 'error', value, error: String(e) }; }
  }

  async function waitForOption(name, value, timeoutMs = 3000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const el = document.querySelector('[name="' + CSS.escape(name) + '"]');
      if (el && el.options) for (const o of el.options) if (o.value === value) return el;
      await new Promise(r => setTimeout(r, 80));
    }
    return null;
  }

  async function fillCascade(payload) {
    const results = [];
    const blocks = [
      ['extCodigoProvincia', 'extCodigoMunicipio', 'extCodigoLocalidad'],
      ['reaCodigoProvinciaReagrupante', 'reaCodigoMunicipioReagrupante', 'reaCodigoLocalidadReagrupante'],
      ['preCodigoProvinciaPresentador', 'preCodigoMunicipioPresentador', 'preCodigoLocalidadPresentador'],
    ];
    for (const block of blocks) {
      const [, muniName, locName] = block;
      // Skip TOT el bloc si muni+loc buits — un canvi a provincia "vague"
      // pot disparar handlers globals de Mercurio que reseten ext.
      if (!payload[muniName] && !payload[locName]) continue;

      for (const fieldName of block) {
        const value = payload[fieldName];
        if (!value) continue;
        const el = await waitForOption(fieldName, value);
        if (!el) { results.push({ name: fieldName, status: 'cascade_timeout', value }); continue; }
        el.value = value;
        fireEvents(el, ['change']);
        results.push({ name: fieldName, status: 'ok_cascade', value });
        await new Promise(r => setTimeout(r, 200));
      }
    }

    // VERIFICATION PASS: després de tot, esperem 600ms i revisem que
    // muni/loc d'ext no s'hagin esborrat per side effects (CP handler,
    // re-renderització, etc.). Si sí, retry.
    await new Promise(r => setTimeout(r, 600));
    for (const fieldName of ['extCodigoMunicipio', 'extCodigoLocalidad']) {
      const wanted = payload[fieldName];
      if (!wanted) continue;
      const el = document.querySelector('[name="' + CSS.escape(fieldName) + '"]');
      if (!el) continue;
      if (el.value === wanted) continue;
      // Reset detectat — retry
      const opt = await waitForOption(fieldName, wanted, 1500);
      if (!opt) {
        results.push({ name: fieldName, status: 'cascade_timeout_retry', value: wanted });
        continue;
      }
      el.value = wanted;
      fireEvents(el, ['change']);
      results.push({ name: fieldName, status: 'ok_cascade_retry', value: wanted, reason: 'reset detectat, re-setejat' });
      await new Promise(r => setTimeout(r, 200));
    }

    return results;
  }

  /**
   * Ordre de fillament:
   *   1. datosForAut (radio) → click() per a que Mercurio renderitzi els
   *      camps dinàmics (p.ex. expAsilo per a EX-31 PI). Espera 400ms.
   *   2. Tots els camps simples (text/checkbox/select estàtic) ABANS de
   *      les cascades, perquè Mercurio té handlers (p.ex. el del CP) que
   *      poden re-derivar municipi/localitat. Si setem CP ABANS, el handler
   *      ja s'ha disparat quan triem muni manualment.
   *   3. Cascades adreça (provincia → municipi → localitat) AL FINAL.
   */
  async function fillAll(payload) {
    const results = [];

    // Phase 1: radio supuesto + click()
    if (payload.datosForAut) {
      results.push(setField('datosForAut', String(payload.datosForAut)));
      await new Promise(r => setTimeout(r, 400));
    }

    // Phase 2: tot menys cascades (incl. CP, expAsilo, etc.)
    for (const [name, value] of Object.entries(payload)) {
      if (name === 'datosForAut') continue;
      if (CASCADE_FIELDS.has(name)) continue;
      results.push(setField(name, String(value)));
    }

    // Phase 3: cascades adreça AL FINAL (perquè handlers anteriors no les resetegin)
    results.push(...await fillCascade(payload));

    return results;
  }

  // ─── UI ─────────────────────────────────────────────────────────────
  function injectPanel() {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;top:16px;right:16px;z-index:99999;background:#fff;border:2px solid #A78BFA;border-radius:8px;padding:12px;box-shadow:0 4px 12px rgba(0,0,0,0.15);font-family:system-ui,sans-serif;font-size:13px;width:280px';
    wrap.innerHTML = \`
      <div style="font-weight:600;color:#7C3AED;margin-bottom:8px">💜 Venus — Auto-Fill</div>
      <input id="rr-search" type="text" placeholder="Cerca cas (nom o cognom)…" style="width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #ccc;border-radius:4px;margin-bottom:6px">
      <div id="rr-results" style="max-height:240px;overflow:auto"></div>
      <div id="rr-status" style="margin-top:8px;font-size:11px;color:#777;max-height:200px;overflow:auto"></div>
    \`;
    document.body.appendChild(wrap);

    const search = wrap.querySelector('#rr-search');
    const results = wrap.querySelector('#rr-results');
    const status = wrap.querySelector('#rr-status');

    // Hint inicial diferent segons pantalla: a la sel screen el panell és
    // info-only (no ompli res), a EX31/EX32 ompli els 144 camps.
    if (location.pathname.includes('seleccionModelo')) {
      status.innerHTML = '<em style="color:#7C3AED">Clica un cas per saber quin formulari triar (EX31/EX32).</em>';
    }

    let timer = null;
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => doSearch(search.value, results, status), 250);
    });
    // Cerca inicial buida = 5 últims casos
    doSearch('', results, status);
  }

  async function doSearch(q, container, status) {
    container.innerHTML = '<em style="font-size:11px;color:#999">Cercant…</em>';
    try {
      const data = await workerGet('/mercurio/cases?q=' + encodeURIComponent(q || ''));
      const cases = data.cases || [];
      if (cases.length === 0) {
        container.innerHTML = '<em style="font-size:11px;color:#999">Cap match.</em>';
        return;
      }
      container.innerHTML = '';
      for (const c of cases) {
        const item = document.createElement('button');
        item.style.cssText = 'display:block;width:100%;text-align:left;padding:6px 8px;margin-bottom:3px;border:1px solid #DDD6FE;background:#F5F3FF;border-radius:4px;cursor:pointer;font-size:12px';
        item.innerHTML = \`<strong>\${escapeHtml(c.nom)} \${escapeHtml(c.cognom1 || '')}</strong> · <span style="color:#666">\${escapeHtml(c.viaLegal || '?')}</span><br><span style="color:#999;font-size:10px">\${escapeHtml(c.idCas)} · \${c.formulario}</span>\`;
        item.addEventListener('click', () => fillCase(c, status));
        container.appendChild(item);
      }
    } catch (e) {
      container.innerHTML = '<span style="color:#c00;font-size:11px">Error: ' + escapeHtml(String(e)) + '</span>';
    }
  }

  async function fillCase(c, statusDiv) {
    // MODE INFO (seleccionModelo-XX.html): no toquem el DOM, només indiquem
    // al voluntari quin radio (EX31 vs EX32) ha de triar manualment. La
    // pantalla de selecció no és prou estable per auto-clicar i a més volem
    // que el voluntari faci la confirmació humana abans de continuar.
    if (location.pathname.includes('seleccionModelo')) {
      statusDiv.innerHTML = \`<div style="padding:8px;background:#F5F3FF;border:1px solid #A78BFA;border-radius:4px"><strong style="color:#7C3AED">📋 Tria \${escapeHtml(c.formulario)}</strong><br><span style="font-size:11px;color:#555">Cas: \${escapeHtml(c.nom)} \${escapeHtml(c.cognom1 || '')} · \${escapeHtml(c.viaLegal || '?')}</span><br><span style="font-size:11px;color:#555;margin-top:4px;display:block">Selecciona <strong>\${escapeHtml(c.formulario)}</strong> al radio i prem <strong>CONTINUAR</strong>. El panell apareixerà al formulari següent per omplir.</span></div>\`;
      return;
    }

    // Verifica form correcte
    const onForm = location.pathname.includes('EX31') ? 'EX31'
                 : location.pathname.includes('EX32') ? 'EX32' : '?';
    if (c.formulario !== onForm) {
      statusDiv.innerHTML = \`<strong style="color:#c00">⚠️ Cas és per \${c.formulario}, ets a \${onForm}.</strong><br>Tornar enrere i triar \${c.formulario} al desplegable.\`;
      return;
    }
    statusDiv.innerHTML = '<em>Carregant payload…</em>';
    try {
      const data = await workerGet('/mercurio/payload?caso=' + encodeURIComponent(c.id));
      statusDiv.innerHTML = '<em>Omplint ' + escapeHtml(c.idCas) + '… (cascades AJAX 1-2s)</em>';
      const results = await fillAll(data.payload);
      const ok = results.filter(r => r.status === 'ok' || r.status === 'ok_cascade').length;
      const skipped = results.filter(r => r.status === 'skipped').length;
      const issues = results.filter(r => !['ok', 'ok_cascade', 'skipped'].includes(r.status));
      let html = '<strong>' + ok + ' OK</strong> · ' + skipped + ' skip · ' + issues.length + ' issues';
      if (issues.length) {
        html += '<details style="margin-top:6px"><summary>Detall</summary><pre style="font-size:10px;white-space:pre-wrap;margin:4px 0 0">';
        for (const r of issues) html += r.name + ': ' + r.status + (r.value ? ' ("' + r.value + '")' : '') + '\\n';
        html += '</pre></details>';
      }
      statusDiv.innerHTML = html;
      console.log('[Venus] fill results:', results);
    } catch (e) {
      statusDiv.innerHTML = '<span style="color:#c00">Error: ' + escapeHtml(String(e)) + '</span>';
    }
  }

  function escapeHtml(s) { return String(s).replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c])); }

  // ─── Boot ───────────────────────────────────────────────────────────
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectPanel);
  else injectPanel();
})();
`;
