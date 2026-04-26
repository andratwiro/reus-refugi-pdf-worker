// ==UserScript==
// @name         Reus Refugi — Mercurio Auto-Fill
// @namespace    https://reusrefugi.cat
// @version      0.4.0
// @description  Botó "Omplir des d'Airtable" als forms EX-31 / EX-32 de Mercurio. Omple ~50 camps automàticament. NO submiteja.
// @match        https://mercurio.delegaciondelgobierno.gob.es/mercurio/nuevaSolicitud-EX31.html*
// @match        https://mercurio.delegaciondelgobierno.gob.es/mercurio/nuevaSolicitud-EX32.html*
// @match        http://localhost:3001/mercurio/nuevaSolicitud-EX31.html*
// @match        http://localhost:3001/mercurio/nuevaSolicitud-EX32.html*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  // ─── PAYLOADS (generats per scripts/build-userscript.ts) ─────────────
  const PAYLOADS = __PAYLOADS_PLACEHOLDER__;

  // ─── Config ──────────────────────────────────────────────────────────

  /**
   * Camps cascada: cal omplir-los EN ORDRE i ESPERAR que l'AJAX populi el
   * select abans de setejar el següent.
   */
  const CASCADE_FIELDS = new Set([
    'extCodigoProvincia', 'extCodigoMunicipio', 'extCodigoLocalidad',
    'reaCodigoProvinciaReagrupante', 'reaCodigoMunicipioReagrupante', 'reaCodigoLocalidadReagrupante',
    'preCodigoProvinciaPresentador', 'preCodigoMunicipioPresentador', 'preCodigoLocalidadPresentador',
  ]);

  /** Camps que NO omplim (managed by Mercurio o redundant). */
  const SKIP_FIELDS = new Set([
    'reaCodigoMunicipioReagrupante', 'reaCodigoLocalidadReagrupante',
    'preCodigoMunicipioPresentador', 'preCodigoLocalidadPresentador',
    // Presentador i notificació: Mercurio ho prefilla amb el cert Cl@ve.
    'preNombrePresentador', 'preTipodocumentoPresentador', 'preNiePresentador',
    'notNombreNotificacion', 'notTipodocumentoNotificacion', 'notNieNotificacion',
    // Shadows _chk* — el form els envia automàticament, no cal omplir
    '_chkDecla1', '_chkDecla2', '_chkDecla3',
    '_chkIncapacidad', '_chkConsientoConsultaDocumentos', '_chkConsentimientoNotificacion',
  ]);

  // ─── Fill primitives ─────────────────────────────────────────────────

  function fireEvents(el, types) {
    for (const t of types) {
      el.dispatchEvent(new Event(t, { bubbles: true }));
    }
    // Fire jQuery events too — Mercurio usa jQuery 3.4.1 amb handlers bound via jQuery
    if (window.jQuery) {
      try {
        for (const t of types) window.jQuery(el).trigger(t);
      } catch (e) { /* noop */ }
    }
  }

  function setField(name, value) {
    if (SKIP_FIELDS.has(name)) return { name, status: 'skipped' };

    // Pot haver-hi múltiples elements (radios), però per ara assumim un sol
    const els = document.querySelectorAll(`[name="${CSS.escape(name)}"]`);
    if (els.length === 0) return { name, status: 'not_found', value };

    const el = els[0];
    const tag = el.tagName.toLowerCase();
    const type = (el.type || '').toLowerCase();

    try {
      if (tag === 'select') {
        // Verify option exists; if not, log and skip
        const opt = [...el.options].find(o => o.value === value);
        if (!opt) return { name, status: 'invalid_option', value, available: [...el.options].map(o => o.value).slice(0, 6) };
        el.value = value;
        fireEvents(el, ['change']);
        return { name, status: 'ok', value };
      }
      if (type === 'checkbox') {
        const wantChecked = value === 'true' || value === 'on';
        if (el.checked !== wantChecked) {
          el.checked = wantChecked;
          // NO 'click' — click és un toggle i invertiria l'estat just setejat
          fireEvents(el, ['change']);
        }
        return { name, status: 'ok', value: wantChecked ? 'checked' : 'unchecked' };
      }
      if (type === 'radio') {
        // Per radios, native click() dispara el handler complet (que pot
        // mostrar inputs dinàmics com expAsilo). 'change' sol no és suficient.
        for (const r of els) {
          if (r.value === value) { r.click(); break; }
        }
        return { name, status: 'ok', value };
      }
      // text, email, date, hidden, tel, etc.
      el.value = value;
      fireEvents(el, ['input', 'change']);
      return { name, status: 'ok', value };
    } catch (e) {
      return { name, status: 'error', value, error: String(e) };
    }
  }

  /**
   * Espera fins que un select tingui una opció amb un cert value.
   * Útil per cascades AJAX: provincia → AJAX → opcions municipi disponibles.
   */
  async function waitForOption(name, value, timeoutMs = 3000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const el = document.querySelector(`[name="${CSS.escape(name)}"]`);
      if (el && el.options) {
        for (const o of el.options) {
          if (o.value === value) return el;
        }
      }
      await new Promise(r => setTimeout(r, 80));
    }
    return null;
  }

  /**
   * Cascada: setejar selects en ordre, esperant que cada AJAX completi.
   * Retorna un array de resultats (un per camp cascada).
   */
  async function fillCascade(payload) {
    const results = [];
    const blocks = [
      ['extCodigoProvincia', 'extCodigoMunicipio', 'extCodigoLocalidad'],
      ['reaCodigoProvinciaReagrupante', 'reaCodigoMunicipioReagrupante', 'reaCodigoLocalidadReagrupante'],
      ['preCodigoProvinciaPresentador', 'preCodigoMunicipioPresentador', 'preCodigoLocalidadPresentador'],
    ];
    for (const block of blocks) {
      const [, muniName, locName] = block;
      if (!payload[muniName] && !payload[locName]) continue;  // skip block if no muni/loc
      for (const fieldName of block) {
        const value = payload[fieldName];
        if (!value) continue;
        const el = await waitForOption(fieldName, value, 3000);
        if (!el) { results.push({ name: fieldName, status: 'cascade_timeout', value }); continue; }
        el.value = value;
        fireEvents(el, ['change']);
        results.push({ name: fieldName, status: 'ok_cascade', value });
        await new Promise(r => setTimeout(r, 200));
      }
    }
    // Verification retry pass — si muni/loc d'ext s'han esborrat, refer.
    await new Promise(r => setTimeout(r, 600));
    for (const fieldName of ['extCodigoMunicipio', 'extCodigoLocalidad']) {
      const wanted = payload[fieldName];
      if (!wanted) continue;
      const el = document.querySelector('[name="' + CSS.escape(fieldName) + '"]');
      if (!el || el.value === wanted) continue;
      const opt = await waitForOption(fieldName, wanted, 1500);
      if (!opt) { results.push({ name: fieldName, status: 'cascade_timeout_retry', value: wanted }); continue; }
      el.value = wanted;
      fireEvents(el, ['change']);
      results.push({ name: fieldName, status: 'ok_cascade_retry', value: wanted });
      await new Promise(r => setTimeout(r, 200));
    }
    return results;
  }

  /**
   * Omple en 3 fases:
   *   1. Radio supuesto (datosForAut) → click() injecta camps dinàmics (expAsilo)
   *   2. Tots els camps simples (incl. CP, expAsilo) ABANS de les cascades
   *   3. Cascades adreça AL FINAL (perquè CP handler no resetegi munis)
   */
  async function fillAll(payload) {
    const results = [];
    if (payload.datosForAut) {
      results.push(setField('datosForAut', String(payload.datosForAut)));
      await new Promise(r => setTimeout(r, 400));
    }
    for (const [name, value] of Object.entries(payload)) {
      if (name === 'datosForAut') continue;
      if (CASCADE_FIELDS.has(name)) continue;
      results.push(setField(name, String(value)));
    }
    results.push(...await fillCascade(payload));
    return results;
  }

  // ─── UI ──────────────────────────────────────────────────────────────

  function injectButton() {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
      position: fixed; top: 16px; right: 16px; z-index: 99999;
      background: #fff; border: 2px solid #2563eb; border-radius: 8px;
      padding: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      font-family: system-ui, sans-serif; font-size: 13px; max-width: 280px;
    `;
    wrapper.innerHTML = `
      <div style="font-weight: 600; color: #2563eb; margin-bottom: 6px">
        🚀 Reus Refugi — Auto-Fill
      </div>
      <div style="margin-bottom: 8px; color: #555">
        Tria un cas i clica per omplir el form. <strong>NO submiteja.</strong>
      </div>
      <div id="rr-buttons"></div>
      <div id="rr-status" style="margin-top: 8px; font-size: 11px; color: #777; max-height: 200px; overflow: auto"></div>
    `;
    document.body.appendChild(wrapper);

    const buttonsDiv = wrapper.querySelector('#rr-buttons');
    const statusDiv = wrapper.querySelector('#rr-status');

    for (const [caseId, payload] of Object.entries(PAYLOADS)) {
      const btn = document.createElement('button');
      btn.textContent = `Omplir ${caseId}`;
      btn.style.cssText = `
        display: block; width: 100%; padding: 8px; margin-bottom: 4px;
        background: #2563eb; color: #fff; border: 0; border-radius: 4px;
        cursor: pointer; font-weight: 500;
      `;
      btn.addEventListener('click', async () => {
        // Detecta mismatch URL/payload (p.ex. cas DA 21ª al form EX-31)
        const expectedForm = payload.tipoFormulario;  // 'EX31' o 'EX32'
        const onForm = location.pathname.includes('EX31') ? 'EX31'
                     : location.pathname.includes('EX32') ? 'EX32' : '?';
        if (expectedForm !== onForm) {
          statusDiv.innerHTML = `<strong style="color:#c00">⚠️ Cas ${caseId} és per ${expectedForm}, ets a ${onForm}.</strong><br>Tornar enrere i triar ${expectedForm} al desplegable.`;
          return;
        }
        statusDiv.innerHTML = `<em>Omplint ${caseId}… (cascades AJAX poden trigar uns segons)</em>`;
        btn.disabled = true;
        const results = await fillAll(payload);
        btn.disabled = false;
        const ok = results.filter(r => r.status === 'ok' || r.status === 'ok_cascade').length;
        const skipped = results.filter(r => r.status === 'skipped').length;
        const notFound = results.filter(r => r.status === 'not_found');
        const invalid = results.filter(r => r.status === 'invalid_option');
        const cascadeFails = results.filter(r => r.status === 'cascade_timeout');
        const errors = results.filter(r => r.status === 'error');

        let html = `<strong>${ok} OK</strong> · ${skipped} skip · ${notFound.length} not_found · ${invalid.length} invalid_opt · ${cascadeFails.length} cascade_timeout · ${errors.length} err`;
        const issues = [...notFound, ...invalid, ...cascadeFails, ...errors];
        if (issues.length) {
          html += '<details style="margin-top:6px"><summary>Detall</summary><pre style="font-size:10px;white-space:pre-wrap;margin:4px 0 0">';
          for (const r of issues) {
            html += `${r.name}: ${r.status}` + (r.value ? ` ("${r.value}")` : '') + (r.reason ? ` — ${r.reason}` : '') + (r.error ? ` ${r.error}` : '') + '\n';
          }
          html += '</pre></details>';
        }
        statusDiv.innerHTML = html;
        console.log('[Reus Refugi] fillAll results:', results);
      });
      buttonsDiv.appendChild(btn);
    }
  }

  // ─── Boot ────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectButton);
  } else {
    injectButton();
  }
})();
