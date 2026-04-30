// settings.js — тільки курс НБУ (Supabase налаштовано через Worker)

const Settings = (() => {
  const KEY_RATE = 'nbu_rate';

  function load() {
    return {
      rate: parseFloat(localStorage.getItem(KEY_RATE)) || 43.0,
    };
  }

  function save({ rate }) {
    if (rate) localStorage.setItem(KEY_RATE, rate);
  }

  function getRate() {
    return parseFloat(localStorage.getItem(KEY_RATE)) || 43.0;
  }

  function openModal() {
    const s = load();
    document.getElementById('setting-rate').value = s.rate;
    document.getElementById('settings-status').className = 'settings-status';
    document.getElementById('settings-status').textContent = '';
    document.getElementById('overlay-settings').removeAttribute('hidden');
  }

  async function saveFromModal() {
    const rate = parseFloat(document.getElementById('setting-rate').value);
    if (!rate || rate <= 0) { showStatus('err', 'Вкажіть коректний курс'); return; }

    save({ rate });
    showStatus('ok', 'Збережено ✓');

    document.getElementById('rate-display').textContent = rate.toFixed(2);
    if (window.App) App.recalcAndRender();

    setTimeout(() => {
      document.getElementById('overlay-settings').setAttribute('hidden', '');
    }, 700);
  }

  function showStatus(type, msg) {
    const el = document.getElementById('settings-status');
    el.className = 'settings-status' + (type ? ' ' + type : '');
    el.textContent = msg;
  }

  return { load, save, getRate, openModal, saveFromModal };
})();

document.addEventListener('DOMContentLoaded', () => {
  const s = Settings.load();
  document.getElementById('rate-display').textContent = s.rate.toFixed(2);

  document.getElementById('btn-settings').addEventListener('click', Settings.openModal);
  document.getElementById('btn-save-settings').addEventListener('click', Settings.saveFromModal);
});
