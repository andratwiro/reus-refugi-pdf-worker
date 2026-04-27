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
  // Inline SVGs (heart, search, info, arrow). Stroke/fill colors set via CSS
  // currentColor on parent so re-styling només requereix canviar 'color'.
  const ICON_HEART = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';
  const ICON_SEARCH = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
  const ICON_INFO = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
  const ICON_ARROW = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';

  // ─── Styles (scoped) ───────────────────────────────────────────────
  // Tot prefixat .venus-* + reset agressiu per aïllar de l'CSS legacy de
  // Mercurio (jQuery UI, etc.). Inter via Google Fonts amb fallback system.
  function injectStyles() {
    if (document.getElementById('venus-fonts')) return;
    const link = document.createElement('link');
    link.id = 'venus-fonts';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap';
    document.head.appendChild(link);

    const style = document.createElement('style');
    style.id = 'venus-styles';
    style.textContent = \`
      .venus-modal, .venus-modal * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
        font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
        line-height: 1.4;
        color: #1A1424;
      }
      .venus-modal {
        position: fixed;
        top: 16px;
        right: 16px;
        z-index: 99999;
        width: 380px;
        background: #FFFFFF;
        border: 1px solid #E6E1EE;
        border-radius: 12px;
        box-shadow: 0 8px 24px rgba(26, 20, 36, 0.08);
        overflow: hidden;
      }
      .venus-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 14px 16px;
        border-bottom: 1px solid #E6E1EE;
      }
      .venus-header .venus-heart { color: #7C3AED; display: flex; }
      .venus-header .venus-title { font-size: 16px; font-weight: 700; color: #1A1424; }
      .venus-header .venus-sep { color: #B8B0C7; font-weight: 400; font-size: 16px; }
      .venus-header .venus-subtitle { font-size: 14px; font-weight: 400; color: #6B607E; flex: 1; }
      .venus-header .venus-count { font-size: 13px; color: #6B607E; font-variant-numeric: tabular-nums; }

      .venus-search-wrap {
        position: relative;
        padding: 12px 16px 8px;
      }
      .venus-search-icon {
        position: absolute;
        left: 28px;
        top: 50%;
        transform: translateY(-25%);
        color: #6B607E;
        display: flex;
        pointer-events: none;
      }
      .venus-search-input {
        width: 100%;
        padding: 14px 14px 14px 42px;
        font-size: 15px;
        font-weight: 400;
        color: #1A1424;
        background: #F6F3FB;
        border: 1.5px solid #E6E1EE;
        border-radius: 10px;
        outline: none;
        transition: border-color 120ms, box-shadow 120ms;
      }
      .venus-search-input::placeholder { color: #6B607E; }
      .venus-search-input:focus {
        border-color: #7C3AED;
        box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.15);
      }

      .venus-results {
        max-height: 360px;
        overflow-y: auto;
      }
      .venus-row {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 14px 16px;
        cursor: pointer;
        background: #FFFFFF;
        border: none;
        width: 100%;
        text-align: left;
        transition: background 100ms;
      }
      .venus-row:hover, .venus-row:focus-visible {
        background: #F4EFFB;
        outline: none;
      }
      .venus-row + .venus-row { border-top: 1px solid #F0ECF5; }

      .venus-badge {
        flex: 0 0 auto;
        width: 56px;
        height: 40px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 13px;
        font-weight: 800;
        letter-spacing: 0.02em;
        border-radius: 8px;
        font-variant-numeric: tabular-nums;
      }
      .venus-badge-ex31 { background: #D6F0EE; color: #0E6F6F; }
      .venus-badge-ex32 { background: #FCE8C9; color: #8A4B00; }

      .venus-row-content {
        flex: 1 1 auto;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .venus-name {
        font-size: 16px;
        font-weight: 600;
        color: #1A1424;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .venus-meta {
        font-size: 13px;
        font-weight: 400;
        color: #6B607E;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .venus-meta .venus-id { font-variant-numeric: tabular-nums; }
      .venus-meta .venus-dot { margin: 0 6px; color: #B8B0C7; }

      .venus-row-arrow {
        flex: 0 0 auto;
        color: #6B607E;
        opacity: 0;
        transition: opacity 100ms;
        display: flex;
      }
      .venus-row:hover .venus-row-arrow { opacity: 1; }

      .venus-empty {
        padding: 24px 16px;
        text-align: center;
        font-size: 13px;
        color: #6B607E;
      }

      .venus-status:empty { display: none; }
      .venus-status {
        padding: 12px 16px;
        font-size: 13px;
        color: #6B607E;
        border-top: 1px solid #E6E1EE;
        max-height: 220px;
        overflow-y: auto;
      }
      .venus-status .venus-status-ok { color: #0E6F6F; font-weight: 600; }
      .venus-status .venus-status-warn { color: #8A4B00; font-weight: 600; }
      .venus-status .venus-status-err { color: #B91C1C; font-weight: 600; }
      .venus-status details { margin-top: 6px; }
      .venus-status summary { cursor: pointer; color: #7C3AED; font-size: 12px; }
      .venus-status pre {
        font-family: ui-monospace, SFMono-Regular, monospace;
        font-size: 11px;
        color: #1A1424;
        white-space: pre-wrap;
        margin-top: 4px;
        padding: 6px 8px;
        background: #F6F3FB;
        border-radius: 6px;
      }
      .venus-status .venus-info-card {
        padding: 10px 12px;
        background: #F4EFFB;
        border: 1px solid #E6E1EE;
        border-radius: 8px;
        color: #1A1424;
      }
      .venus-status .venus-info-card .venus-info-title {
        font-size: 14px;
        font-weight: 700;
        color: #7C3AED;
        margin-bottom: 4px;
      }

      .venus-footer {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 16px;
        background: #FAF8FD;
        border-top: 1px solid #E6E1EE;
        font-size: 13px;
        color: #6B607E;
      }
      .venus-footer .venus-footer-icon { color: #6B607E; display: flex; }
    \`;
    document.head.appendChild(style);
  }

  function injectPanel() {
    injectStyles();

    const wrap = document.createElement('div');
    wrap.className = 'venus-modal';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-label', 'Venus — Auto-emplenar formulari Mercurio');
    wrap.innerHTML = \`
      <div class="venus-header">
        <span class="venus-heart">\${ICON_HEART}</span>
        <span class="venus-title">Venus</span>
        <span class="venus-sep">—</span>
        <span class="venus-subtitle">Auto-emplenar formulari</span>
        <span class="venus-count" id="venus-count"></span>
      </div>
      <div class="venus-search-wrap">
        <span class="venus-search-icon">\${ICON_SEARCH}</span>
        <input id="venus-search" type="text" class="venus-search-input" placeholder="Cerca per nom o cognom…" autocomplete="off" spellcheck="false">
      </div>
      <div id="venus-results" class="venus-results"></div>
      <div id="venus-status" class="venus-status"></div>
      <div class="venus-footer">
        <span class="venus-footer-icon">\${ICON_INFO}</span>
        <span id="venus-footer-text">\${footerText()}</span>
      </div>
    \`;
    document.body.appendChild(wrap);

    const search = wrap.querySelector('#venus-search');
    const results = wrap.querySelector('#venus-results');
    const status = wrap.querySelector('#venus-status');
    const count = wrap.querySelector('#venus-count');

    let timer = null;
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => doSearch(search.value, results, status, count), 250);
    });
    // Cerca inicial buida = darrers casos
    doSearch('', results, status, count);
  }

  function footerText() {
    return location.pathname.includes('seleccionModelo')
      ? 'Clica un cas per saber quin formulari triar (EX31/EX32)'
      : 'Clica un cas per emplenar el formulari automàticament';
  }

  // Parseig: "RR-003-DAYNER--ACEVEDO" → "RR-003"
  function shortIdCas(idCas) {
    const m = String(idCas || '').match(/^(RR-\\d+)/);
    return m ? m[1] : (idCas || '');
  }
  // Parseig: "DA 20ª – Sol·licitant PI" → ["DA 20ª", "Sol·licitant PI"]
  function splitViaLegal(viaLegal) {
    const s = String(viaLegal || '');
    const idx = s.indexOf(' – ');
    if (idx === -1) return [s, ''];
    return [s.slice(0, idx), s.slice(idx + 3)];
  }

  async function doSearch(q, container, status, count) {
    container.innerHTML = '<div class="venus-empty">Cercant…</div>';
    count.textContent = '';
    try {
      const data = await workerGet('/mercurio/cases?q=' + encodeURIComponent(q || ''));
      const cases = data.cases || [];
      if (cases.length === 0) {
        container.innerHTML = '<div class="venus-empty">Cap cas trobat.</div>';
        count.textContent = '';
        return;
      }
      count.textContent = cases.length + (cases.length === 1 ? ' cas' : ' casos');
      container.innerHTML = '';
      for (const c of cases) {
        const row = document.createElement('button');
        row.className = 'venus-row';
        row.type = 'button';
        const badgeClass = c.formulario === 'EX31' ? 'venus-badge-ex31' : 'venus-badge-ex32';
        const [da, tag] = splitViaLegal(c.viaLegal);
        const fullName = (escapeHtml(c.nom || '') + ' ' + escapeHtml(c.cognom1 || '')).trim() || '—';
        const metaParts = [
          \`<span class="venus-id">\${escapeHtml(shortIdCas(c.idCas))}</span>\`,
          escapeHtml(da || '?'),
          tag ? escapeHtml(tag) : null,
        ].filter(Boolean);
        const metaHtml = metaParts.join('<span class="venus-dot">·</span>');
        row.innerHTML = \`
          <span class="venus-badge \${badgeClass}">\${escapeHtml(c.formulario || '')}</span>
          <span class="venus-row-content">
            <span class="venus-name">\${fullName}</span>
            <span class="venus-meta">\${metaHtml}</span>
          </span>
          <span class="venus-row-arrow">\${ICON_ARROW}</span>
        \`;
        row.addEventListener('click', () => fillCase(c, status));
        container.appendChild(row);
      }
    } catch (e) {
      container.innerHTML = '<div class="venus-empty"><span class="venus-status-err">Error:</span> ' + escapeHtml(String(e)) + '</div>';
      count.textContent = '';
    }
  }

  async function fillCase(c, statusDiv) {
    // MODE INFO (seleccionModelo-XX.html): no toquem el DOM, només indiquem
    // al voluntari quin radio (EX31 vs EX32) ha de triar manualment.
    if (location.pathname.includes('seleccionModelo')) {
      statusDiv.innerHTML = \`
        <div class="venus-info-card">
          <div class="venus-info-title">Tria \${escapeHtml(c.formulario)}</div>
          <div>Cas: <strong>\${escapeHtml(c.nom || '')} \${escapeHtml(c.cognom1 || '')}</strong> · \${escapeHtml(c.viaLegal || '?')}</div>
          <div style="margin-top:6px">Selecciona <strong>\${escapeHtml(c.formulario)}</strong> al radio i prem <strong>CONTINUAR</strong>. El panell apareixerà al formulari següent per emplenar-lo.</div>
        </div>
      \`;
      return;
    }

    // Verifica form correcte
    const onForm = location.pathname.includes('EX31') ? 'EX31'
                 : location.pathname.includes('EX32') ? 'EX32' : '?';
    if (c.formulario !== onForm) {
      statusDiv.innerHTML = \`<span class="venus-status-err">⚠️ Cas és per \${escapeHtml(c.formulario)}, ets a \${escapeHtml(onForm)}.</span> Torna enrere i tria \${escapeHtml(c.formulario)}.\`;
      return;
    }
    statusDiv.innerHTML = 'Carregant payload…';
    try {
      const data = await workerGet('/mercurio/payload?caso=' + encodeURIComponent(c.id));
      statusDiv.innerHTML = 'Emplenant ' + escapeHtml(shortIdCas(c.idCas)) + '… <span style="color:#B8B0C7">(cascades AJAX 1-2s)</span>';
      const results = await fillAll(data.payload);
      const ok = results.filter(r => r.status === 'ok' || r.status === 'ok_cascade').length;
      const skipped = results.filter(r => r.status === 'skipped').length;
      const issues = results.filter(r => !['ok', 'ok_cascade', 'skipped'].includes(r.status));
      let html = \`<span class="venus-status-ok">\${ok} OK</span> · \${skipped} skip · \`;
      html += issues.length
        ? \`<span class="venus-status-warn">\${issues.length} issues</span>\`
        : \`<span>0 issues</span>\`;
      if (issues.length) {
        html += '<details><summary>Detall</summary><pre>';
        for (const r of issues) html += escapeHtml(r.name) + ': ' + escapeHtml(r.status) + (r.value ? ' ("' + escapeHtml(String(r.value)) + '")' : '') + '\\n';
        html += '</pre></details>';
      }
      statusDiv.innerHTML = html;
      console.log('[Venus] fill results:', results);
    } catch (e) {
      statusDiv.innerHTML = '<span class="venus-status-err">Error:</span> ' + escapeHtml(String(e));
    }
  }

  function escapeHtml(s) { return String(s).replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c])); }

  // ─── Boot ───────────────────────────────────────────────────────────
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectPanel);
  else injectPanel();
})();
`;
