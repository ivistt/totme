// modal.js — логіка модальних вікон

// ── HELPERS ────────────────────────────────────────────────────────────────
function pad(n) { return String(n).padStart(2, '0'); }

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function toDbDate(year, month, day) {
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

const MONTH_UA = [
  'Січень','Лютий','Березень','Квітень','Травень','Червень',
  'Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'
];

const WEEKDAY_UA = ['Пн','Вт','Ср','Чт','Пт','Сб','Нд'];

function fmtHours(n) {
  const num = parseFloat(n) || 0;
  return Number.isInteger(num)
    ? String(num)
    : num.toLocaleString('uk-UA', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function fmtMoney(n) {
  const num = parseFloat(n) || 0;
  return '$' + num.toLocaleString('uk-UA', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatDuration(totalSeconds) {
  const safe = Math.max(0, Math.round(totalSeconds || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function getTodayParts() {
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth(),
    day: now.getDate(),
    display: `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()}`,
    db: toDbDate(now.getFullYear(), now.getMonth(), now.getDate()),
  };
}

function calcEntryAmount(project, dailyHours) {
  const hours = parseFloat(dailyHours) || 0;
  const rate = parseFloat(project?.rate) || 0;
  const fixed = parseFloat(project?.static_amount) || 0;
  const projectHours = parseFloat(project?.hours) || 0;

  if (fixed > 0 && projectHours > 0) {
    return (fixed / projectHours) * hours;
  }
  if (fixed > 0 && hours > 0 && projectHours <= 0) {
    return fixed;
  }
  return rate * hours;
}

function emptyEntry() {
  return { comment: '', hours: 0 };
}

// ── CLOSE BUTTONS ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById(btn.dataset.close).setAttribute('hidden', '');
    });
  });

  document.querySelectorAll('.overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.setAttribute('hidden', '');
    });
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.overlay:not([hidden])').forEach(o => {
        o.setAttribute('hidden', '');
      });
    }
  });
});

// ── PROJECT FORM ──────────────────────────────────────────────────────────
const ProjectModal = (() => {
  let _mode = 'add';
  let _editId = null;

  function open(project = null) {
    _mode = project ? 'edit' : 'add';
    _editId = project ? project.id : null;

    document.getElementById('project-modal-title').textContent =
      project ? 'Редагувати проєкт' : 'Новий проєкт';

    document.getElementById('field-name').value   = project?.name || '';
    document.getElementById('field-rate').value   = project?.rate || '';
    document.getElementById('field-hours').value  = project?.hours || '';
    document.getElementById('field-static').value = project?.static_amount || '';

    document.getElementById('overlay-project').removeAttribute('hidden');
    document.getElementById('field-name').focus();
  }

  async function save() {
    const name      = document.getElementById('field-name').value.trim();
    const rate      = parseFloat(document.getElementById('field-rate').value) || 0;
    const staticAmt = parseFloat(document.getElementById('field-static').value) || 0;

    if (!name) { showToast('Вкажіть назву проєкту'); return; }

    const client = SupabaseClient.get();
    const uid    = SupabaseClient.userIdSync();

    const data = { name, rate, static_amount: staticAmt };
    if (uid) data.user_id = uid;

    let error;

    if (!client || !uid) {
      showToast('Немає авторизації для збереження проєкту');
      return;
    }

    if (_mode === 'add') {
      ({ error } = await client.from('projects').insert(data));
    } else {
      ({ error } = await client.from('projects').update(data).eq('id', _editId));
    }
    if (error) { showToast('Помилка: ' + error.message); return; }

    document.getElementById('overlay-project').setAttribute('hidden', '');
    showToast(_mode === 'add' ? 'Проєкт додано' : 'Збережено');
    window.App?.reload();
  }

  return { open, save };
})();

// ── JOURNAL DATA ───────────────────────────────────────────────────────────
async function loadJournalEntriesForProject(projectId, year, month) {
  const client = SupabaseClient.get();
  const uid = SupabaseClient.userIdSync();

  if (!client || !uid) return {};

  const monthIndex = month - 1;
  const fromDate = toDbDate(year, monthIndex, 1);
  const toDate = toDbDate(year, monthIndex, getDaysInMonth(year, monthIndex));

  const { data, error } = await client
    .from('journal_entries')
    .select('date, comment, hours')
    .eq('project_id', projectId)
    .gte('date', fromDate)
    .lte('date', toDate)
    .order('date', { ascending: true });

  if (error) {
    console.error('Journal load error:', error);
    showToast('Не вдалося завантажити записи');
    return {};
  }

  const map = {};
  (data || []).forEach(row => {
    const [y, m, d] = row.date.split('-');
    map[`${d}.${m}.${y}`] = {
      comment: row.comment || '',
      hours: parseFloat(row.hours) || 0,
    };
  });
  return map;
}

