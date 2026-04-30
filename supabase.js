// supabase.js — клієнт через CF Worker (секрети на сервері)

const SupabaseClient = (() => {
  let _client = null;

  // ── Адреса вашого CF Worker ───────────────────────────────
  // Замініть на реальний URL після деплою Worker'а
  const WORKER_URL = 'https://noisy-heart-87db.ivisttt.workers.dev';

  function init() {
    if (_client) return _client;
    try {
      // Ключ — placeholder: Worker підставить справжній з env-секрету
      _client = supabase.createClient(WORKER_URL, 'placeholder');
      return _client;
    } catch (e) {
      console.error('Supabase init error:', e);
      _client = null;
      return null;
    }
  }

  function get() {
    if (_client) return _client;
    return init();
  }

  async function userId() {
    const client = get();
    if (!client) return null;
    const { data: { user } } = await client.auth.getUser();
    return user ? user.id : null;
  }

  function userIdSync() {
    return _currentUserId;
  }

  let _currentUserId = null;

  function onAuthChange(callback) {
    const client = get();
    if (!client) return;
    client.auth.onAuthStateChange((event, session) => {
      _currentUserId = session?.user?.id || null;
      callback(event, session);
    });
  }

  async function signIn(email, password) {
    const client = get();
    if (!client) return { error: { message: 'Worker не налаштовано' } };
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (!error) _currentUserId = data.user?.id || null;
    return { data, error };
  }

  async function signUp(email, password) {
    const client = get();
    if (!client) return { error: { message: 'Worker не налаштовано' } };
    return await client.auth.signUp({ email, password });
  }

  async function signInWithGoogle() {
    const client = get();
    if (!client) return { error: { message: 'Worker не налаштовано' } };
    return await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + window.location.pathname,
      },
    });
  }

  async function signOut() {
    const client = get();
    if (!client) return;
    await client.auth.signOut();
    _currentUserId = null;
  }

  async function getSession() {
    const client = get();
    if (!client) return null;
    const { data: { session } } = await client.auth.getSession();
    if (session) _currentUserId = session.user?.id || null;
    return session;
  }

  async function ping() {
    const client = get();
    if (!client) return { ok: false, error: 'Не налаштовано' };
    try {
      const { error } = await client.from('projects').select('id').limit(1);
      if (error && error.code !== 'PGRST301' && !error.message.includes('JWT')) {
        return { ok: false, error: error.message };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // Ініціалізуємо одразу при завантаженні скрипта
  init();

  return { init, get, userId, userIdSync, onAuthChange, signIn, signUp, signInWithGoogle, signOut, getSession, ping };
})();
