let roomState = { window_open: false, ac_on: false, light_on: true, toilet_open: false, cleanliness: 78 };

const ROOM_PLACEHOLDERS = [
  '也許該把桌上的東西整理一下...',
  '也許該順手把垃圾帶出去...',
  '也許該掃一下地板...',
  '開了冰箱拿東西，忘了關...',
  '也許該把髒衣服收一收...',
  '也許該擦一下窗台...',
  '也許該把書堆整理好...',
  '也許該洗一下廚房水槽...',
];

function randomPlaceholder() {
  return ROOM_PLACEHOLDERS[Math.floor(Math.random() * ROOM_PLACEHOLDERS.length)];
}

function openPanel() {
  document.getElementById('side-panel').classList.add('open');
  document.getElementById('overlay').classList.add('open');
  document.getElementById('room-action-input').placeholder = randomPlaceholder();
}
function closePanel() {
  document.getElementById('side-panel').classList.remove('open');
  document.getElementById('overlay').classList.remove('open');
}

function toggleStatusDetail() {
  document.getElementById('status-detail').classList.toggle('collapsed');
  document.getElementById('status-chevron').classList.toggle('collapsed');
}

let ownerAway = false;
function setAwayUI(away) {
  document.getElementById('away-btn').classList.toggle('away', away);
  document.getElementById('panel-away-overlay').style.display = away ? 'flex' : 'none';
}
function toggleAway() {
  ownerAway = !ownerAway;
  setAwayUI(ownerAway);
  fetch('/api/owner', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'away', away: ownerAway })
  });
}

function getCleanDesc(v) {
  if (v >= 80) return '乾淨，小黑影沒什麼動靜';
  if (v >= 50) return '有些灰塵，角落開始積東西';
  if (v >= 30) return '有點亂，白糰糰能找到不少寶藏';
  if (v >= 15) return '很髒，白糰糰開始癢癢，小黑影活躍';
  return '非常髒亂，白糰糰拚命蹭，禿塊風險高';
}
function getCleanColor(v) {
  if (v >= 60) return '#7ab87a';
  if (v >= 30) return '#e8b45a';
  return '#c07050';
}
function updateCleanUI() {
  const v = roomState.cleanliness;
  const bar = document.getElementById('clean-bar');
  bar.style.width = v + '%';
  bar.style.background = getCleanColor(v);
  document.getElementById('clean-desc').textContent = getCleanDesc(v);
}

function updateAllToggles() {
  const map = { light_on:'it-light', toilet_open:'it-toilet', window_open:'it-window', ac_on:'it-ac' };
  for (const [key, id] of Object.entries(map)) {
    document.getElementById(id).classList.toggle('on', !!roomState[key]);
  }
}

async function toggle(key) {
  roomState[key] = !roomState[key];
  updateAllToggles();
  await fetch('/api/room', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ [key]: roomState[key] })
  });
}

function createEditableField({ display, icons, input, editActions, emptyText, onSave }) {
  let value = '';

  function render(text) {
    value = text || '';
    display.textContent = value || emptyText;
  }

  function showDisplay() {
    display.style.display = 'block';
    icons.style.display = 'flex';
    input.style.display = 'none';
    editActions.style.display = 'none';
  }

  function showInput() {
    display.style.display = 'none';
    icons.style.display = 'none';
    input.style.display = 'block';
    editActions.style.display = 'flex';
  }

  function edit() {
    input.value = value;
    showInput();
  }

  function cancel() {
    showDisplay();
  }

  // 清空後按「記錄」即視為清除，不需另外的清除按鈕
  async function submit() {
    const v = input.value.trim();
    await onSave(v);
    render(v);
    showDisplay();
  }

  function setFromServer(text) {
    if (input.style.display === 'none' && (text || '') !== value) {
      render(text);
    }
  }

  render('');
  showDisplay();
  return { edit, cancel, submit, setFromServer };
}

