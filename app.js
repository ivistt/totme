// app.js — головна логіка: завантаження, рендер, підрахунки

const App = (() => {
  let _projects = [];   // відфільтровані по місяцю
  let _allProjects = []; // всі проєкти з БД
  let _paymentsByProject = {};
  let _currentYear  = new Date().getFullYear();
  let _currentMonth = new Date().getMonth(); // 0-based
  let _userEmail = '';
  let _selectedProjectIds = new Set();

  const MONTH_NAMES = [
    'Січень','Лютий','Березень','Квітень','Травень','Червень',
    'Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'
  ];

  function clearLegacyLocalData() {
    [
      'projects_local',
      'payments_local',
      'nbu_rate',
      'totme_timer_state',
    ].forEach(key => localStorage.removeItem(key));

    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('journal_')) localStorage.removeItem(key);
    });
  }

  // ── INIT ──────────────────────────────────────────────
  async function init() {
    clearLegacyLocalData();
    updateMonthDisplay();
    refreshIcons();

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
        _userEmail = session.user.email || '';
        window.ProfileModal?.setUser?.(_userEmail);
        Auth.hide();
        await reload();
      } else {
        _userEmail = '';
        window.ProfileModal?.setUser?.('');
        Auth.show();
        _projects = [];
        _allProjects = [];
        _paymentsByProject = {};
        _selectedProjectIds = new Set();
        renderTable();
        renderSummary();
      }
    });

    const { data: oauthData, error: oauthError } = await SupabaseClient.handleOAuthRedirect();
    if (oauthError) {
      console.error('OAuth redirect error:', oauthError);
      if (typeof showToast === 'function') {
        showToast('OAuth error: ' + oauthError.message);
      }
    } else if (oauthData?.session?.user) {
      _userEmail = oauthData.session.user.email || '';
      window.ProfileModal?.setUser?.(_userEmail);
      Auth.hide();
      await reload();
      return;
    }

    const session = await SupabaseClient.getSession();
    if (session) {
      _userEmail = session.user.email || '';
      window.ProfileModal?.setUser?.(_userEmail);
      Auth.hide();
      await reload();
    } else {
      _userEmail = '';
      window.ProfileModal?.setUser?.('');
      Auth.show();
    }
  }

  function updateMonthDisplay() {
    document.getElementById('header-month').textContent =
      MONTH_NAMES[_currentMonth] + ' ' + _currentYear;
  }

  function getCurrentPeriod() {
    return { year: _currentYear, month: _currentMonth };
  }

  function getAllProjects() {
    return _allProjects.slice();
  }

  function getCurrentMonthProjects() {
    return _projects.slice();
  }

  function getSummaryProjects() {
    if (_selectedProjectIds.size === 0) return _projects;
    return _projects.filter(project => _selectedProjectIds.has(String(project.id)));
  }

  function syncSelectionWithCurrentMonth() {
    const availableIds = new Set(_projects.map(project => String(project.id)));
    _selectedProjectIds = new Set(
      Array.from(_selectedProjectIds).filter(id => availableIds.has(id))
    );
  }

  function toggleProjectSelection(id) {
    const key = String(id);
    if (_selectedProjectIds.has(key)) {
      _selectedProjectIds.delete(key);
    } else {
      _selectedProjectIds.add(key);
    }
    recalcAndRender();
  }

  function getUserEmail() {
    return _userEmail;
  }

  function refreshIcons() {
    if (window.lucide) lucide.createIcons();
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
        _allProjects = [];
        _paymentsByProject = {};
      } else {
        _allProjects = data || [];
        _paymentsByProject = groupPaymentsFromProjects(_allProjects);
      }
    } else {
      _allProjects = [];
      _paymentsByProject = {};
    }

    applyMonthFilter();
  }

  function groupPaymentsFromProjects(projects) {
    return projects.reduce((acc, project) => {
      const raw = Array.isArray(project.payments_json) ? project.payments_json : [];
      acc[String(project.id)] = raw
        .map((payment, index) => ({
          id: payment.id || `${project.id}_${index}`,
          project_id: project.id,
          paid_at: payment.paid_at || '',
          amount: parseFloat(payment.amount) || 0,
        }))
        .filter(payment => payment.paid_at && payment.amount > 0);
      return acc;
    }, {});
  }

  // Фільтр по обраному місяцю на клієнті
  function applyMonthFilter() {
    const monthStr = _currentYear + '-' + String(_currentMonth + 1).padStart(2, '0');
    _projects = _allProjects.filter(p => {
      if (!p.created_at) return true; // local без дати — завжди показуємо
      return p.created_at.startsWith(monthStr);
    });
    syncSelectionWithCurrentMonth();
    renderTable();
    renderSummary();
  }

  async function deleteProject(id) {
    if (!confirm('Видалити проєкт?')) return;

    const client = SupabaseClient.get();
    if (client && SupabaseClient.userIdSync()) {
      const { error } = await client.from('projects').delete().eq('id', id);
      if (error) { showToast('Помилка: ' + error.message); return; }
    } else {
      showToast('Немає авторизації для видалення');
      return;
    }
    showToast('Проєкт видалено');
    await reload();
  }

  async function updateProjectTask(id, task) {
    const client = SupabaseClient.get();
    const uid = SupabaseClient.userIdSync();
    const value = String(task || '').trim();

    if (client && uid) {
      const { error } = await client
        .from('projects')
        .update({ current_task: value })
        .eq('id', id);
      if (error) {
        showToast('Помилка збереження задачі: ' + error.message);
        return false;
      }
    } else {
      showToast('Немає авторизації для збереження коментаря');
      return false;
    }

    _allProjects = _allProjects.map(project => (
      String(project.id) === String(id)
        ? { ...project, current_task: value }
        : project
    ));
    _projects = _projects.map(project => (
      String(project.id) === String(id)
        ? { ...project, current_task: value }
        : project
    ));

    return true;
  }

  // ── CALCULATIONS ───────────────────────────────────────
  function calcTotal(project) {
    const rate  = parseFloat(project.rate) || 0;
    const hours = parseFloat(project.hours) || 0;
    const fixed = parseFloat(project.static_amount) || 0;
    return fixed > 0 ? fixed : rate * hours;
  }

  function getProjectPayments(projectId) {
    return _paymentsByProject[String(projectId)] || [];
  }

  function getPaidAmount(projectId) {
    return getProjectPayments(projectId).reduce((sum, payment) => sum + (parseFloat(payment.amount) || 0), 0);
  }

  async function saveProjectPayments(projectId, payments) {
    const normalized = payments
      .map(payment => ({
        id: payment.id || crypto.randomUUID(),
        project_id: projectId,
        paid_at: payment.paid_at,
        amount: parseFloat(payment.amount) || 0,
      }))
      .filter(payment => payment.paid_at && payment.amount > 0);

    const client = SupabaseClient.get();
    const uid = SupabaseClient.userIdSync();

    if (!client || !uid) {
      showToast('Немає авторизації для збереження оплат');
      return false;
    }

    const payload = normalized.map(payment => ({
      id: payment.id,
      paid_at: payment.paid_at,
      amount: payment.amount,
    }));

    const { error } = await client
      .from('projects')
      .update({ payments_json: payload })
      .eq('id', projectId);

    if (error) {
      showToast('Помилка збереження оплат: ' + error.message);
      return false;
    }

    _paymentsByProject[String(projectId)] = normalized;
    _allProjects = _allProjects.map(project => (
      String(project.id) === String(projectId)
        ? { ...project, payments_json: payload }
        : project
    ));
    _projects = _projects.map(project => (
      String(project.id) === String(projectId)
        ? { ...project, payments_json: payload }
        : project
    ));
    recalcAndRender();
    return true;
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
    const mobile = document.getElementById('mobile-projects');
    tbody.innerHTML = '';
    mobile.innerHTML = '';
    tbody.classList.toggle('selection-active', _selectedProjectIds.size > 0);
    mobile.classList.toggle('selection-active', _selectedProjectIds.size > 0);

    if (_projects.length === 0) {
      const tr = document.createElement('tr');
      tr.className = 'empty-row';
      tr.innerHTML = '<td colspan="9">Немає проєктів за цей місяць</td>';
      tbody.appendChild(tr);
      mobile.innerHTML = '<div class="mobile-empty">Немає проєктів за цей місяць</div>';
      document.getElementById('total-usd').textContent = '$0';
      document.getElementById('total-paid-usd').textContent = '$0';
      document.getElementById('total-balance-usd').textContent = '$0';
      document.getElementById('total-uah').textContent = '0 ₴';
      return;
    }

    const rate = Settings.getRate();
    const hasSelection = _selectedProjectIds.size > 0;

    _projects.forEach(p => {
      const totalUSD = calcTotal(p);
      const paidUSD = getPaidAmount(p.id);
      const balanceUSD = totalUSD - paidUSD;
      const totalUAH = totalUSD * rate;
      const isSelected = _selectedProjectIds.has(String(p.id));

      const tr = document.createElement('tr');
      if (isSelected) tr.classList.add('is-selected');
      if (hasSelection && !isSelected) tr.classList.add('is-dimmed');
      tr.dataset.projectId = p.id;
      tr.innerHTML = `
        <td class="project-name">${esc(p.name)}</td>
        <td class="col-num">${p.rate ? '$' + fmtNum(p.rate) : '—'}</td>
        <td class="col-num">${p.hours ? fmtNum(p.hours) : '—'}</td>
        <td class="col-num">${p.static_amount ? '$' + fmtNum(p.static_amount) : '—'}</td>
        <td class="col-num">$${fmtNum(totalUSD)}</td>
        <td class="col-num col-uah">${fmtNum(Math.round(totalUAH))} ₴</td>
        <td class="col-num"><button class="btn-paid-link" data-action="payments" data-id="${p.id}" data-name="${esc(p.name)}">$${fmtNum(paidUSD)}</button></td>
        <td class="col-num">$${fmtNum(balanceUSD)}</td>
        <td class="col-actions"></td>
      `;

      // Будуємо кнопки через DOM — інакше lucide не підхоплює <i data-lucide> з innerHTML
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'row-actions';
      actionsDiv.appendChild(makeIconBtn('journal', p.id, 'notebook-pen', '',        'Щоденник',   esc(p.name)));
      actionsDiv.appendChild(makeIconBtn('quick-entry', p.id, 'plus', '', 'Додати запис за сьогодні', esc(p.name)));
      actionsDiv.appendChild(makeIconBtn('task',    p.id, p.current_task ? 'message-square-more' : 'message-square-plus', p.current_task ? 'btn-row-active' : '', 'Коментар', null));
      actionsDiv.appendChild(makeIconBtn('edit',    p.id, 'pencil',       '',        'Редагувати', null));
      actionsDiv.appendChild(makeIconBtn('delete',  p.id, 'trash-2',      'btn-row-del', 'Видалити', null));
      tr.querySelector('.col-actions').appendChild(actionsDiv);

      tbody.appendChild(tr);

      const mobileCard = document.createElement('article');
      mobileCard.className = 'project-card';
      if (isSelected) mobileCard.classList.add('is-selected');
      if (hasSelection && !isSelected) mobileCard.classList.add('is-dimmed');
      mobileCard.dataset.projectId = p.id;
      mobileCard.innerHTML = `
        <div class="project-card-head">
          <div class="project-card-title">${esc(p.name)}</div>
          <button class="btn-paid-link project-card-paid-link" data-action="payments" data-id="${p.id}" data-name="${esc(p.name)}">$${fmtNum(paidUSD)}</button>
        </div>
        <div class="project-card-grid">
          <div class="project-card-metric">
            <span class="project-card-label">Разом $</span>
            <span class="project-card-value">$${fmtNum(totalUSD)}</span>
          </div>
          <div class="project-card-metric project-card-metric-uah">
            <span class="project-card-label">Разом ₴</span>
            <span class="project-card-value">${fmtNum(Math.round(totalUAH))} ₴</span>
          </div>
          <div class="project-card-metric">
            <span class="project-card-label">Оплачено</span>
            <span class="project-card-value">$${fmtNum(paidUSD)}</span>
          </div>
          <div class="project-card-metric">
            <span class="project-card-label">Залишок</span>
            <span class="project-card-value">$${fmtNum(balanceUSD)}</span>
          </div>
          <div class="project-card-metric">
            <span class="project-card-label">Ставка</span>
            <span class="project-card-value">${p.rate ? '$' + fmtNum(p.rate) : '—'}</span>
          </div>
          <div class="project-card-metric">
            <span class="project-card-label">Годин</span>
            <span class="project-card-value">${p.hours ? fmtNum(p.hours) : '—'}</span>
          </div>
          <div class="project-card-metric">
            <span class="project-card-label">Фікс</span>
            <span class="project-card-value">${p.static_amount ? '$' + fmtNum(p.static_amount) : '—'}</span>
          </div>
        </div>
        <div class="project-card-actions"></div>
        ${p.current_task ? `<div class="project-task-preview">${esc(p.current_task)}</div>` : ''}
      `;
      const mobileActions = document.createElement('div');
      mobileActions.className = 'row-actions';
      mobileActions.appendChild(makeIconBtn('journal', p.id, 'notebook-pen', '', 'Щоденник', esc(p.name)));
      mobileActions.appendChild(makeIconBtn('quick-entry', p.id, 'plus', '', 'Додати запис за сьогодні', esc(p.name)));
      mobileActions.appendChild(makeIconBtn('task', p.id, p.current_task ? 'message-square-more' : 'message-square-plus', p.current_task ? 'btn-row-active' : '', 'Коментар', null));
      mobileActions.appendChild(makeIconBtn('edit', p.id, 'pencil', '', 'Редагувати', null));
      mobileActions.appendChild(makeIconBtn('delete', p.id, 'trash-2', 'btn-row-del', 'Видалити', null));
      mobileCard.querySelector('.project-card-actions').appendChild(mobileActions);
      mobile.appendChild(mobileCard);
    });

    // Рендеримо Lucide іконки після вставки в DOM
    refreshIcons();

    const summaryProjects = getSummaryProjects();
    const sumUSD = summaryProjects.reduce((s, p) => s + calcTotal(p), 0);
    const paidUSD = summaryProjects.reduce((s, p) => s + getPaidAmount(p.id), 0);
    const balanceUSD = sumUSD - paidUSD;
    const sumUAH = sumUSD * Settings.getRate();
    document.getElementById('total-usd').textContent = '$' + fmtNum(sumUSD);
    document.getElementById('total-paid-usd').textContent = '$' + fmtNum(paidUSD);
    document.getElementById('total-balance-usd').textContent = '$' + fmtNum(balanceUSD);
    document.getElementById('total-uah').textContent = fmtNum(Math.round(sumUAH)) + ' ₴';
  }

  // ── RENDER SUMMARY ─────────────────────────────────────
  function renderSummary() {
    const summaryProjects = getSummaryProjects();
    const rate   = Settings.getRate();
    const sumUSD = summaryProjects.reduce((s, p) => s + calcTotal(p), 0);
    const sumUAH = sumUSD * rate;
    const paid   = summaryProjects.reduce((s, p) => s + getPaidAmount(p.id), 0);
    const unpaid = sumUSD - paid;

    document.getElementById('sum-usd').textContent    = '$' + fmtNum(sumUSD);
    document.getElementById('sum-uah').textContent    = fmtNum(Math.round(sumUAH)) + ' ₴';
    document.getElementById('sum-paid').textContent   = '$' + fmtNum(paid);
    document.getElementById('sum-unpaid').textContent = '$' + fmtNum(unpaid);
  }

  // ── TABLE EVENT DELEGATION ─────────────────────────────
  function handleProjectActions(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, id, name } = btn.dataset;

    if (action === 'journal') {
      JournalModal.open(id, name);
    } else if (action === 'quick-entry') {
      QuickEntryModal.open(id, name);
    } else if (action === 'payments') {
      PaymentModal.open(id, name);
    } else if (action === 'task') {
      TaskModal.open(id, name);
    } else if (action === 'edit') {
      const project = _projects.find(p => String(p.id) === String(id));
      if (project) ProjectModal.open(project);
    } else if (action === 'delete') {
      deleteProject(id);
    }
  }

  document.getElementById('projects-body').addEventListener('click', handleProjectActions);
  document.getElementById('mobile-projects').addEventListener('click', handleProjectActions);
  document.getElementById('projects-body').addEventListener('click', e => {
    if (e.target.closest('button, input, textarea, label, a')) return;
    const row = e.target.closest('tr[data-project-id]');
    if (!row) return;
    toggleProjectSelection(row.dataset.projectId);
  });
  document.getElementById('mobile-projects').addEventListener('click', e => {
    if (e.target.closest('button, input, textarea, label, a')) return;
    const card = e.target.closest('[data-project-id]');
    if (!card) return;
    toggleProjectSelection(card.dataset.projectId);
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

  return { init, reload, recalcAndRender, updateProjectTask, saveProjectPayments, getCurrentPeriod, getAllProjects, getCurrentMonthProjects, getUserEmail, getProjectPayments, refreshIcons };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
window.App = App;
