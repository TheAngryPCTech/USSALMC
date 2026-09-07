/* USSALMC Wiki — field-level confirm (green) / flag (red) signal buttons.
 * Delegated click handling so it works for buttons rendered by any template
 * (plugin default or theme override) without per-template JS wiring. */
(function () {
  function post(action, data) {
    var body = new URLSearchParams(Object.assign({ action: action, nonce: window.USSALMC_SIGNAL.nonce }, data));
    return fetch(window.USSALMC_SIGNAL.ajax_url, { method: 'POST', body: body, credentials: 'same-origin' })
      .then(function (r) { return r.json(); });
  }

  document.addEventListener('click', function (e) {
    var confirmBtn = e.target.closest('.ussalmc-confirm-btn');
    var flagBtn = e.target.closest('.ussalmc-flag-btn');
    if (!confirmBtn && !flagBtn) return;
    var wrap = e.target.closest('.ussalmc-field-actions');
    if (!wrap) return;
    var entity = wrap.getAttribute('data-entity');
    var field = wrap.getAttribute('data-field');
    var value = wrap.getAttribute('data-value');
    var status = wrap.querySelector('.ussalmc-field-status');

    if (confirmBtn) {
      confirmBtn.disabled = true;
      post('ussalmc_confirm_field', { entity_id: entity, field: field, value: value }).then(function (res) {
        confirmBtn.disabled = false;
        if (status) status.textContent = res.success ? '✓ confirmed' : (res.data && res.data.message) || 'failed';
      });
      return;
    }
    if (flagBtn) {
      var suggested = window.prompt('What should "' + field.replace('attr:', '') + '" actually be?', value || '');
      if (suggested === null || suggested.trim() === '') return;
      var note = window.prompt('Optional note for the reviewer (why is this wrong?):', '') || '';
      flagBtn.disabled = true;
      post('ussalmc_flag_field', { entity_id: entity, field: field, value: value, suggested: suggested.trim(), note: note }).then(function (res) {
        flagBtn.disabled = false;
        if (status) status.textContent = res.success ? '✓ submitted for review' : (res.data && res.data.message) || 'failed';
      });
    }
  });
})();
