// auth.js — екран авторизації (логін / реєстрація)

const Auth = (() => {
  let _mode = 'login'; // 'login' | 'register'

  function show() {
    document.getElementById('auth-screen').removeAttribute('hidden');
    document.getElementById('app-screen').setAttribute('hidden', '');
    document.getElementById('auth-confirm-msg').setAttribute('hidden', '');
    document.getElementById('auth-form-body').removeAttribute('hidden');
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

    document.getElementById('auth-title').textContent = isLogin
      ? 'Welcome back! Glad to see you again.'
      : 'Create your account and get started.';
    document.getElementById('auth-subtitle').textContent = isLogin
      ? 'Увійдіть у свій акаунт, щоб повернутись до обліку проєктів.'
      : 'Зареєструйтесь, щоб зберігати проєкти, години та оплати в одному місці.';
    document.getElementById('auth-btn-submit').textContent = isLogin ? 'Login' : 'Register';
    document.getElementById('auth-switch-text').textContent = isLogin
      ? "Don't have an account? "
      : 'Already have an account? ';
    document.getElementById('auth-switch-link').textContent = isLogin
      ? 'Register Now'
      : 'Login';
    document.getElementById('auth-confirm-msg').setAttribute('hidden', '');
    document.getElementById('auth-form-body').removeAttribute('hidden');

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
      ? (_mode === 'login' ? 'Logging in...' : 'Creating account...')
      : (_mode === 'login' ? 'Login' : 'Register');
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

  async function signInWithGoogle() {
    clearError();
    const button = document.getElementById('auth-btn-google');
    button.disabled = true;
    button.querySelector('span:last-child').textContent = 'Redirecting...';

    const { error } = await SupabaseClient.signInWithGoogle();

    if (error) {
      button.disabled = false;
      button.querySelector('span:last-child').textContent = 'Continue with Google';
      showError(friendlyError(error.message));
    }
  }

  function showConfirmMessage() {
    document.getElementById('auth-confirm-msg').removeAttribute('hidden');
    document.getElementById('auth-form-body').setAttribute('hidden', '');
  }

  function togglePasswordVisibility() {
    const input = document.getElementById('auth-password');
    const toggle = document.getElementById('auth-password-toggle');
    if (!input || !toggle) return;

    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    toggle.setAttribute('aria-label', isHidden ? 'Сховати пароль' : 'Показати пароль');
    toggle.innerHTML = `<i data-lucide="${isHidden ? 'eye-off' : 'eye'}"></i>`;
    if (window.App?.refreshIcons) window.App.refreshIcons();
    else if (window.lucide) lucide.createIcons();
  }

  function friendlyError(msg) {
    if (msg.includes('Invalid login credentials'))  return 'Невірний email або пароль';
    if (msg.includes('Email not confirmed'))         return 'Підтвердіть email перед входом';
    if (msg.includes('User already registered'))     return 'Цей email вже зареєстровано';
    if (msg.includes('Password should be'))          return 'Пароль занадто простий';
    if (msg.includes('Unable to validate'))          return 'Невірний email або пароль';
    if (msg.includes('provider is not enabled'))     return 'Google login ще не увімкнений у Supabase';
    return msg;
  }

  // ── WIRE UP ──────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('auth-btn-submit').addEventListener('click', submit);
    document.getElementById('auth-btn-google').addEventListener('click', signInWithGoogle);
    document.getElementById('auth-password-toggle').addEventListener('click', togglePasswordVisibility);
    document.getElementById('auth-switch-link').addEventListener('click', e => {
      e.preventDefault();
      setMode(_mode === 'login' ? 'register' : 'login');
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