async function loadMonthEntriesAcrossProjects(year, month) {
  const client = SupabaseClient.get();
  const uid = SupabaseClient.userIdSync();
  const projects = window.App?.getAllProjects?.() || [];
  const projectMap = new Map(projects.map(project => [String(project.id), project]));

  if (!client || !uid) return [];

  const monthIndex = month - 1;
  const fromDate = toDbDate(year, monthIndex, 1);
  const toDate = toDbDate(year, monthIndex, getDaysInMonth(year, monthIndex));

  const { data, error } = await client
    .from('journal_entries')
    .select('project_id, date, comment, hours')
    .gte('date', fromDate)
    .lte('date', toDate)
    .order('date', { ascending: true });

  if (error) {
    console.error('Profile month load error:', error);
    showToast('Не вдалося завантажити календар');
    return [];
  }

  return (data || []).map(row => ({
    ...row,
    hours: parseFloat(row.hours) || 0,
    project: projectMap.get(String(row.project_id)) || null,
  }));
}

async function loadSingleJournalEntry(projectId, dbDate) {
  const client = SupabaseClient.get();
  const uid = SupabaseClient.userIdSync();

  if (!client || !uid) return emptyEntry();

  const { data, error } = await client
    .from('journal_entries')
    .select('comment, hours')
    .eq('project_id', projectId)
    .eq('date', dbDate)
    .maybeSingle();

  if (error) {
    console.error('Journal single load error:', error);
    return emptyEntry();
  }

  return data ? { comment: data.comment || '', hours: parseFloat(data.hours) || 0 } : emptyEntry();
}