const statusField = createEditableField({
  display: document.getElementById('status-display'),
  icons: document.getElementById('status-icons'),
  input: document.getElementById('owner-input'),
  editActions: document.getElementById('owner-edit-actions'),
  emptyText: '尚無狀態',
  onSave: (v) => fetch('/api/owner', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'status', input: v }) }),
});
function editStatus() { statusField.edit(); }
function cancelStatus() { statusField.cancel(); }
function submitStatus() {
  const v = document.getElementById('owner-input').value.trim();
  statusField.submit();
  document.getElementById('panel-btn').classList.toggle('has-input', v !== '');
}

const envField = createEditableField({
  display: document.getElementById('env-display'),
  icons: document.getElementById('env-icons'),
  input: document.getElementById('env-input'),
  editActions: document.getElementById('env-edit-actions'),
  emptyText: '尚無描述',
  onSave: (v) => fetch('/api/room', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ env_desc: v }) }),
});
function editEnv() { envField.edit(); }
function cancelEnv() { envField.cancel(); }
function submitEnv() { envField.submit(); }

function openCompose() {
  document.getElementById('compose-trigger').style.display = 'none';
  document.getElementById('compose-box').style.display = 'block';
  const inp = document.getElementById('room-action-input');
  inp.placeholder = randomPlaceholder();
  inp.focus();
}
function closeCompose() {
  document.getElementById('compose-box').style.display = 'none';
  document.getElementById('compose-trigger').style.display = 'flex';
  document.getElementById('room-action-input').value = '';
}

async function submitRoomAction() {
  const input = document.getElementById('room-action-input').value.trim();
  if (!input) return;
  await fetch('/api/owner', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'action', input })
  });
  closeCompose();
  document.getElementById('panel-btn').classList.add('has-input');
  load();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

let noteState = { mode: 'draft', color: 'yellow', savedId: null };

function toggleNote() {
  const open = document.getElementById('sticky-note').classList.toggle('open');
  document.getElementById('note-overlay').classList.toggle('open', open);
  document.getElementById('note-menu-dropdown').classList.remove('open');
}
function closeNote() {
  document.getElementById('sticky-note').classList.remove('open');
  document.getElementById('note-overlay').classList.remove('open');
  document.getElementById('note-menu-dropdown').classList.remove('open');
}
function toggleNoteMenu() {
  document.getElementById('note-menu-dropdown').classList.toggle('open');
}
function setNoteColor(color) {
  noteState.color = color;
  document.getElementById('sticky-note').dataset.color = color;
  document.getElementById('note-menu-dropdown').classList.remove('open');
}
function renderNoteSaved(note) {
  noteState.mode = 'saved';
  noteState.savedId = note.id;
  document.getElementById('sticky-note').dataset.color = note.color || 'yellow';
  document.getElementById('sticky-note-textarea').style.display = 'none';
  const saved = document.getElementById('sticky-note-saved');
  saved.style.display = 'block';
  saved.textContent = note.message;
  document.getElementById('note-confirm-btn').style.display = 'none';
  document.getElementById('note-delete-btn').style.display = 'inline';
  document.getElementById('note-read-mark').style.display = 'none';
  document.getElementById('note-new-btn').style.display = 'none';
}

function renderNoteRead(note) {
  noteState.mode = 'read';
  noteState.savedId = null;
  document.getElementById('sticky-note').dataset.color = note.color || 'yellow';
  document.getElementById('sticky-note-textarea').style.display = 'none';
  const saved = document.getElementById('sticky-note-saved');
  saved.style.display = 'block';
  saved.textContent = note.message;
  document.getElementById('note-confirm-btn').style.display = 'none';
  document.getElementById('note-delete-btn').style.display = 'none';
  document.getElementById('note-read-mark').style.display = 'flex';
  document.getElementById('note-new-btn').style.display = 'inline';
}

function renderNoteDraft() {
  noteState.mode = 'draft';
  noteState.savedId = null;
  document.getElementById('sticky-note-textarea').style.display = 'block';
  document.getElementById('sticky-note-saved').style.display = 'none';
  document.getElementById('note-confirm-btn').style.display = 'inline';
  document.getElementById('note-delete-btn').style.display = 'none';
  document.getElementById('note-read-mark').style.display = 'none';
  document.getElementById('note-new-btn').style.display = 'none';
}

