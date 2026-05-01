// tasks.js — екран задач (Пріоритетні / Звичайні)

const Tasks = (() => {
  const PRIORITY = 'priority';
  const NORMAL   = 'normal';
  const DELETE_DELAY_MS = 12 * 60 * 60 * 1000; // 12 годин

  let _tasks = [];
  let _visible = false;
  let _draftPriority = false;

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
      .insert({
        user_id: uid,
        text: text.trim(),
        category,
        done: false,
        done_at: null,
      })
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

  async function togglePriorityInDB(id, category) {
    const client = SupabaseClient.get();
    const uid    = SupabaseClient.userIdSync();
    if (!client || !uid) return false;

    const { error } = await client
      .from('tasks')
      .update({ category })
      .eq('id', id);

    if (error) { showToast('Помилка пріоритету: ' + error.message); return false; }
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

  async function togglePriority(id) {
    const task = _tasks.find(t => t.id === id);
    if (!task) return;

    const nextCategory = task.category === PRIORITY ? NORMAL : PRIORITY;
    const ok = await togglePriorityInDB(id, nextCategory);
    if (!ok) return;

    task.category = nextCategory;
    render();
  }

  // ── RENDER ────────────────────────────────────────────
  function render() {
    const sorted = _tasks.slice().sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      if ((a.category === PRIORITY) !== (b.category === PRIORITY)) {
        return a.category === PRIORITY ? -1 : 1;
      }
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
    renderSection(sorted);
    updatePriorityBadge();
    updateDraftPriorityUI();
  }

  function renderSection(tasks) {
    const list = document.getElementById('tasks-list-all');
    if (!list) return;

    list.innerHTML = '';

    if (tasks.length === 0) {
      list.innerHTML = `<div class="tasks-empty">Поки порожньо</div>`;
      return;
    }

    tasks.forEach(task => {
      const item = document.createElement('div');
      item.className = 'task-item' + (task.done ? ' task-done' : '');
      item.dataset.id = task.id;

      const timeLeft = task.done && task.done_at
        ? getTimeLeft(task.done_at)
        : null;
      const isPriority = task.category === PRIORITY;

      item.innerHTML = `
        <button class="task-item-priority${isPriority ? ' is-priority' : ''}" data-action="priority" data-id="${task.id}" aria-label="Позначити пріоритет" aria-pressed="${isPriority ? 'true' : 'false'}">
          <i data-lucide="${isPriority ? 'sparkles' : 'circle'}"></i>
        </button>
        <span class="task-text">${esc(task.text)}</span>
        ${timeLeft ? `<span class="task-timer">${timeLeft}</span>` : ''}
      `;

      if (!task.done) {
        item.addEventListener('click', e => {
          const priorityBtn = e.target.closest('[data-action="priority"]');
          if (priorityBtn) {
            e.stopPropagation();
            togglePriority(task.id);
            return;
          }
          toggleDone(task.id);
        });
      } else {
        item.addEventListener('click', e => {
          const priorityBtn = e.target.closest('[data-action="priority"]');
          if (priorityBtn) {
            e.stopPropagation();
            togglePriority(task.id);
          }
        });
      }

      list.appendChild(item);
    });

    window.App?.refreshIcons?.();
  }

  function updatePriorityBadge() {
    const count = document.getElementById('tasks-count-priority');
    if (!count) return;
    const activePriority = _tasks.filter(t => !t.done && t.category === PRIORITY).length;
    count.textContent = activePriority > 0 ? activePriority : '';
    count.hidden = activePriority === 0;
  }

  function updateDraftPriorityUI() {
    const toggle = document.getElementById('task-priority-toggle');
    if (!toggle) return;
    toggle.classList.toggle('is-active', _draftPriority);
    toggle.setAttribute('aria-pressed', _draftPriority ? 'true' : 'false');
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
  function wireInput(inputId, btnId) {
    const input = document.getElementById(inputId);
    const btn   = document.getElementById(btnId);
    const row   = input?.closest('.task-add-row');
    if (!input || !btn || !row) return;

    const syncState = () => {
      const hasValue = input.value.trim().length > 0;
      row.classList.toggle('has-value', hasValue);
      btn.disabled = !hasValue;
    };

    const submit = () => {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      syncState();
      addTask(text, _draftPriority ? PRIORITY : NORMAL);
    };

    btn.addEventListener('click', submit);
    input.addEventListener('input', syncState);
    input.addEventListener('focus', () => row.classList.add('is-focused'));
    input.addEventListener('blur', () => row.classList.remove('is-focused'));
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    });

    syncState();
  }

  function wirePriorityToggle() {
    const toggle = document.getElementById('task-priority-toggle');
    if (!toggle) return;
    toggle.addEventListener('click', () => {
      _draftPriority = !_draftPriority;
      updateDraftPriorityUI();
    });
    updateDraftPriorityUI();
  }

  // ── SCREEN TOGGLE ─────────────────────────────────────
  function show() {
    _visible = true;
    document.getElementById('tasks-screen').removeAttribute('hidden');
    document.getElementById('main-screen').setAttribute('hidden', '');
    const navTasks = document.getElementById('nav-tasks');
    const navProjects = document.getElementById('nav-projects');
    if (navTasks) navTasks.classList.add('nav-active');
    if (navProjects) navProjects.classList.remove('nav-active');
    reload();
  }

  function hide() {
    _visible = false;
    document.getElementById('tasks-screen').setAttribute('hidden', '');
    document.getElementById('main-screen').removeAttribute('hidden');
    const navTasks = document.getElementById('nav-tasks');
    const navProjects = document.getElementById('nav-projects');
    if (navTasks) navTasks.classList.remove('nav-active');
    if (navProjects) navProjects.classList.add('nav-active');
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
    wireInput('task-input-main', 'task-add-main');
    wirePriorityToggle();

    document.getElementById('nav-projects')?.addEventListener('click', hide);
    document.getElementById('nav-tasks')?.addEventListener('click', show);
  });

  return { show, hide, reload };
})();

window.Tasks = Tasks;
