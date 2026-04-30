// auth.js — екран авторизації (логін / реєстрація)

const Auth = (() => {
  let _mode = 'login'; // 'login' | 'register'

  function show() {
    document.getElementById('auth-screen').removeAttribute('hidden');
    document.getElementById('app-screen').setAttribute('hidden', '');
    setMode('login');
    clearError();
  }

  function hide() {
    document.getElementById('auth-screen').setAttribute('hidden', '');
    document.getElementById('app-screen').removeAttribute('hidden');
  }

  function setMode(mode) {
    _mode = mode;
    const isLogin = mode === 'login';

    document.getElementById('auth-title').textContent     = isLogin ? 'Вхід' : 'Реєстрація';
    document.getElementById('auth-btn-submit').textContent = isLogin ? 'Увійти' : 'Зареєструватись';
    document.getElementById('auth-switch-text').textContent = isLogin
      ? 'Немає акаунту? '
      : 'Вже є акаунт? ';
    document.getElementById('auth-switch-link').textContent = isLogin
      ? 'Зареєструватись'
      : 'Увійти';

    clearError();
    document.getElementById('auth-email').focus();
  }

  function clearError() {
    const el = document.getElementById('auth-error');
    el.textContent = '';
    el.setAttribute('hidden', '');
  }

  function showError(msg) {
    const el = document.getElementById('auth-error');
    el.textContent = msg;
    el.removeAttribute('hidden');
  }

  function setLoading(on) {
    const btn = document.getElementById('auth-btn-submit');
    btn.disabled = on;
    btn.textContent = on
      ? (_mode === 'login' ? 'Входимо...' : 'Реєструємось...')
      : (_mode === 'login' ? 'Увійти' : 'Зареєструватись');
  }

  async function submit() {
    const email    = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;

    if (!email || !password) { showError('Заповніть email та пароль'); return; }
    if (password.length < 6) { showError('Пароль — мінімум 6 символів'); return; }

    clearError();
    setLoading(true);

    if (_mode === 'login') {
      const { error } = await SupabaseClient.signIn(email, password);
      setLoading(false);
      if (error) {
        showError(friendlyError(error.message));
      }
      // onAuthStateChange спрацює і викличе hide() + reload
    } else {
      const { data, error } = await SupabaseClient.signUp(email, password);
      setLoading(false);
      if (error) {
        showError(friendlyError(error.message));
      } else if (data?.user && !data?.session) {
        // Email confirmation потрібна
        showError('');
        showConfirmMessage();
      }
      // якщо сесія є одразу — onAuthStateChange спрацює
    }
  }

  function showConfirmMessage() {
    document.getElementById('auth-confirm-msg').removeAttribute('hidden');
    document.getElementById('auth-form-body').setAttribute('hidden', '');
  }

  function friendlyError(msg) {
    if (msg.includes('Invalid login credentials'))  return 'Невірний email або пароль';
    if (msg.includes('Email not confirmed'))         return 'Підтвердіть email перед входом';
    if (msg.includes('User already registered'))     return 'Цей email вже зареєстровано';
    if (msg.includes('Password should be'))          return 'Пароль занадто простий';
    if (msg.includes('Unable to validate'))          return 'Невірний email або пароль';
    return msg;
  }

  // ── WIRE UP ──────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('auth-btn-submit').addEventListener('click', submit);
    document.getElementById('auth-switch-link').addEventListener('click', () => {
      setMode(_mode === 'login' ? 'register' : 'login');
    });
    document.getElementById('btn-logout').addEventListener('click', async () => {
      await SupabaseClient.signOut();
      // onAuthStateChange покаже екран логіну
    });

    // Enter у полях форми
    ['auth-email', 'auth-password'].forEach(id => {
      document.getElementById(id).addEventListener('keydown', e => {
        if (e.key === 'Enter') submit();
      });
    });
  });

  return { show, hide };
})();