async function saveJournalEntry(projectId, dbDate, comment, hours) {
  const client = SupabaseClient.get();
  const uid = SupabaseClient.userIdSync();
  if (!client || !uid) return { ok: false, error: 'Немає авторизації' };

  const { error } = await client
    .from('journal_entries')
    .upsert([{
      project_id: projectId,
      date: dbDate,
      comment: comment || '',
      hours: parseFloat(hours) || 0,
      user_id: uid,
    }], { onConflict: 'project_id,date' });

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

async function syncProjectHoursFromJournal(projectId, year, month) {
  const client = SupabaseClient.get();
  const uid = SupabaseClient.userIdSync();
  let totalHours = 0;

  if (!client || !uid) return { ok: false, error: 'Немає авторизації' };

  const monthIndex = month - 1;
  const fromDate = toDbDate(year, monthIndex, 1);
  const toDate = toDbDate(year, monthIndex, getDaysInMonth(year, monthIndex));

  const { data, error } = await client
    .from('journal_entries')
    .select('hours')
    .eq('project_id', projectId)
    .gte('date', fromDate)
    .lte('date', toDate);

  if (error) {
    return { ok: false, error: error.message };
  }

  totalHours = (data || []).reduce((sum, row) => sum + (parseFloat(row.hours) || 0), 0);

  const { error: updateError } = await client
    .from('projects')
    .update({ hours: parseFloat(totalHours.toFixed(2)) })
    .eq('id', projectId);

  if (updateError) {
    return { ok: false, error: updateError.message };
  }

  return { ok: true };
}

// ── JOURNAL MODAL ─────────────────────────────────────────────────────────
const JournalModal = (() => {
  let _projectId   = null;
  let _projectName = '';
  let _entries     = {};
  let _currentYear = null;
  let _currentMonth = null;
  let _currentProject = null;

  function buildDayRow(dateStr, entry, isToday) {
    const row = document.createElement('div');
    row.className = 'journal-day-row';

    const meta = document.createElement('div');
    meta.className = 'journal-day-meta';

    const label = document.createElement('span');
    label.className = 'day-label' + (isToday ? ' today' : '');
    label.textContent = dateStr + (isToday ? ' ←' : '');

    const hours = document.createElement('input');
    hours.type = 'number';
    hours.className = 'day-hours';
    hours.dataset.date = dateStr;
    hours.placeholder = '0';
    hours.min = '0';
    hours.step = '0.25';
    hours.value = entry.hours ? String(entry.hours) : '';

    meta.appendChild(label);
    meta.appendChild(hours);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'day-input' + ((entry.comment || '').trim() ? ' has-value' : '');
    input.dataset.date = dateStr;
    input.placeholder = 'задачі / коментар...';
    input.value = entry.comment || '';

    input.addEventListener('input', () => {
      input.classList.toggle('has-value', input.value.trim().length > 0);
    });

    row.appendChild(meta);
    row.appendChild(input);
    return row;
  }

  async function open(projectId, projectName) {
    _projectId   = projectId;
    _projectName = projectName;
    _currentProject = (window.App?.getAllProjects?.() || []).find(project => String(project.id) === String(projectId)) || null;

    const period = window.App?.getCurrentPeriod?.();
    const now = new Date();
    const year = period?.year ?? now.getFullYear();
    const month = period?.month ?? now.getMonth();
    const isCurrentCalendarMonth =
      year === now.getFullYear() && month === now.getMonth();
    const today = isCurrentCalendarMonth
      ? pad(now.getDate()) + '.' + pad(month + 1) + '.' + year
      : null;

    _currentYear = year;
    _currentMonth = month;

    document.getElementById('journal-title').textContent = 'Щоденник: ' + projectName;
    document.getElementById('journal-sub').textContent =
      MONTH_UA[month] + ' ' + year + ' — задачі та години по днях';

    const copyBtn = document.getElementById('btn-copy-journal');
    copyBtn.classList.remove('copied');
    copyBtn.querySelector('.copy-text').textContent = 'копіювати';

    _entries = await loadJournalEntriesForProject(projectId, year, month + 1);

    const body = document.getElementById('journal-body');
    body.innerHTML = '';
    const inner = document.createElement('div');
    inner.className = 'journal-body-inner';

    const daysCount = getDaysInMonth(year, month);
    for (let d = 1; d <= daysCount; d++) {
      const dateStr = pad(d) + '.' + pad(month + 1) + '.' + year;
      const isToday = today && dateStr === today;
      inner.appendChild(buildDayRow(dateStr, _entries[dateStr] || emptyEntry(), isToday));
    }

    body.appendChild(inner);
    document.getElementById('overlay-journal').removeAttribute('hidden');
    window.App?.refreshIcons?.();

    setTimeout(() => {
      const todayInput = today ? inner.querySelector(`[data-date="${today}"]`) : inner.querySelector('.day-input');
      if (todayInput) todayInput.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 100);
  }

  async function save() {
    const rows = [];
    const year = _currentYear;
    const month = _currentMonth;
    const uid = SupabaseClient.userIdSync();
    const client = SupabaseClient.get();
    const lineItems = document.querySelectorAll('#journal-body .journal-day-row');

    lineItems.forEach(row => {
      const commentInput = row.querySelector('.day-input');
      const hoursInput = row.querySelector('.day-hours');
      const dateStr = commentInput.dataset.date;
      const comment = commentInput.value.trim();
      const hours = parseFloat(hoursInput.value) || 0;

      if (comment || hours > 0) {
        const [d, m, y] = dateStr.split('.');
        rows.push({ date: `${y}-${m}-${d}`, comment, hours, project_id: _projectId });
      }
    });

    if (!client || !uid) {
      showToast('Немає авторизації для збереження щоденника');
      return;
    }

    const upsertRows = rows.map(r => ({
      project_id: r.project_id,
      date: r.date,
      comment: r.comment,
      hours: r.hours,
      user_id: uid,
    }));

    if (upsertRows.length > 0) {
      const { error } = await client
        .from('journal_entries')
        .upsert(upsertRows, { onConflict: 'project_id,date' });
      if (error) { showToast('Помилка збереження: ' + error.message); return; }
    }

    const allInputDates = Array.from(lineItems).map(row => {
      const dateStr = row.querySelector('.day-input').dataset.date;
      const [d, m, y] = dateStr.split('.');
      return `${y}-${m}-${d}`;
    });
    const savedDates = rows.map(r => r.date);
    const toDelete = allInputDates.filter(dt => !savedDates.includes(dt));

    if (toDelete.length > 0) {
      const { error } = await client
        .from('journal_entries')
        .delete()
        .eq('project_id', _projectId)
        .in('date', toDelete);
      if (error) { showToast('Помилка очищення: ' + error.message); return; }
    }

    const syncResult = await syncProjectHoursFromJournal(_projectId, year, month + 1);
    if (!syncResult.ok) {
      showToast('Помилка перерахунку годин: ' + syncResult.error);
      return;
    }

    document.getElementById('overlay-journal').setAttribute('hidden', '');
    await window.App?.reload?.();
    showToast('Щоденник збережено');
  }

  function copyAll() {
    const rows = document.querySelectorAll('#journal-body .journal-day-row');
    const lines = [];
    let totalHours = 0;
    rows.forEach(row => {
      const date = row.querySelector('.day-input').dataset.date;
      const comment = row.querySelector('.day-input').value.trim();
      const hours = parseFloat(row.querySelector('.day-hours').value) || 0;
      if (comment || hours > 0) {
        totalHours += hours;
        const parts = [date];
        if (hours > 0) parts.push(`${fmtHours(hours)} год`);
        if (comment) parts.push(comment);
        lines.push(parts.join(' — '));
      }
    });

    const totalUsd = calcEntryAmount(_currentProject, totalHours);
    if (lines.length > 0) {
      lines.push('');
      lines.push('---');
      lines.push(`Разом годин: ${fmtHours(totalHours)}`);
      lines.push(`Разом $: ${totalUsd.toLocaleString('uk-UA', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`);
    }

    const text = lines.length > 0 ? lines.join('\n') : '(немає записів)';
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById('btn-copy-journal');
      btn.classList.add('copied');
      btn.querySelector('.copy-text').textContent = 'скопійовано!';
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.querySelector('.copy-text').textContent = 'копіювати';
      }, 2200);
    }).catch(() => showToast('Помилка копіювання'));
  }

  return { open, save, copyAll };
})();

