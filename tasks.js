// tasks.js — екран задач (Пріоритетні / Звичайні)

const Tasks = (() => {
  const PRIORITY = 'priority';
  const NORMAL   = 'normal';
  const DELETE_DELAY_MS = 12 * 60 * 60 * 1000; // 12 годин

  let _tasks = [];
  let _visible = false;

  // ── DB ────────────────────────────────────────────────
  async function loadFromDB() {
    const client = SupabaseClient.get();
    const uid    = SupabaseClient.userIdSync();
    if (!client || !uid) return [];

    const { data, error } = await client
      .from('tasks')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) { showToast('Помилка завантаження задач: ' + error.message); return []; }
    return data || [];
  }

  async function addToDB(text, category) {
    const client = SupabaseClient.get();
    const uid    = SupabaseClient.userIdSync();
    if (!client || !uid) { showToast('Немає авторизації'); return null; }

    const { data, error } = await client
      .from('tasks')
      .insert({ text: text.trim(), category, done: false, done_at: null })
      .select()
      .single();

    if (error) { showToast('Помилка додавання: ' + error.message); return null; }
    return data;
  }

  async function markDoneInDB(id) {
    const client = SupabaseClient.get();
    const uid    = SupabaseClient.userIdSync();
    if (!client || !uid) return false;

    const { error } = await client
      .from('tasks')
      .update({ done: true, done_at: new Date().toISOString() })
      .eq('id', id);

    if (error) { showToast('Помилка: ' + error.message); return false; }
    return true;
  }

  async function deleteFromDB(id) {
    const client = SupabaseClient.get();
    const uid    = SupabaseClient.userIdSync();
    if (!client || !uid) return;

    const { error } = await client.from('tasks').delete().eq('id', id);
    if (error) console.error('Task delete error:', error.message);
  }

  // ── LOGIC ─────────────────────────────────────────────
  async function reload() {
    _tasks = await loadFromDB();
    // Чистимо прострочені done-задачі (на випадок якщо воркер не прибрав)
    const expired = _tasks.filter(t =>
      t.done && t.done_at && (Date.now() - new Date(t.done_at).getTime()) > DELETE_DELAY_MS
    );
    expired.forEach(t => deleteFromDB(t.id));
    _tasks = _tasks.filter(t => !expired.find(e => e.id === t.id));
    render();
    scheduleLocalCleanup();
  }

  // Планує авто-видалення в пам'яті (якщо вкладка відкрита)
  function scheduleLocalCleanup() {
    _tasks.filter(t => t.done && t.done_at).forEach(t => {
      const elapsed = Date.now() - new Date(t.done_at).getTime();
      const remaining = DELETE_DELAY_MS - elapsed;
      if (remaining > 0) {
        setTimeout(() => {
          _tasks = _tasks.filter(x => x.id !== t.id);
          deleteFromDB(t.id);
          render();
        }, remaining);
      }
    });
  }

  async function addTask(text, category) {
    if (!text.trim()) return;
    const task = await addToDB(text, category);
    if (!task) return;
    _tasks.push(task);
    render();
  }

  async function toggleDone(id) {
    const task = _tasks.find(t => t.id === id);
    if (!task || task.done) return;

    const ok = await markDoneInDB(id);
    if (!ok) return;

    task.done   = true;
    task.done_at = new Date().toISOString();
    render();

    // Видалення через 12 годин
    setTimeout(() => {
      _tasks = _tasks.filter(t => t.id !== id);
      deleteFromDB(id);
      render();
    }, DELETE_DELAY_MS);
  }

  // ── RENDER ────────────────────────────────────────────
  function render() {
    renderSection('priority', _tasks.filter(t => t.category === PRIORITY));
    renderSection('normal',   _tasks.filter(t => t.category === NORMAL));
  }

  function renderSection(category, tasks) {
    const list = document.getElementById(`tasks-list-${category}`);
    const count = document.getElementById(`tasks-count-${category}`);
    if (!list) return;

    const active = tasks.filter(t => !t.done).length;
    const total  = tasks.length;
    count.textContent = active > 0 ? active : '';
    count.hidden = active === 0;

    list.innerHTML = '';

    if (tasks.length === 0) {
      list.innerHTML = `<div class="tasks-empty">Немає задач</div>`;
      return;
    }

    tasks.forEach(task => {
      const item = document.createElement('div');
      item.className = 'task-item' + (task.done ? ' task-done' : '');
      item.dataset.id = task.id;

      const timeLeft = task.done && task.done_at
        ? getTimeLeft(task.done_at)
        : null;

      item.innerHTML = `
        <span class="task-bullet"></span>
        <span class="task-text">${esc(task.text)}</span>
        ${timeLeft ? `<span class="task-timer">${timeLeft}</span>` : ''}
      `;

      if (!task.done) {
        item.addEventListener('click', () => toggleDone(task.id));
      }

      list.appendChild(item);
    });
  }

  function getTimeLeft(done_at) {
    const elapsed  = Date.now() - new Date(done_at).getTime();
    const remaining = DELETE_DELAY_MS - elapsed;
    if (remaining <= 0) return null;
    const hours = Math.floor(remaining / 3600000);
    const mins  = Math.floor((remaining % 3600000) / 60000);
    return hours > 0 ? `${hours}г ${mins}хв` : `${mins}хв`;
  }

  // ── QUICK ADD ─────────────────────────────────────────
  function wireInput(inputId, btnId, category) {
    const input = document.getElementById(inputId);
    const btn   = document.getElementById(btnId);
    if (!input || !btn) return;

    const submit = () => {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      addTask(text, category);
    };

    btn.addEventListener('click', submit);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    });
  }

  // ── SCREEN TOGGLE ─────────────────────────────────────
  function show() {
    _visible = true;
    document.getElementById('tasks-screen').removeAttribute('hidden');
    document.getElementById('main-screen').setAttribute('hidden', '');
    document.getElementById('nav-tasks').classList.add('nav-active');
    document.getElementById('nav-projects').classList.remove('nav-active');
    reload();
  }

  function hide() {
    _visible = false;
    document.getElementById('tasks-screen').setAttribute('hidden', '');
    document.getElementById('main-screen').removeAttribute('hidden');
    document.getElementById('nav-tasks').classList.remove('nav-active');
    document.getElementById('nav-projects').classList.add('nav-active');
  }

  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── INIT ──────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    wireInput('task-input-priority', 'task-add-priority', PRIORITY);
    wireInput('task-input-normal',   'task-add-normal',   NORMAL);

    document.getElementById('nav-projects').addEventListener('click', hide);
    document.getElementById('nav-tasks').addEventListener('click', show);
  });

  return { show, hide, reload };
})();

window.Tasks = Tasks;