function startNewNote() {
  localStorage.removeItem('lastReadNote');
  document.getElementById('sticky-note-textarea').value = '';
  renderNoteDraft();
}

function refreshNoteWidget(pending) {
  const latest = pending.length > 0 ? pending[pending.length - 1] : null;
  if (latest) {
    if (noteState.mode !== 'saved' || noteState.savedId !== latest.id) {
      renderNoteSaved(latest);
    }
    return;
  }
  // 沒有待讀留言
  if (noteState.mode === 'saved') {
    // 剛被 tick 讀走 → 標記為已讀，留下腳印
    const readNote = {
      message: document.getElementById('sticky-note-saved').textContent,
      color: document.getElementById('sticky-note').dataset.color,
    };
    localStorage.setItem('lastReadNote', JSON.stringify(readNote));
    renderNoteRead(readNote);
  } else if (noteState.mode === 'draft') {
    // 重新整理頁面時，把上一張被讀過的便利貼還原
    const stored = localStorage.getItem('lastReadNote');
    if (stored) {
      try { renderNoteRead(JSON.parse(stored)); } catch (e) {}
    }
  }
}

async function confirmNote() {
  const message = document.getElementById('sticky-note-textarea').value.trim();
  if (!message) return;
  const res = await fetch('/api/visitor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, color: noteState.color })
  });
  const data = await res.json();
  document.getElementById('sticky-note-textarea').value = '';
  renderNoteSaved({ id: data.id, message, color: noteState.color });
}

async function deleteNote() {
  if (!noteState.savedId) return;
  await fetch('/api/visitor/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: noteState.savedId })
  });
  renderNoteDraft();
}

function renderDiaryEntries(diary) {
  const container = document.getElementById('entries');
  if (!diary || diary.length === 0) {
    container.innerHTML = '<div class="empty">這天還沒有動靜。</div>';
    return;
  }
  container.innerHTML = diary.slice().reverse().map(e => `
    <div class="entry">
      <div class="entry-time">${escapeHtml(e.time)}</div>
      <div class="entry-text">${escapeHtml(e.scene)}</div>
      <div class="entry-stats">健康 ${e.hp} · 飽食 ${e.food} · ${escapeHtml(e.location)}${e.fur ? ` · ${escapeHtml(e.fur)}` : ''}</div>
      ${e.shadowActive ? '<div class="entry-shadow">⚠ 小黑影出沒中</div>' : ''}
    </div>
  `).join('');
}

let availableDates = [];
let currentDateKey = null;
let followLatest = true;

function updatePaginationUI() {
  const idx = availableDates.indexOf(currentDateKey);
  const total = availableDates.length;
  document.getElementById('page-label').textContent = total ? `${currentDateKey}（第 ${idx + 1} / ${total} 頁）` : '—';
  document.getElementById('prev-day-btn').disabled = idx <= 0;
  document.getElementById('next-day-btn').disabled = idx === -1 || idx >= total - 1;
}

async function loadDay(dateKey) {
  const res = await fetch('/api/day?date=' + dateKey + '&t=' + Date.now());
  const day = await res.json();
  renderDiaryEntries(day.diary);
  updatePaginationUI();
}

async function refreshDatesAndDay() {
  const res = await fetch('/api/dates?t=' + Date.now());
  const data = await res.json();
  availableDates = data.dates || [];
  if (availableDates.length === 0) {
    document.getElementById('entries').innerHTML = '<div class="empty">白糰糰還沒有動靜。<br>他可能在冰箱裡。</div>';
    updatePaginationUI();
    return;
  }
  if (followLatest || !currentDateKey || availableDates.indexOf(currentDateKey) === -1) {
    currentDateKey = availableDates[availableDates.length - 1];
  }
  await loadDay(currentDateKey);
}