// ── TASK MODAL ────────────────────────────────────────────────────────────
const TaskModal = (() => {
  let _projectId = null;

  function open(projectId, projectName) {
    _projectId = projectId;
    const project = (window.App?.getAllProjects?.() || []).find(item => String(item.id) === String(projectId));
    document.getElementById('task-modal-title').textContent = 'Коментар до проєкту';
    document.getElementById('task-modal-sub').textContent = projectName || '—';
    document.getElementById('task-modal-input').value = project?.current_task || '';
    document.getElementById('overlay-task').removeAttribute('hidden');
    document.getElementById('task-modal-input').focus();
  }

  async function save() {
    if (!_projectId) return;
    const value = document.getElementById('task-modal-input').value;
    const ok = await window.App?.updateProjectTask?.(_projectId, value);
    if (!ok) return;
    document.getElementById('overlay-task').setAttribute('hidden', '');
    await window.App?.recalcAndRender?.();
    showToast('Коментар збережено');
  }

  return { open, save };
})();

// ── QUICK ENTRY MODAL ─────────────────────────────────────────────────────
const QuickEntryModal = (() => {
  let _projectId = null;

  function mergeComments(existingComment, nextComment) {
    const current = String(existingComment || '').trim();
    const incoming = String(nextComment || '').trim();

    if (!current) return incoming;
    if (!incoming) return current;
    return `${current}, ${incoming}`;
  }

  function open(projectId, projectName) {
    _projectId = projectId;
    const today = getTodayParts();
    document.getElementById('quick-entry-sub').textContent = `${projectName || '—'} — ${today.display}`;
    document.getElementById('quick-entry-hours').value = '';
    document.getElementById('quick-entry-comment').value = '';
    document.getElementById('overlay-quick-entry').removeAttribute('hidden');
    document.getElementById('quick-entry-hours').focus();
  }

  async function save() {
    if (!_projectId) return;

    const hours = parseFloat(document.getElementById('quick-entry-hours').value) || 0;
    const comment = document.getElementById('quick-entry-comment').value.trim();

    if (hours <= 0 && !comment) {
      showToast('Додайте години або коментар');
      return;
    }

    const today = getTodayParts();
    const currentEntry = await loadSingleJournalEntry(_projectId, today.db);
    const nextHours = parseFloat(((parseFloat(currentEntry.hours) || 0) + hours).toFixed(2));
    const nextComment = mergeComments(currentEntry.comment, comment);

    const journalResult = await saveJournalEntry(_projectId, today.db, nextComment, nextHours);
    if (!journalResult.ok) {
      showToast('Помилка запису в щоденник: ' + journalResult.error);
      return;
    }

    const syncResult = await syncProjectHoursFromJournal(_projectId, today.year, today.month + 1);
    if (!syncResult.ok) {
      showToast('Помилка перерахунку годин: ' + syncResult.error);
      return;
    }

    document.getElementById('overlay-quick-entry').setAttribute('hidden', '');
    await window.App?.reload?.();
    showToast('Запис за сьогодні додано');
  }

  return { open, save };
})();

