// app.js — головна логіка: завантаження, рендер, підрахунки

const App = (() => {
  let _projects = [];   // відфільтровані по місяцю
  let _allProjects = []; // всі проєкти з БД
  let _currentYear  = new Date().getFullYear();
  let _currentMonth = new Date().getMonth(); // 0-based

  const MONTH_NAMES = [
    'Січень','Лютий','Березень','Квітень','Травень','Червень',
    'Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'
  ];

  // ── INIT ──────────────────────────────────────────────
  async function init() {
    updateMonthDisplay();

    document.getElementById('btn-month-prev').addEventListener('click', () => {
      _currentMonth--;
      if (_currentMonth < 0) { _currentMonth = 11; _currentYear--; }
      updateMonthDisplay();
      applyMonthFilter();
    });
    document.getElementById('btn-month-next').addEventListener('click', () => {
      _currentMonth++;
      if (_currentMonth > 11) { _currentMonth = 0; _currentYear++; }
      updateMonthDisplay();
      applyMonthFilter();
    });

    SupabaseClient.init();

    SupabaseClient.onAuthChange(async (event, session) => {
      if (session) {
        document.getElementById('user-email').textContent = session.user.email;
        Auth.hide();
        await reload();
      } else {
        Auth.show();
        _projects = [];
        _allProjects = [];
        renderTable();
        renderSummary();
      }
    });

    const session = await SupabaseClient.getSession();
    if (session) {
      document.getElementById('user-email').textContent = session.user.email;
      Auth.hide();
      await reload();
    } else {
      Auth.show();
    }
  }

  function updateMonthDisplay() {
    document.getElementById('header-month').textContent =
      MONTH_NAMES[_currentMonth] + ' ' + _currentYear;
  }

  // ── LOAD — завантажуємо ВСІ, фільтруємо на клієнті ───
  async function reload() {
    const client = SupabaseClient.get();
    const uid = SupabaseClient.userIdSync();

    if (client && uid) {
      const { data, error } = await client
        .from('projects')
        .select('*')
        .order('created_at', { ascending: true });

      if (error) {
        showToast('Помилка завантаження: ' + error.message);
        _allProjects = loadLocal();
      } else {
        _allProjects = data || [];
        saveLocal(_allProjects);
      }
    } else {
      _allProjects = loadLocal();
    }

    applyMonthFilter();
  }

  // Фільтр по обраному місяцю на клієнті
  function applyMonthFilter() {
    const monthStr = _currentYear + '-' + String(_currentMonth + 1).padStart(2, '0');
    _projects = _allProjects.filter(p => {
      if (!p.created_at) return true; // local без дати — завжди показуємо
      return p.created_at.startsWith(monthStr);
    });
    renderTable();
    renderSummary();
  }

  // ── LOCAL STORAGE ──────────────────────────────────────
  function loadLocal() {
    try { return JSON.parse(localStorage.getItem('projects_local') || '[]'); }
    catch { return []; }
  }

  function saveLocal(projects) {
    localStorage.setItem('projects_local', JSON.stringify(projects));
  }

  function addLocal(project) {
    _allProjects.push(project);
    saveLocal(_allProjects);
    applyMonthFilter();
  }

  function updateLocal(id, data) {
    _allProjects = _allProjects.map(p => p.id === id ? { ...p, ...data } : p);
    saveLocal(_allProjects);
    applyMonthFilter();
  }

  async function deleteProject(id) {
    if (!confirm('Видалити проєкт?')) return;

    const client = SupabaseClient.get();
    if (client && SupabaseClient.userIdSync()) {
      const { error } = await client.from('projects').delete().eq('id', id);
      if (error) { showToast('Помилка: ' + error.message); return; }
    } else {
      _allProjects = _allProjects.filter(p => p.id !== id);
      saveLocal(_allProjects);
    }
    showToast('Проєкт видалено');
    await reload();
  }

  // Toggle paid inline — без повного reload
  async function togglePaid(id, newPaid) {
    const client = SupabaseClient.get();
    const uid    = SupabaseClient.userIdSync();

    if (client && uid) {
      const { error } = await client
        .from('projects')
        .update({ paid: newPaid })
        .eq('id', id);
      if (error) { showToast('Помилка: ' + error.message); return; }
    } else {
      _allProjects = _allProjects.map(p => p.id === id ? { ...p, paid: newPaid } : p);
      saveLocal(_allProjects);
    }

    _allProjects = _allProjects.map(p => p.id === id ? { ...p, paid: newPaid } : p);
    _projects    = _projects.map(p =>    p.id === id ? { ...p, paid: newPaid } : p);

    renderSummary();

    const row = document.querySelector(`.paid-checkbox[data-id="${id}"]`)?.closest('tr');
    if (row) row.classList.toggle('row-paid', newPaid);
    const lbl = document.querySelector(`.paid-checkbox[data-id="${id}"]`)
      ?.closest('.paid-toggle')?.querySelector('.paid-label');
    if (lbl) lbl.textContent = newPaid ? 'оплачено' : 'не оплачено';
  }

  // ── CALCULATIONS ───────────────────────────────────────
  function calcTotal(project) {
    const rate  = parseFloat(project.rate) || 0;
    const hours = parseFloat(project.hours) || 0;
    const fixed = parseFloat(project.static_amount) || 0;
    return fixed > 0 ? fixed : rate * hours;
  }

  function recalcAndRender() {
    renderTable();
    renderSummary();
  }

  // ── RENDER TABLE ───────────────────────────────────────
  function makeIconBtn(action, id, iconName, extraClass, title, dataName) {
    const btn = document.createElement('button');
    btn.className = 'btn-row' + (extraClass ? ' ' + extraClass : '');
    btn.dataset.action = action;
    btn.dataset.id     = id;
    btn.title          = title;
    if (dataName) btn.dataset.name = dataName;
    const i = document.createElement('i');
    i.dataset.lucide = iconName;
    btn.appendChild(i);
    return btn;
  }

  function renderTable() {
    const tbody = document.getElementById('projects-body');
    tbody.innerHTML = '';

    if (_projects.length === 0) {
      const tr = document.createElement('tr');
      tr.className = 'empty-row';
      tr.innerHTML = '<td colspan="8">Немає проєктів за цей місяць</td>';
      tbody.appendChild(tr);
      document.getElementById('total-usd').textContent = '$0';
      document.getElementById('total-uah').textContent = '0 ₴';
      return;
    }

    const rate = Settings.getRate();

    _projects.forEach(p => {
      const totalUSD = calcTotal(p);
      const totalUAH = totalUSD * rate;

      const tr = document.createElement('tr');
      if (p.paid) tr.classList.add('row-paid');
      tr.innerHTML = `
        <td class="project-name">${esc(p.name)}</td>
        <td class="col-num">${p.rate ? '$' + fmtNum(p.rate) : '—'}</td>
        <td class="col-num">${p.hours ? fmtNum(p.hours) : '—'}</td>
        <td class="col-num">${p.static_amount ? '$' + fmtNum(p.static_amount) : '—'}</td>
        <td class="col-num">$${fmtNum(totalUSD)}</td>
        <td class="col-num">${fmtNum(Math.round(totalUAH))} ₴</td>
        <td class="col-status">
          <label class="paid-toggle" title="${p.paid ? 'Оплачено' : 'Не оплачено'}">
            <input type="checkbox" class="paid-checkbox" data-id="${p.id}" ${p.paid ? 'checked' : ''} />
            <span class="paid-label">${p.paid ? 'оплачено' : 'не оплачено'}</span>
          </label>
        </td>
        <td class="col-actions"></td>
      `;

      // Будуємо кнопки через DOM — інакше lucide не підхоплює <i data-lucide> з innerHTML
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'row-actions';
      actionsDiv.appendChild(makeIconBtn('journal', p.id, 'notebook-pen', '',        'Щоденник',   esc(p.name)));
      actionsDiv.appendChild(makeIconBtn('edit',    p.id, 'pencil',       '',        'Редагувати', null));
      actionsDiv.appendChild(makeIconBtn('delete',  p.id, 'trash-2',      'btn-row-del', 'Видалити', null));
      tr.querySelector('.col-actions').appendChild(actionsDiv);

      tbody.appendChild(tr);
    });

    // Рендеримо Lucide іконки після вставки в DOM
    if (window.lucide) lucide.createIcons();

    const sumUSD = _projects.reduce((s, p) => s + calcTotal(p), 0);
    const sumUAH = sumUSD * Settings.getRate();
    document.getElementById('total-usd').textContent = '$' + fmtNum(sumUSD);
    document.getElementById('total-uah').textContent = fmtNum(Math.round(sumUAH)) + ' ₴';
  }

  // ── RENDER SUMMARY ─────────────────────────────────────
  function renderSummary() {
    const rate   = Settings.getRate();
    const sumUSD = _projects.reduce((s, p) => s + calcTotal(p), 0);
    const sumUAH = sumUSD * rate;
    const paid   = _projects.filter(p => p.paid).reduce((s, p) => s + calcTotal(p), 0);
    const unpaid = sumUSD - paid;

    document.getElementById('sum-usd').textContent    = '$' + fmtNum(sumUSD);
    document.getElementById('sum-uah').textContent    = fmtNum(Math.round(sumUAH)) + ' ₴';
    document.getElementById('sum-paid').textContent   = '$' + fmtNum(paid);
    document.getElementById('sum-unpaid').textContent = '$' + fmtNum(unpaid);
  }

  // ── TABLE EVENT DELEGATION ─────────────────────────────
  document.getElementById('projects-body').addEventListener('click', e => {
    const cb = e.target.closest('.paid-checkbox');
    if (cb) { togglePaid(cb.dataset.id, cb.checked); return; }

    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, id, name } = btn.dataset;

    if (action === 'journal') {
      JournalModal.open(id, name);
    } else if (action === 'edit') {
      const project = _projects.find(p => String(p.id) === String(id));
      if (project) ProjectModal.open(project);
    } else if (action === 'delete') {
      deleteProject(id);
    }
  });

  // ── UTILS ──────────────────────────────────────────────
  function fmtNum(n) {
    const num = parseFloat(n) || 0;
    return Number.isInteger(num) || Math.abs(num - Math.round(num)) < 0.005
      ? Math.round(num).toLocaleString('uk-UA')
      : num.toLocaleString('uk-UA', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return { init, reload, recalcAndRender, addLocal, updateLocal };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
window.App = App;
