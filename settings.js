// settings.js — інлайн-редагування курсу НБУ в шапці

const Settings = (() => {
  let _rate = 43.0;
  let _editing = false;

  function load() {
    return { rate: _rate };
  }

  function save({ rate }) {
    if (rate) _rate = rate;
  }

  function getRate() {
    return _rate;
  }

  function updateDisplay(rate = getRate()) {
    const trigger = document.getElementById('rate-trigger');
    const valueEl = document.getElementById('rate-display');
    if (!trigger || !valueEl) return;

    trigger.classList.remove('is-editing');
    trigger.removeAttribute('data-state');
    valueEl.textContent = rate.toFixed(2);
    _editing = false;
  }

  function startInlineEdit() {
    if (_editing) return;

    const trigger = document.getElementById('rate-trigger');
    const valueEl = document.getElementById('rate-display');
    if (!trigger || !valueEl) return;

    _editing = true;
    trigger.classList.add('is-editing');
    trigger.dataset.state = 'editing';

    const currentRate = getRate();
    const input = document.createElement('input');
    input.type = 'number';
    input.id = 'rate-input';
    input.className = 'rate-input';
    input.min = '1';
    input.step = '0.01';
    input.value = currentRate.toFixed(2);
    input.setAttribute('aria-label', 'Курс НБУ');

    valueEl.replaceWith(input);
    input.focus();
    input.select();

    input.addEventListener('click', e => e.stopPropagation());
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitInlineEdit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelInlineEdit();
      }
    });
    input.addEventListener('blur', commitInlineEdit);
  }

  function commitInlineEdit() {
    const input = document.getElementById('rate-input');
    if (!input) return;

    const rate = parseFloat(input.value);
    if (!rate || rate <= 0) {
      showToast('Вкажіть коректний курс НБУ');
      input.focus();
      input.select();
      return;
    }

    const valueEl = document.createElement('span');
    valueEl.className = 'rate-value';
    valueEl.id = 'rate-display';
    input.replaceWith(valueEl);

    save({ rate });
    updateDisplay(rate);
    if (window.App) App.recalcAndRender();
    showToast('Курс оновлено');
  }

  function cancelInlineEdit() {
    const input = document.getElementById('rate-input');
    if (!input) return;

    const valueEl = document.createElement('span');
    valueEl.className = 'rate-value';
    valueEl.id = 'rate-display';
    input.replaceWith(valueEl);
    updateDisplay();
  }

  return { load, save, getRate, updateDisplay, startInlineEdit };
})();

document.addEventListener('DOMContentLoaded', () => {
  const s = Settings.load();
  Settings.updateDisplay(s.rate);
  document.getElementById('rate-trigger').addEventListener('click', Settings.startInlineEdit);
});