function goPrevDay() {
  const idx = availableDates.indexOf(currentDateKey);
  if (idx > 0) {
    currentDateKey = availableDates[idx - 1];
    followLatest = false;
    loadDay(currentDateKey);
  }
}

function goNextDay() {
  const idx = availableDates.indexOf(currentDateKey);
  if (idx >= 0 && idx < availableDates.length - 1) {
    currentDateKey = availableDates[idx + 1];
    followLatest = currentDateKey === availableDates[availableDates.length - 1];
    loadDay(currentDateKey);
  }
}

function renderActivityFeed(pendingAction, ownerLog) {
  const container = document.getElementById('activity-feed');
  let html;
  if (pendingAction) {
    html = `<div class="feed-entry"><div class="feed-time">等待白糰糰回應...</div><div class="feed-text">${escapeHtml(pendingAction)}</div></div>`;
  } else if (ownerLog && ownerLog.length > 0) {
    const latest = ownerLog[ownerLog.length - 1];
    html = `<div class="feed-entry"><div class="feed-time">${escapeHtml(latest.time)}</div><div class="feed-text">${escapeHtml(latest.action)}</div></div>`;
  } else {
    html = '<div class="empty">還沒有動態。</div>';
  }
  if (container.dataset.rendered !== html) {
    container.dataset.rendered = html;
    container.innerHTML = html;
  }
}

async function refreshTodayPanels(world) {
  try {
    const res = await fetch('/api/day?t=' + Date.now());
    const today = await res.json();
    renderActivityFeed(world.owner_action || '', today.ownerLog || []);
    refreshNoteWidget(world.visitor_messages || []);
  } catch (e) {}
}

async function load() {
  try {
    const res = await fetch('/api/world?t=' + Date.now());
    const data = await res.json();
    const world = data.world;
    const bt = world.characters.baituantuan;

    document.getElementById('bar-hp').style.width = bt.hp + '%';
    document.getElementById('bar-food').style.width = bt.food + '%';
    document.getElementById('val-hp').textContent = bt.hp + '%';
    document.getElementById('val-food').textContent = bt.food + '%';
    document.getElementById('location').textContent = bt.location;
    const furLine = document.getElementById('fur-line');
    if (bt.fur && bt.fur !== '正常') {
      document.getElementById('fur-tag').textContent = bt.fur;
      furLine.style.display = 'flex';
    } else {
      furLine.style.display = 'none';
    }
    document.getElementById('shadow-tag').textContent = world.characters.shadow.active ? '⚠ 小黑影出沒中' : '';

    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
    document.getElementById('cover-date').textContent = (now.getMonth()+1) + ' 月 ' + now.getDate() + ' 日';

    roomState.window_open = world.room.window_open;
    roomState.ac_on = world.room.ac_on || false;
    roomState.light_on = world.room.light_on !== false;
    roomState.toilet_open = world.room.toilet_open || false;
    roomState.cleanliness = world.room.cleanliness;
    updateAllToggles();
    updateCleanUI();

    const ownerStatus = world.owner_status || '';
    statusField.setFromServer(ownerStatus);
    document.getElementById('status-time').textContent = world.owner_status_time ? '最後更新 ' + world.owner_status_time : '';

    envField.setFromServer(world.room.env_desc || '');
    document.getElementById('env-time').textContent = world.room.env_desc_time ? '最後更新 ' + world.room.env_desc_time : '';

    const ownerAction = world.owner_action || '';
    document.getElementById('panel-btn').classList.toggle('has-input', !!(ownerStatus || ownerAction));

    ownerAway = !!world.owner_away;
    setAwayUI(ownerAway);

    document.getElementById('rent-overlay').style.display = world.for_rent ? 'flex' : 'none';

    await refreshTodayPanels(world);
    await refreshDatesAndDay();

  } catch(e) {
    document.getElementById('entries').innerHTML = '<div class="empty">暫時無法連線。</div>';
  }
}

load();
setInterval(load, 3 * 60 * 1000);
