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

    // Phase 2-bis: retry de camps not_found. Alguns inputs es renderitzen
    // condicionalment després d'un canvi de checkbox/radio (p.ex.
    // descActividadDecla3 només apareix si chkDecla3 marcat). Si el
    // handler de Mercurio és async i la primera iteració no troba el DOM,
    // esperem 300ms i fem un re-fill només per als not_found.
    const notFoundIdx = [];
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'not_found') notFoundIdx.push(i);
    }
    if (notFoundIdx.length > 0) {
      await new Promise(r => setTimeout(r, 300));
      for (const idx of notFoundIdx) {
        const orig = results[idx];
        const v = payload[orig.name];
        if (!v) continue;
        const retry = setField(orig.name, String(v));
        if (retry.status === 'ok') {
          results[idx] = { name: orig.name, status: 'ok_retry', value: retry.value };
        }
      }
    }

    // Phase 3: cascades adreça AL FINAL (perquè handlers anteriors no les resetegin)
    results.push(...await fillCascade(payload));

    return results;
  }

  // ─── UI ─────────────────────────────────────────────────────────────
  // Inline SVGs (heart, search, info, arrow). Stroke/fill colors set via CSS
  // currentColor on parent so re-styling només requereix canviar 'color'.
  const ICON_HEART = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
  const ICON_SEARCH = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
  const ICON_INFO = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
  const ICON_ARROW = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';
  const ICON_CHECK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>';
  const ICON_ALERT = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>';

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
    // NB: tots els selectors interns prefixats amb .venus-modal per garantir
    // (0,2,0) d'especificitat — supera el reset universal '.venus-modal *'
    // (0,1,1) i evita que els resets de Mercurio (jQuery UI / antic) afectin.
    // El reset universal NO toca 'color' per deixar que els SVG heretin del
    // span pare via currentColor (cor púrpura, lupa gris, etc.).
    style.textContent = \`
      .venus-modal {
        font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
        font-size: 14px;
        line-height: 1.4;
        color: #1A1424;
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
      .venus-modal, .venus-modal *, .venus-modal *::before, .venus-modal *::after {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }
      .venus-modal .venus-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 14px 16px;
        border-bottom: 1px solid #E6E1EE;
      }
      .venus-modal .venus-heart { color: #7C3AED; display: flex; }
      .venus-modal .venus-title { font-size: 16px; font-weight: 700; color: #1A1424; }
      .venus-modal .venus-sep { color: #B8B0C7; font-weight: 400; font-size: 16px; }
      .venus-modal .venus-subtitle { font-size: 14px; font-weight: 400; color: #6B607E; flex: 1; }
      .venus-modal .venus-count { font-size: 13px; color: #6B607E; font-variant-numeric: tabular-nums; }

      .venus-modal .venus-search-wrap {
        position: relative;
        padding: 12px 16px 8px;
      }
      .venus-modal .venus-search-icon {
        position: absolute;
        left: 28px;
        top: 50%;
        transform: translateY(-50%);
        color: #6B607E;
        display: flex;
        pointer-events: none;
      }
      .venus-modal .venus-search-input {
        display: block;
        width: 100%;
        padding: 14px 14px 14px 42px;
        font-size: 15px;
        font-weight: 400;
        font-family: inherit;
        color: #1A1424;
        background: #F6F3FB;
        border: 1.5px solid #E6E1EE;
        border-radius: 10px;
        outline: none;
        transition: border-color 120ms, box-shadow 120ms;
      }
      .venus-modal .venus-search-input::placeholder { color: #6B607E; opacity: 1; }
      .venus-modal .venus-search-input:focus {
        border-color: #7C3AED;
        box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.15);
      }

      /* Container amb padding lateral per inset les files del modal edge.
       * gap entre files (substitueix el border-top divider) perquè el
       * border-radius dels rows es vegi sense clip. */
      .venus-modal .venus-results {
        max-height: 360px;
        overflow-y: auto;
        padding: 4px 8px 8px;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      /* Row base — idle. 1.5px transparent border reserva l'espai per
       * evitar layout-shift quan saltem a estats colored. border-radius
       * 10px perquè els borders colored (filling/done/error) tinguin
       * cantonades suaus i no toquin el border del modal. */
      .venus-modal .venus-row {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 14px 12px;
        cursor: pointer;
        background: #FFFFFF;
        border: 1.5px solid transparent;
        border-radius: 10px;
        width: 100%;
        text-align: left;
        font-family: inherit;
        font-size: 14px;
        color: inherit;
        transition: background 100ms, border-color 100ms;
      }
      .venus-modal .venus-row:hover,
      .venus-modal .venus-row:focus,
      .venus-modal .venus-row:active {
        background: #F4EFFB;
        outline: none;
      }
      .venus-modal .venus-row:focus-visible {
        background: #F4EFFB;
        border-color: #7C3AED;
        outline: none;
      }

      /* Row state overrides — declarats després perquè la cadena hover/focus
       * no els sobreescrigui. Tot l'estat manté la mateixa paleta. */
      .venus-modal .venus-row[data-state="filling"],
      .venus-modal .venus-row[data-state="filling"]:hover,
      .venus-modal .venus-row[data-state="filling"]:focus,
      .venus-modal .venus-row[data-state="filling"]:active,
      .venus-modal .venus-row[data-state="filling"]:focus-visible {
        background: #F0EAFB;
        border-color: #7C3AED;
      }
      .venus-modal .venus-row[data-state="done"],
      .venus-modal .venus-row[data-state="done"]:hover,
      .venus-modal .venus-row[data-state="done"]:focus,
      .venus-modal .venus-row[data-state="done"]:active,
      .venus-modal .venus-row[data-state="done"]:focus-visible {
        background: #E8F5EE;
        border-color: #0E7A45;
      }
      .venus-modal .venus-row[data-state="done"] .venus-name { color: #0E3A22; }
      .venus-modal .venus-row[data-state="done"] .venus-meta { color: #3D6B52; }
      .venus-modal .venus-row[data-state="error"],
      .venus-modal .venus-row[data-state="error"]:hover,
      .venus-modal .venus-row[data-state="error"]:focus,
      .venus-modal .venus-row[data-state="error"]:active,
      .venus-modal .venus-row[data-state="error"]:focus-visible {
        background: #FCEBEA;
        border-color: #B42318;
      }
      .venus-modal .venus-row[data-state="error"] .venus-name { color: #5A1410; }
      .venus-modal .venus-row[data-state="error"] .venus-meta { color: #8A3A33; }

      .venus-modal .venus-badge {
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
      .venus-modal .venus-badge-ex31 { background: #D6F0EE; color: #0E6F6F; }
      .venus-modal .venus-badge-ex32 { background: #FCE8C9; color: #8A4B00; }

      .venus-modal .venus-row-content {
        flex: 1 1 auto;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .venus-modal .venus-name {
        font-size: 16px;
        font-weight: 600;
        color: #1A1424;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .venus-modal .venus-meta {
        font-size: 13px;
        font-weight: 400;
        color: #6B607E;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .venus-modal .venus-id { font-variant-numeric: tabular-nums; }
      .venus-modal .venus-dot { margin: 0 6px; color: #B8B0C7; }

      /* Row tail — slot dret (hint hover/focus, spinner, check, alert).
       * Color base #6B607E gris; per estats canvia a la color del border. */
      .venus-modal .venus-row-tail {
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        font-weight: 500;
        white-space: nowrap;
        color: #6B607E;
        min-height: 18px;
      }
      .venus-modal .venus-row[data-state="filling"] .venus-row-tail { color: #7C3AED; }
      .venus-modal .venus-row[data-state="done"] .venus-row-tail { color: #0E7A45; }
      .venus-modal .venus-row[data-state="error"] .venus-row-tail { color: #B42318; }

      .venus-modal .venus-row-hint-hover,
      .venus-modal .venus-row-hint-focus {
        display: none;
        align-items: center;
      }
      .venus-modal .venus-row[data-state="idle"]:hover .venus-row-hint-hover {
        display: flex;
        color: #6B607E;
      }
      .venus-modal .venus-row[data-state="idle"]:focus-visible .venus-row-hint-hover {
        display: none;
      }
      .venus-modal .venus-row[data-state="idle"]:focus-visible .venus-row-hint-focus {
        display: flex;
        color: #7C3AED;
        font-weight: 600;
      }

      /* Spinner */
      .venus-modal .venus-spinner {
        width: 14px;
        height: 14px;
        border: 2px solid rgba(124, 58, 237, 0.25);
        border-top-color: #7C3AED;
        border-radius: 50%;
        animation: venus-spin 0.8s linear infinite;
        display: inline-block;
        flex: 0 0 auto;
      }
      @keyframes venus-spin { to { transform: rotate(360deg); } }

      .venus-modal .venus-empty {
        padding: 24px 16px;
        text-align: center;
        font-size: 13px;
        color: #6B607E;
      }

      /* Status (progress block / info card / errors) */
      .venus-modal .venus-status:empty { display: none; }
      .venus-modal .venus-status {
        padding: 12px 16px;
        font-size: 13px;
        color: #1A1424;
        border-top: 1px solid #E6E1EE;
      }

      .venus-modal .venus-progress-block {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .venus-modal .venus-progress-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 13px;
        color: #1A1424;
        font-weight: 500;
      }
      .venus-modal .venus-progress-detail-link {
        font-size: 13px;
        color: #7C3AED;
        text-decoration: none;
        font-weight: 500;
        cursor: pointer;
        background: none;
        border: none;
        font-family: inherit;
      }
      .venus-modal .venus-progress-detail-link:hover { text-decoration: underline; }
      .venus-modal .venus-progress-bar {
        display: flex;
        height: 6px;
        background: #F0ECF5;
        border-radius: 3px;
        overflow: hidden;
      }
      .venus-modal .venus-progress-seg-ok { background: #0E7A45; height: 100%; }
      .venus-modal .venus-progress-seg-skip { background: #D58A1A; height: 100%; }
      .venus-modal .venus-progress-seg-err { background: #B42318; height: 100%; }
      .venus-modal .venus-progress-legend {
        display: flex;
        gap: 16px;
        font-size: 12px;
        color: #6B607E;
        flex-wrap: wrap;
      }
      .venus-modal .venus-legend-item { display: flex; align-items: center; gap: 6px; }
      .venus-modal .venus-legend-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        display: inline-block;
        flex: 0 0 auto;
      }
      .venus-modal .venus-dot-ok { background: #0E7A45; }
      .venus-modal .venus-dot-skip { background: #D58A1A; }
      .venus-modal .venus-dot-err { background: #B42318; }
      .venus-modal .venus-legend-item strong {
        font-weight: 600;
        color: #1A1424;
        font-variant-numeric: tabular-nums;
      }
      .venus-modal .venus-progress-detail-panel {
        display: none;
        margin-top: 4px;
        padding: 8px 10px;
        background: #F6F3FB;
        border-radius: 6px;
        font-family: ui-monospace, SFMono-Regular, monospace;
        font-size: 11px;
        color: #1A1424;
        white-space: pre-wrap;
        max-height: 160px;
        overflow-y: auto;
      }
      .venus-modal .venus-progress-detail-panel.open { display: block; }

      .venus-modal .venus-info-card {
        padding: 10px 12px;
        background: #F4EFFB;
        border: 1px solid #E6E1EE;
        border-radius: 8px;
        color: #1A1424;
      }
      .venus-modal .venus-info-title {
        font-size: 14px;
        font-weight: 700;
        color: #7C3AED;
        margin-bottom: 4px;
      }
      .venus-modal .venus-error-line { color: #B42318; font-weight: 600; }

      .venus-modal .venus-footer {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 16px;
        background: #FAF8FD;
        border-top: 1px solid #E6E1EE;
        font-size: 13px;
        color: #6B607E;
      }
      .venus-modal .venus-footer-icon { color: #6B607E; display: flex; flex: 0 0 auto; }
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

  // Footer copy per estat (idle/filling/done/error). El voluntari veu el
  // missatge actualitzat segons l'estat actual del fill.
  const FOOTER_IDLE    = 'Clica un cas per emplenar el formulari automàticament';
  const FOOTER_FILLING = 'Emplenant camps… no tanquis aquesta finestra';
  const FOOTER_DONE    = 'Formulari emplenat. Revisa abans d\\'enviar.';
  function footerText() { return FOOTER_IDLE; }
  function setFooterText(t) {
    const el = document.getElementById('venus-footer-text');
    if (el) el.textContent = t;
  }
  function footerError(n) {
    return n === 1
      ? 'Hi ha 1 camp que no s\\'ha pogut emplenar. Revisa\\'l.'
      : \`Hi ha \${n} camps que no s'han pogut emplenar. Revisa'ls.\`;
  }

  // Estat visual de la fila (idle/filling/done/error). Només una fila pot
  // estar en estat actiu (filling/done/error) alhora — quan posem estat a
  // una nova, reseten les altres a idle.
  function setRowState(row, state) {
    if (!row) return;
    if (state !== 'idle') {
      const all = document.querySelectorAll('.venus-modal .venus-row');
      for (const r of all) {
        if (r !== row && r.dataset.state !== 'idle') {
          r.dataset.state = 'idle';
          const t = r.querySelector('.venus-row-tail');
          if (t) t.innerHTML = '<span class="venus-row-hint-hover">' + ICON_ARROW + '</span><span class="venus-row-hint-focus">↵ Enter</span>';
        }
      }
    }
    row.dataset.state = state;
    const tail = row.querySelector('.venus-row-tail');
    if (!tail) return;
    if (state === 'filling') {
      tail.innerHTML = '<span class="venus-spinner"></span><span>Emplenant…</span>';
    } else if (state === 'done') {
      tail.innerHTML = ICON_CHECK + '<span>Emplenat</span>';
    } else if (state === 'error') {
      tail.innerHTML = ICON_ALERT + '<span>Error</span>';
    } else {
      tail.innerHTML = '<span class="venus-row-hint-hover">' + ICON_ARROW + '</span><span class="venus-row-hint-focus">↵ Enter</span>';
    }
  }

  // Renderitza la barra de progrés segmentada + llegenda + "Veure detall".
  // ok/skip/err són els counts; issues és l'array per al detall expandible.
  function renderProgress(statusDiv, ok, skip, err, issues) {
    const total = ok + skip + err;
    const segs = [];
    if (ok > 0)   segs.push(\`<div class="venus-progress-seg-ok" style="flex:\${ok}"></div>\`);
    if (skip > 0) segs.push(\`<div class="venus-progress-seg-skip" style="flex:\${skip}"></div>\`);
    if (err > 0)  segs.push(\`<div class="venus-progress-seg-err" style="flex:\${err}"></div>\`);
    const detailLink = issues && issues.length
      ? '<button type="button" class="venus-progress-detail-link" id="venus-detail-link">Veure detall →</button>'
      : '';
    statusDiv.innerHTML = \`
      <div class="venus-progress-block">
        <div class="venus-progress-header">
          <span>Emplenat <strong>\${ok}</strong> de <strong>\${total}</strong> camps</span>
          \${detailLink}
        </div>
        <div class="venus-progress-bar">\${segs.join('')}</div>
        <div class="venus-progress-legend">
          <span class="venus-legend-item"><span class="venus-legend-dot venus-dot-ok"></span><strong>\${ok}</strong> emplenats</span>
          <span class="venus-legend-item"><span class="venus-legend-dot venus-dot-skip"></span><strong>\${skip}</strong> omesos</span>
          <span class="venus-legend-item"><span class="venus-legend-dot venus-dot-err"></span><strong>\${err}</strong> errors</span>
        </div>
        <div class="venus-progress-detail-panel" id="venus-detail-panel"></div>
      </div>
    \`;
    if (issues && issues.length) {
      const link = document.getElementById('venus-detail-link');
      const panel = document.getElementById('venus-detail-panel');
      let lines = '';
      for (const r of issues) {
        lines += escapeHtml(r.name) + ': ' + escapeHtml(r.status);
        if (r.value) lines += ' ("' + escapeHtml(String(r.value)) + '")';
        lines += '\\n';
      }
      panel.textContent = lines;
      link.addEventListener('click', () => panel.classList.toggle('open'));
    }
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
        row.dataset.state = 'idle';
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
          <span class="venus-row-tail">
            <span class="venus-row-hint-hover">\${ICON_ARROW}</span>
            <span class="venus-row-hint-focus">↵ Enter</span>
          </span>
        \`;
        row.addEventListener('click', () => fillCase(c, status, row));
        container.appendChild(row);
      }
    } catch (e) {
      container.innerHTML = '<div class="venus-empty"><span class="venus-status-err">Error:</span> ' + escapeHtml(String(e)) + '</div>';
      count.textContent = '';
    }
  }

  async function fillCase(c, statusDiv, row) {
    // MODE INFO (seleccionModelo-XX.html): no toquem el DOM ni l'estat de
    // la fila, només indiquem al voluntari quin radio ha de triar.
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

    // Verifica form correcte (EX31 vs EX32)
    const onForm = location.pathname.includes('EX31') ? 'EX31'
                 : location.pathname.includes('EX32') ? 'EX32' : '?';
    if (c.formulario !== onForm) {
      setRowState(row, 'error');
      statusDiv.innerHTML = \`<span class="venus-error-line">El cas és per \${escapeHtml(c.formulario)}, però ets a \${escapeHtml(onForm)}.</span><br>Torna enrere i tria <strong>\${escapeHtml(c.formulario)}</strong>.\`;
      setFooterText('Pantalla incompatible amb aquest cas.');
      return;
    }

    // Estat: FILLING — barra activa al primer instant.
    setRowState(row, 'filling');
    setFooterText(FOOTER_FILLING);
    statusDiv.innerHTML = '';

    try {
      const data = await workerGet('/mercurio/payload?caso=' + encodeURIComponent(c.id));
      const results = await fillAll(data.payload);
      const okStatuses = new Set(['ok', 'ok_cascade', 'ok_cascade_retry', 'ok_retry']);
      const ok = results.filter(r => okStatuses.has(r.status)).length;
      const skipped = results.filter(r => r.status === 'skipped').length;
      const issues = results.filter(r => !okStatuses.has(r.status) && r.status !== 'skipped');

      // Estat final: DONE si 0 issues, ERROR altrament.
      setRowState(row, issues.length === 0 ? 'done' : 'error');
      renderProgress(statusDiv, ok, skipped, issues.length, issues);
      setFooterText(issues.length === 0 ? FOOTER_DONE : footerError(issues.length));
      console.log('[Venus] fill results:', results);
    } catch (e) {
      setRowState(row, 'error');
      statusDiv.innerHTML = '<span class="venus-error-line">Error en carregar el cas:</span><br>' + escapeHtml(String(e));
      setFooterText('No s\\'ha pogut carregar. Comprova la connexió.');
    }
  }

  function escapeHtml(s) { return String(s).replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c])); }

  // ─── Boot ───────────────────────────────────────────────────────────
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectPanel);
  else injectPanel();
})();
`;
