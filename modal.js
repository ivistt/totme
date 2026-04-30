// modal.js — логіка модальних вікон

// ── HELPERS ────────────────────────────────────────────────────────────────
function pad(n) { return String(n).padStart(2, '0'); }

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

const MONTH_UA = [
  'Січень','Лютий','Березень','Квітень','Травень','Червень',
  'Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'
];

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
    document.getElementById('field-paid').value   = project?.paid ? 'true' : 'false';

    document.getElementById('overlay-project').removeAttribute('hidden');
    document.getElementById('field-name').focus();
  }

  async function save() {
    const name      = document.getElementById('field-name').value.trim();
    const rate      = parseFloat(document.getElementById('field-rate').value) || 0;
    const hours     = parseFloat(document.getElementById('field-hours').value) || 0;
    const staticAmt = parseFloat(document.getElementById('field-static').value) || 0;
    const paid      = document.getElementById('field-paid').value === 'true';

    if (!name) { showToast('Вкажіть назву проєкту'); return; }

    const client = SupabaseClient.get();
    const uid    = SupabaseClient.userIdSync();

    // user_id підставляється автоматично через RLS (auth.uid())
    // але додаємо явно щоб було в даних
    const data = { name, rate, hours, static_amount: staticAmt, paid };
    if (uid) data.user_id = uid;

    let error;

    if (client && uid) {
      if (_mode === 'add') {
        ({ error } = await client.from('projects').insert(data));
      } else {
        ({ error } = await client.from('projects').update(data).eq('id', _editId));
      }
      if (error) { showToast('Помилка: ' + error.message); return; }
    } else {
      if (_mode === 'add') {
        data.id = 'local_' + Date.now();
        window.App?.addLocal(data);
      } else {
        window.App?.updateLocal(_editId, data);
      }
    }

    document.getElementById('overlay-project').setAttribute('hidden', '');
    showToast(_mode === 'add' ? 'Проєкт додано' : 'Збережено');
    window.App?.reload();
  }

  return { open, save };
})();

// ── JOURNAL MODAL ─────────────────────────────────────────────────────────
const JournalModal = (() => {
  let _projectId   = null;
  let _projectName = '';
  let _entries     = {};

  async function open(projectId, projectName) {
    _projectId   = projectId;
    _projectName = projectName;

    const now   = new Date();
    const year  = now.getFullYear();
    const month = now.getMonth();
    const today = pad(now.getDate()) + '.' + pad(month + 1) + '.' + year;

    document.getElementById('journal-title').textContent = 'Щоденник: ' + projectName;
    document.getElementById('journal-sub').textContent =
      MONTH_UA[month] + ' ' + year + ' — коментарі по днях';

    const copyBtn = document.getElementById('btn-copy-journal');
    copyBtn.classList.remove('copied');
    copyBtn.querySelector('.copy-text').textContent = 'копіювати';

    _entries = await loadEntries(projectId, year, month + 1);

    const body = document.getElementById('journal-body');
    body.innerHTML = '';
    const inner = document.createElement('div');
    inner.className = 'journal-body-inner';

    const daysCount = getDaysInMonth(year, month);
    for (let d = 1; d <= daysCount; d++) {
      const dateStr = pad(d) + '.' + pad(month + 1) + '.' + year;
      const isToday = dateStr === today;

      const row   = document.createElement('div');
      row.className = 'day-row';

      const label = document.createElement('span');
      label.className = 'day-label' + (isToday ? ' today' : '');
      label.textContent = dateStr + (isToday ? ' ←' : '');

      const input = document.createElement('input');
      input.type      = 'text';
      input.className = 'day-input' + (_entries[dateStr] ? ' has-value' : '');
      input.dataset.date = dateStr;
      input.placeholder  = 'коментар...';
      input.value        = _entries[dateStr] || '';

      input.addEventListener('input', () => {
        input.classList.toggle('has-value', input.value.trim().length > 0);
      });

      row.appendChild(label);
      row.appendChild(input);
      inner.appendChild(row);
    }

    body.appendChild(inner);
    document.getElementById('overlay-journal').removeAttribute('hidden');

    setTimeout(() => {
      const todayInput = inner.querySelector(`[data-date="${today}"]`);
      if (todayInput) todayInput.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 100);
  }

  async function loadEntries(projectId, year, month) {
    const client = SupabaseClient.get();
    const uid    = SupabaseClient.userIdSync();

    if (!client || !uid) {
      const raw = localStorage.getItem(`journal_${projectId}_${year}_${pad(month)}`);
      return raw ? JSON.parse(raw) : {};
    }

    const { data, error } = await client
      .from('journal_entries')
      .select('date, comment')
      .eq('project_id', projectId)
      .like('date', `${year}-${pad(month)}-%`);

    if (error) { console.error(error); return {}; }

    const map = {};
    (data || []).forEach(row => {
      const [y, m, d] = row.date.split('-');
      map[`${d}.${m}.${y}`] = row.comment;
    });
    return map;
  }

  async function save() {
    const inputs = document.querySelectorAll('#journal-body .day-input');
    const now    = new Date();
    const year   = now.getFullYear();
    const month  = now.getMonth();
    const uid    = SupabaseClient.userIdSync();

    const rows = [];
    inputs.forEach(inp => {
      const dateStr = inp.dataset.date;
      const comment = inp.value.trim();
      if (comment) {
        const [d, m, y] = dateStr.split('.');
        rows.push({ date: `${y}-${m}-${d}`, comment, project_id: _projectId });
      }
    });

    const client = SupabaseClient.get();

    if (!client || !uid) {
      const map = {};
      rows.forEach(r => {
        const [y, m, d] = r.date.split('-');
        map[`${d}.${m}.${y}`] = r.comment;
      });
      localStorage.setItem(
        `journal_${_projectId}_${year}_${pad(month + 1)}`,
        JSON.stringify(map)
      );
    } else {
      const upsertRows = rows.map(r => ({
        project_id: r.project_id,
        date:       r.date,
        comment:    r.comment,
        user_id:    uid,
      }));

      if (upsertRows.length > 0) {
        const { error } = await client
          .from('journal_entries')
          .upsert(upsertRows, { onConflict: 'project_id,date' });
        if (error) { showToast('Помилка збереження: ' + error.message); return; }
      }

      // Видалити порожні
      const savedDates  = rows.map(r => r.date);
      const allInputDates = Array.from(inputs).map(inp => {
        const [d, m, y] = inp.dataset.date.split('.');
        return `${y}-${m}-${d}`;
      });
      const toDelete = allInputDates.filter(dt => !savedDates.includes(dt));
      if (toDelete.length > 0) {
        await client
          .from('journal_entries')
          .delete()
          .eq('project_id', _projectId)
          .in('date', toDelete);
      }
    }

    document.getElementById('overlay-journal').setAttribute('hidden', '');
    showToast('Щоденник збережено');
  }

  function copyAll() {
    const inputs = document.querySelectorAll('#journal-body .day-input');
    const lines  = [];
    inputs.forEach(inp => {
      if (inp.value.trim()) lines.push(inp.dataset.date + ' — ' + inp.value.trim());
    });

    const text = lines.length > 0 ? lines.join('\n') : '(немає коментарів)';
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

// ── WIRE UP BUTTONS ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-add').addEventListener('click', () => ProjectModal.open());
  document.getElementById('btn-save-project').addEventListener('click', ProjectModal.save);
  document.getElementById('btn-save-journal').addEventListener('click', JournalModal.save);
  document.getElementById('btn-copy-journal').addEventListener('click', JournalModal.copyAll);
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