// ── PAYMENTS MODAL ────────────────────────────────────────────────────────
const PaymentModal = (() => {
  let _projectId = null;

  function getTodayDbDate() {
    return getTodayParts().db;
  }

  function renderRow(payment = { paid_at: '', amount: '' }) {
    const paidAt = payment.paid_at || getTodayDbDate();
    const row = document.createElement('div');
    row.className = 'payment-row';
    row.innerHTML = `
      <input type="date" class="payment-date" value="${paidAt}" />
      <input type="number" class="payment-amount" value="${payment.amount || ''}" min="0" step="0.01" placeholder="0.00" />
      <button type="button" class="btn-row btn-row-del" data-remove-payment title="Видалити оплату" aria-label="Видалити оплату">
        <i data-lucide="trash-2"></i>
      </button>
    `;
    row.querySelector('[data-remove-payment]').addEventListener('click', () => {
      row.remove();
      updateTotal();
      window.App?.refreshIcons?.();
    });
    row.querySelector('.payment-date').addEventListener('input', updateTotal);
    row.querySelector('.payment-amount').addEventListener('input', updateTotal);
    return row;
  }

  function updateTotal() {
    const total = Array.from(document.querySelectorAll('#payments-list .payment-amount'))
      .reduce((sum, input) => sum + (parseFloat(input.value) || 0), 0);
    document.getElementById('payments-total-value').textContent =
      '$' + total.toLocaleString('uk-UA', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function open(projectId, projectName) {
    _projectId = projectId;
    document.getElementById('payments-modal-sub').textContent = projectName || '—';
    const list = document.getElementById('payments-list');
    list.innerHTML = '';
    const payments = window.App?.getProjectPayments?.(projectId) || [];
    if (payments.length === 0) {
      list.appendChild(renderRow());
    } else {
      payments.forEach(payment => list.appendChild(renderRow(payment)));
    }
    document.getElementById('overlay-payments').removeAttribute('hidden');
    updateTotal();
    window.App?.refreshIcons?.();
  }

  function addRow() {
    document.getElementById('payments-list').appendChild(renderRow());
    window.App?.refreshIcons?.();
  }

  async function save() {
    if (!_projectId) return;
    const payments = Array.from(document.querySelectorAll('#payments-list .payment-row')).map(row => ({
      paid_at: row.querySelector('.payment-date').value || getTodayDbDate(),
      amount: row.querySelector('.payment-amount').value,
    }));
    const ok = await window.App?.saveProjectPayments?.(_projectId, payments);
    if (!ok) return;
    document.getElementById('overlay-payments').setAttribute('hidden', '');
    showToast('Оплати збережено');
  }

  return { open, addRow, save };
})();

// ── PROFILE MODAL ─────────────────────────────────────────────────────────
const ProfileModal = (() => {
  let _email = '';
  let _year = new Date().getFullYear();
  let _month = new Date().getMonth();
  let _entries = [];
  let _selectedDate = '';

  function setUser(email) {
    _email = email || '';
    const initial = (_email.trim()[0] || '?').toUpperCase();
    const avatar = document.getElementById('avatar-initial');
    const profileAvatar = document.getElementById('profile-avatar');
    const profileEmail = document.getElementById('profile-email');
    if (avatar) avatar.textContent = initial;
    if (profileAvatar) profileAvatar.textContent = initial;
    if (profileEmail) profileEmail.textContent = _email || '—';
  }

  function getEntriesForSelectedDate() {
    if (!_selectedDate) return [];
    return _entries.filter(entry => entry.date === _selectedDate);
  }

  function renderDayDetails() {
    const list = document.getElementById('profile-day-list');
    const count = document.getElementById('profile-day-count');
    const title = document.getElementById('profile-day-title');
    const hoursEl = document.getElementById('profile-day-hours');
    const usdEl = document.getElementById('profile-day-usd');
    const uahEl = document.getElementById('profile-day-uah');

    if (!_selectedDate) {
      title.textContent = 'Оберіть день';
      hoursEl.textContent = '—';
      usdEl.textContent = '—';
      uahEl.textContent = '—';
      count.textContent = '0 записів';
      list.innerHTML = '<div class="profile-empty">Оберіть день у календарі, щоб подивитись деталізацію.</div>';
      return;
    }

    const items = getEntriesForSelectedDate();
    const totalHours = items.reduce((sum, item) => sum + (parseFloat(item.hours) || 0), 0);
    const totalUsd = items.reduce((sum, item) => sum + calcEntryAmount(item.project, item.hours), 0);
    const totalUah = totalUsd * Settings.getRate();
    const [year, month, day] = _selectedDate.split('-');

    title.textContent = `${day}.${month}.${year}`;
    hoursEl.textContent = fmtHours(totalHours);
    usdEl.textContent = fmtMoney(totalUsd);
    uahEl.textContent = Math.round(totalUah).toLocaleString('uk-UA') + ' ₴';
    count.textContent = `${items.length} ${items.length === 1 ? 'запис' : 'записів'}`;

    if (items.length === 0) {
      list.innerHTML = '<div class="profile-empty">На цей день записів немає.</div>';
      return;
    }

    list.innerHTML = '';
    items.forEach(item => {
      const card = document.createElement('div');
      card.className = 'profile-entry';
      card.innerHTML = `
        <div class="profile-entry-head">
          <div class="profile-entry-project">${item.project?.name || 'Проєкт'}</div>
          <div class="profile-entry-amount">${fmtMoney(calcEntryAmount(item.project, item.hours))}</div>
        </div>
        <div class="profile-entry-meta">
          <span>${fmtHours(item.hours)} год</span>
          <span>${Math.round(calcEntryAmount(item.project, item.hours) * Settings.getRate()).toLocaleString('uk-UA')} ₴</span>
        </div>
        <div class="profile-entry-comment">${item.comment || 'Без опису задач'}</div>
      `;
      list.appendChild(card);
    });
  }

  function renderCalendar() {
    document.getElementById('profile-month-title').textContent = `${MONTH_UA[_month]} ${_year}`;

    const weekdays = document.getElementById('profile-weekdays');
    if (!weekdays.dataset.ready) {
      weekdays.innerHTML = WEEKDAY_UA.map(day => `<span class="calendar-weekday">${day}</span>`).join('');
      weekdays.dataset.ready = 'true';
    }

    const grid = document.getElementById('profile-calendar-grid');
    grid.innerHTML = '';

    const firstDay = new Date(_year, _month, 1);
    const offset = (firstDay.getDay() + 6) % 7;
    const daysInMonth = getDaysInMonth(_year, _month);
    const today = toDbDate(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
    const statsByDate = new Map();

    _entries.forEach(entry => {
      const existing = statsByDate.get(entry.date) || { count: 0, hours: 0, usd: 0 };
      existing.count += 1;
      existing.hours += parseFloat(entry.hours) || 0;
      existing.usd += calcEntryAmount(entry.project, entry.hours);
      statsByDate.set(entry.date, existing);
    });

    for (let i = 0; i < offset; i++) {
      const empty = document.createElement('div');
      empty.className = 'calendar-cell is-empty';
      grid.appendChild(empty);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const date = toDbDate(_year, _month, day);
      const stats = statsByDate.get(date);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'calendar-cell';
      if (date === today) btn.classList.add('is-today');
      if (date === _selectedDate) btn.classList.add('is-selected');
      if (stats) btn.classList.add('has-data');
      btn.innerHTML = `
        <span class="calendar-day-num">${day}</span>
        <span class="calendar-day-meta">${stats ? `${fmtHours(stats.hours)} год` : '—'}</span>
      `;
      btn.addEventListener('click', () => {
        _selectedDate = date;
        renderCalendar();
        renderDayDetails();
      });
      grid.appendChild(btn);
    }
  }

  async function reloadMonth() {
    _entries = await loadMonthEntriesAcrossProjects(_year, _month + 1);
    const firstDayOfMonth = toDbDate(_year, _month, 1);
    const lastDayOfMonth = toDbDate(_year, _month, getDaysInMonth(_year, _month));
    if (!_selectedDate || _selectedDate < firstDayOfMonth || _selectedDate > lastDayOfMonth) {
      _selectedDate = '';
    }
    renderCalendar();
    renderDayDetails();
  }

  async function open() {
    const period = window.App?.getCurrentPeriod?.();
    _year = period?.year ?? new Date().getFullYear();
    _month = period?.month ?? new Date().getMonth();
    _selectedDate = '';
    document.getElementById('overlay-profile').removeAttribute('hidden');
    setUser(window.App?.getUserEmail?.() || _email);
    await reloadMonth();
    window.App?.refreshIcons?.();
  }

  function shiftMonth(delta) {
    _month += delta;
    if (_month < 0) { _month = 11; _year -= 1; }
    if (_month > 11) { _month = 0; _year += 1; }
    reloadMonth();
  }

  return { open, setUser, shiftMonth };
})();

window.ProfileModal = ProfileModal;

// ── TIMER MODAL ───────────────────────────────────────────────────────────
const TimerModal = (() => {
  let _state = { running: false, startedAt: null };
  let _ticker = null;
  let _elapsedSeconds = 0;
  let _projects = [];
  let _weights = [];
  let _drag = null;

  function saveState() {}

  function loadState() {
    _state = { running: false, startedAt: null };
  }

  function setButtonState() {
    const btn = document.getElementById('btn-timer');
    const iconWrap = document.getElementById('timer-icon');
    btn.classList.toggle('is-running', _state.running);
    iconWrap.innerHTML = `<i data-lucide="${_state.running ? 'square' : 'play'}"></i>`;
    btn.setAttribute('aria-label', _state.running ? 'Зупинити секундомір' : 'Запустити секундомір');
    window.App?.refreshIcons?.();
  }

  function renderTimerDisplay(seconds) {
    document.getElementById('timer-display').textContent = formatDuration(seconds);
  }

  function currentElapsedSeconds() {
    if (!_state.running || !_state.startedAt) return 0;
    return Math.max(0, Math.round((Date.now() - _state.startedAt) / 1000));
  }

  function startTicker() {
    stopTicker();
    _ticker = setInterval(() => {
      renderTimerDisplay(currentElapsedSeconds());
    }, 1000);
  }

  function stopTicker() {
    if (_ticker) clearInterval(_ticker);
    _ticker = null;
  }

  function start() {
    _state = { running: true, startedAt: Date.now() };
    saveState();
    renderTimerDisplay(0);
    setButtonState();
    startTicker();
  }

  function initializeWeights() {
    const count = _projects.length;
    if (count === 0) {
      _weights = [];
      return;
    }
    const base = 1 / count;
    _weights = Array.from({ length: count }, () => base);
    const sum = _weights.reduce((acc, value) => acc + value, 0);
    _weights[count - 1] += 1 - sum;
  }

  function normalizeWeights() {
    if (_weights.length === 0) return;
    const sum = _weights.reduce((acc, value) => acc + value, 0) || 1;
    _weights = _weights.map(value => value / sum);
    const diff = 1 - _weights.reduce((acc, value) => acc + value, 0);
    _weights[_weights.length - 1] += diff;
  }

  function getBoundaries() {
    const boundaries = [];
    let cursor = 0;
    for (let i = 0; i < _weights.length - 1; i++) {
      cursor += _weights[i];
      boundaries.push(cursor);
    }
    return boundaries;
  }

  function secondsToHours(seconds) {
    return seconds / 3600;
  }

  function weightToSeconds(weight) {
    return _elapsedSeconds * weight;
  }

  function renderAllocation() {
    const empty = document.getElementById('timer-empty');
    const saveBtn = document.getElementById('btn-save-timer');
    const rows = document.getElementById('timer-rows');
    const track = document.getElementById('timer-track');

    document.getElementById('timer-total').textContent = formatDuration(_elapsedSeconds);
    document.getElementById('timer-total-hours').textContent =
      `${fmtHours(secondsToHours(_elapsedSeconds))} год`;

    if (_projects.length === 0) {
      empty.hidden = false;
      rows.innerHTML = '';
      track.innerHTML = '';
      saveBtn.disabled = true;
      return;
    }

    empty.hidden = true;
    saveBtn.disabled = false;
    rows.innerHTML = '';
    track.innerHTML = '';

    const colors = ['#c8f542', '#7bdff2', '#f7a072', '#b2f7ef', '#f2e94e', '#e05252', '#8fb8ff', '#7ddc6f'];
    let leftPercent = 0;
    _projects.forEach((project, index) => {
      const segment = document.createElement('div');
      segment.className = 'timer-segment';
      segment.style.left = `${leftPercent * 100}%`;
      segment.style.width = `${_weights[index] * 100}%`;
      segment.style.background = colors[index % colors.length];
      track.appendChild(segment);

      const row = document.createElement('div');
      row.className = 'timer-row';
      row.innerHTML = `
        <div class="timer-row-left">
          <span class="timer-row-dot" style="background:${colors[index % colors.length]}"></span>
          <span class="timer-row-name">${project.name}</span>
        </div>
        <div class="timer-row-meta">
          <span>${Math.round(_weights[index] * 100)}%</span>
          <span>${fmtHours(secondsToHours(weightToSeconds(_weights[index])))} год</span>
        </div>
      `;
      rows.appendChild(row);
      leftPercent += _weights[index];
    });

    const boundaries = getBoundaries();
    boundaries.forEach((boundary, index) => {
      const handle = document.createElement('button');
      handle.type = 'button';
      handle.className = 'timer-handle';
      handle.style.left = `${boundary * 100}%`;
      handle.dataset.index = String(index);
      handle.addEventListener('mousedown', beginDrag);
      track.appendChild(handle);
    });
  }

  function beginDrag(event) {
    event.preventDefault();
    _drag = {
      handleIndex: parseInt(event.currentTarget.dataset.index, 10),
      rect: document.getElementById('timer-track').getBoundingClientRect(),
    };
    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup', endDrag);
  }

  function onDrag(event) {
    if (!_drag) return;
    const count = _weights.length;
    if (count < 2) return;

    const minSegment = 0.0001;
    const pointerRatio = (event.clientX - _drag.rect.left) / _drag.rect.width;
    const prevBoundary = _drag.handleIndex === 0
      ? 0
      : getBoundaries()[_drag.handleIndex - 1];
    const nextBoundary = _drag.handleIndex === count - 2
      ? 1
      : getBoundaries()[_drag.handleIndex + 1];
    const clamped = Math.min(nextBoundary - minSegment, Math.max(prevBoundary + minSegment, pointerRatio));

    const boundaries = getBoundaries();
    const oldBoundary = boundaries[_drag.handleIndex];
    const delta = clamped - oldBoundary;

    _weights[_drag.handleIndex] += delta;
    _weights[_drag.handleIndex + 1] -= delta;
    normalizeWeights();
    renderAllocation();
  }

  function endDrag() {
    _drag = null;
    document.removeEventListener('mousemove', onDrag);
    document.removeEventListener('mouseup', endDrag);
  }

  async function stop() {
    _elapsedSeconds = currentElapsedSeconds();
    _state = { running: false, startedAt: null };
    saveState();
    stopTicker();
    renderTimerDisplay(0);
    setButtonState();

    if (_elapsedSeconds < 60) {
      showToast('Сесія коротша за 1 хвилину');
      return;
    }

    _projects = window.App?.getCurrentMonthProjects?.() || [];
    initializeWeights();
    const today = getTodayParts();
    document.getElementById('timer-modal-sub').textContent =
      `${today.display} — розподіліть ${formatDuration(_elapsedSeconds)} між проєктами місяця`;
    document.getElementById('overlay-timer').removeAttribute('hidden');
    renderAllocation();
  }

  async function saveAllocation() {
    if (_projects.length === 0) {
      document.getElementById('overlay-timer').setAttribute('hidden', '');
      return;
    }

    const today = getTodayParts();
    const touchedProjectIds = new Set();
    for (let i = 0; i < _projects.length; i++) {
      const project = _projects[i];
      const seconds = weightToSeconds(_weights[i]);
      const deltaHours = parseFloat(secondsToHours(seconds).toFixed(2));
      if (deltaHours <= 0) continue;

      const currentEntry = await loadSingleJournalEntry(project.id, today.db);
      const nextHours = parseFloat(((parseFloat(currentEntry.hours) || 0) + deltaHours).toFixed(2));
      const journalResult = await saveJournalEntry(project.id, today.db, currentEntry.comment || '', nextHours);
      if (!journalResult.ok) {
        showToast('Помилка запису в щоденник: ' + journalResult.error);
        return;
      }
      touchedProjectIds.add(String(project.id));
    }

    for (const projectId of touchedProjectIds) {
      const syncResult = await syncProjectHoursFromJournal(projectId, today.year, today.month + 1);
      if (!syncResult.ok) {
        showToast('Помилка перерахунку годин: ' + syncResult.error);
        return;
      }
    }

    document.getElementById('overlay-timer').setAttribute('hidden', '');
    await window.App?.reload?.();
    showToast('Час розподілено');
  }

  function toggle() {
    if (_state.running) {
      stop();
    } else {
      start();
    }
  }

  function init() {
    loadState();
    setButtonState();
    renderTimerDisplay(_state.running ? currentElapsedSeconds() : 0);
    if (_state.running) startTicker();
  }

  return { init, toggle, saveAllocation };
})();

// ── WIRE UP BUTTONS ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-add').addEventListener('click', () => ProjectModal.open());
  document.getElementById('btn-add-payment').addEventListener('click', PaymentModal.addRow);
  document.getElementById('btn-save-payments').addEventListener('click', PaymentModal.save);
  document.getElementById('btn-save-quick-entry').addEventListener('click', QuickEntryModal.save);
  document.getElementById('btn-save-task').addEventListener('click', TaskModal.save);
  document.getElementById('btn-timer').addEventListener('click', TimerModal.toggle);
  document.getElementById('btn-save-timer').addEventListener('click', TimerModal.saveAllocation);
  document.getElementById('btn-save-project').addEventListener('click', ProjectModal.save);
  document.getElementById('btn-save-journal').addEventListener('click', JournalModal.save);
  document.getElementById('btn-copy-journal').addEventListener('click', JournalModal.copyAll);
  document.getElementById('btn-profile').addEventListener('click', ProfileModal.open);
  document.getElementById('profile-month-prev').addEventListener('click', () => ProfileModal.shiftMonth(-1));
  document.getElementById('profile-month-next').addEventListener('click', () => ProfileModal.shiftMonth(1));
  document.getElementById('btn-profile-logout').addEventListener('click', async () => {
    await SupabaseClient.signOut();
    document.getElementById('overlay-profile').setAttribute('hidden', '');
  });
  TimerModal.init();
});

// ── TOAST ─────────────────────────────────────────────────────────────────
let _toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}
