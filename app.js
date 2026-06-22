let roomState = {
  window_open: false,
  ac: { on: false, mode: 'cool', temp: 22, fan: 'auto', sleep: false, broken: false },
  light_on: true, toilet_open: false, cleanliness: 78
};

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

// 同居人面板密碼保護：密碼存在 Railway 環境變數 OWNER_PANEL_PASSWORD（沒設就不擋）。
// 驗證過一次後存在 sessionStorage，同一個瀏覽器分頁不用每次都輸入。
async function openPanel() {
  if (sessionStorage.getItem('ownerPanelAuthed') !== '1') {
    const password = prompt('請輸入同居人面板密碼：');
    if (password === null) return;
    try {
      const res = await fetch('/api/owner-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const data = await res.json();
      if (!data.ok) { alert('密碼錯誤'); return; }
      sessionStorage.setItem('ownerPanelAuthed', '1');
    } catch (e) {
      alert('驗證失敗，請再試一次。');
      return;
    }
  }
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

let worldPaused = false;
function setPauseUI(paused) {
  document.getElementById('pause-btn').classList.toggle('away', paused);
  document.getElementById('pause-overlay').style.display = paused ? 'flex' : 'none';
}
function togglePause() {
  worldPaused = !worldPaused;
  setPauseUI(worldPaused);
  fetch('/api/owner', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'pause', paused: worldPaused })
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
  const map = { light_on:'it-light', toilet_open:'it-toilet', window_open:'it-window' };
  for (const [key, id] of Object.entries(map)) {
    document.getElementById(id).classList.toggle('on', !!roomState[key]);
  }
  document.getElementById('it-ac').classList.toggle('on', !!roomState.ac.on);
  const ac = roomState.ac;
  const modePill = document.getElementById('ac-pill-mode');
  const tempPill = document.getElementById('ac-pill-temp');
  const fanPill = document.getElementById('ac-pill-fan');
  if (ac.broken) {
    modePill.textContent = '故障';
    modePill.classList.add('active');
    tempPill.style.display = 'none';
    fanPill.style.display = 'none';
  } else {
    modePill.textContent = AC_MODE_LABEL[ac.mode];
    modePill.classList.add('active');
    if (ac.mode === 'fan') {
      tempPill.style.display = 'none';
    } else {
      tempPill.style.display = '';
      tempPill.textContent = ac.temp + '℃';
    }
    fanPill.style.display = '';
    fanPill.querySelector('span').textContent = AC_FAN_LABEL[ac.fan];
  }
}

// ===== 空調遙控 =====
const AC_MODE_LABEL = { cool: '製冷', heat: '暖氣', fan: '送風', dry: '除濕' };
const AC_FAN_LABEL = { auto: '自動風', low: '弱風', mid: '中風', high: '強風' };

function openAcRemote() {
  renderAcRemote();
  document.getElementById('ac-overlay').classList.add('open');
  document.getElementById('ac-remote').classList.add('open');
}
function closeAcRemote() {
  document.getElementById('ac-overlay').classList.remove('open');
  document.getElementById('ac-remote').classList.remove('open');
}

function renderAcRemote() {
  const ac = roomState.ac;
  const remote = document.getElementById('ac-remote');
  remote.classList.toggle('power-on', !!ac.on);

  document.getElementById('ac-power').classList.toggle('on', !!ac.on);
  document.getElementById('ac-broken').style.display = (ac.on && ac.broken) ? 'block' : 'none';

  // 讀數
  document.getElementById('ac-readout-mode').textContent = ac.broken && ac.on ? '故障' : AC_MODE_LABEL[ac.mode];
  const tempEl = document.getElementById('ac-readout-temp');
  tempEl.innerHTML = ac.mode === 'fan' ? '送風' : ac.temp + '<small>℃</small>';

  // 模式
  document.querySelectorAll('.ac-mode-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === ac.mode));

  // 溫度（送風模式無溫度）
  document.getElementById('ac-temp-val').textContent = ac.temp + '℃';
  document.getElementById('ac-temp-section').classList.toggle('disabled', ac.mode === 'fan');

  // 風速
  document.querySelectorAll('.ac-fan-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.fan === ac.fan));

  // 舒眠
  document.getElementById('ac-sleep-switch').classList.toggle('on', !!ac.sleep);
}

// ===== 電視（接 Gemini，獨立小請求） =====
const TV_CHANNEL_LABEL = { nature: '生物頻道', news: '新聞頻道', shopping: '購物頻道' };
let tvLoading = false;
const TV_COOLDOWN_MS = 8000; // 轉台冷卻：免費層有每分鐘請求上限，連點容易撞到 429
let tvCooldownUntil = 0;

function openTv() {
  document.getElementById('tv-overlay').classList.add('open');
  document.getElementById('tv-remote').classList.add('open');
}
function closeTv() {
  document.getElementById('tv-overlay').classList.remove('open');
  document.getElementById('tv-remote').classList.remove('open');
}

async function playChannel(channel) {
  if (tvLoading) return;
  const screen = document.getElementById('tv-screen');
  const wait = Math.ceil((tvCooldownUntil - Date.now()) / 1000);
  if (wait > 0) {
    screen.innerHTML = `<div class="tv-screen-static">轉台太快了，再等 ${wait} 秒…</div>`;
    return;
  }
  tvLoading = true;
  document.querySelectorAll('.tv-channel-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.channel === channel));
  screen.innerHTML = `<div class="tv-screen-static">${TV_CHANNEL_LABEL[channel]}・訊號接收中…</div>`;
  try {
    const res = await fetch('/api/tv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel })
    });
    const data = await res.json();
    if (data.ok) {
      screen.innerHTML = `<div class="tv-program">${data.text.replace(/</g, '&lt;')}</div>`;
    } else {
      let msg = '訊號不穩，稍後再轉台看看…';
      if (data.error === 'no_key') msg = '訊號中斷（電視台還沒設定）';
      else if (data.error === 'http_429') msg = '電視台訊號過載，免費額度暫時用滿了，等一下再轉台…';
      const detail = data.detail ? `<div class="tv-screen-detail">${String(data.detail).replace(/</g, '&lt;')}</div>` : '';
      screen.innerHTML = `<div class="tv-screen-static">${msg}${detail}</div>`;
    }
  } catch (e) {
    screen.innerHTML = `<div class="tv-screen-static">收訊失敗，雪花一片…</div>`;
  } finally {
    tvLoading = false;
    tvCooldownUntil = Date.now() + TV_COOLDOWN_MS;
  }
}

function saveAc() {
  renderAcRemote();
  updateAllToggles();
  return fetch('/api/room', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ac: roomState.ac })
  });
}

// 重開修好的機率：房間越髒越難修；連續失敗會逐次提高（保底，不會卡死）。
let acRepairFails = 0;
function acRepairChance() {
  const c = roomState.cleanliness;
  let base = c >= 60 ? 0.7 : c >= 30 ? 0.5 : 0.3;
  return Math.min(0.95, base + acRepairFails * 0.15);
}

let acBubbleTimer = null;
function showAcRepairHint() {
  const bubble = document.getElementById('ac-repair-bubble');
  if (!bubble) return;
  bubble.classList.add('show');
  clearTimeout(acBubbleTimer);
  acBubbleTimer = setTimeout(() => bubble.classList.remove('show'), 2600);
}

async function acTogglePower() {
  const wasBroken = roomState.ac.broken;
  const turningOn = !roomState.ac.on;
  roomState.ac.on = turningOn;

  if (turningOn && wasBroken) {
    // 重新開機＝一次即時修理嘗試（不等 tick）
    if (Math.random() < acRepairChance()) {
      roomState.ac.broken = false;
      acRepairFails = 0;
    } else {
      roomState.ac.broken = true;      // 還是壞的
      acRepairFails++;
      showAcRepairHint();
      await saveAc();                   // 先把冷氣狀態寫好，再記動態，避免兩個寫入打架
      await logPendingNote('是不是該找人來修......');
      load();                            // 讓「我的動態」即時帶到這一句
      return;
    }
  }
  saveAc();
}
function acSetMode(mode) {
  if (!roomState.ac.on) return;
  roomState.ac.mode = mode;
  saveAc();
}
function acAdjustTemp(d) {
  if (!roomState.ac.on || roomState.ac.mode === 'fan') return;
  roomState.ac.temp = Math.max(16, Math.min(30, roomState.ac.temp + d));
  saveAc();
}
function acSetFan(fan) {
  if (!roomState.ac.on) return;
  roomState.ac.fan = fan;
  saveAc();
}
function acToggleSleep() {
  if (!roomState.ac.on) return;
  roomState.ac.sleep = !roomState.ac.sleep;
  saveAc();
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

function updateComposeCount() {
  const inp = document.getElementById('room-action-input');
  const el = document.getElementById('compose-count');
  if (!inp || !el) return;
  const max = inp.maxLength > 0 ? inp.maxLength : 50;
  el.textContent = `${inp.value.length}/${max}`;
  el.classList.toggle('is-full', inp.value.length >= max);
}
function openCompose() {
  document.getElementById('compose-trigger').style.display = 'none';
  document.getElementById('compose-box').style.display = 'block';
  const inp = document.getElementById('room-action-input');
  inp.placeholder = randomPlaceholder();
  inp.oninput = updateComposeCount;
  updateComposeCount();
  inp.focus();
}
function closeCompose() {
  document.getElementById('compose-box').style.display = 'none';
  document.getElementById('compose-trigger').style.display = 'flex';
  document.getElementById('room-action-input').value = '';
  updateComposeCount();
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

// 外層已用「」包住整段引言，內文若本身含「」要降一級成『』，才是正確的巢狀引號用法
function nestQuote(str) {
  return String(str || '').replace(/「/g, '『').replace(/」/g, '』');
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

// ===== 黑影紙片 =====
let currentFragmentPending = null;
const fragmentActionsDefaultHTML = document.getElementById('fragment-card-actions').innerHTML;

function openFragmentCard() {
  document.getElementById('fragment-overlay').classList.add('open');
  document.getElementById('fragment-card').classList.add('open');
}
function closeFragmentCard() {
  document.getElementById('fragment-overlay').classList.remove('open');
  document.getElementById('fragment-card').classList.remove('open');
}

function renderFragmentCard(pending) {
  document.getElementById('fragment-card-source').textContent = pending.source || '';
  document.getElementById('fragment-card-label').textContent = pending.label || '';
  document.getElementById('fragment-card-text').textContent = pending.text || '';
  document.getElementById('fragment-card-bonus').style.display = 'none';
  document.getElementById('fragment-card-bonus').textContent = '';
  document.getElementById('fragment-card-actions').innerHTML = fragmentActionsDefaultHTML;
}

function maybeShowFragmentCard(fragments) {
  const pending = fragments && fragments.pending;
  if (pending) {
    if (!currentFragmentPending || currentFragmentPending.id !== pending.id) {
      currentFragmentPending = pending;
      renderFragmentCard(pending);
      openFragmentCard();
    }
  } else if (currentFragmentPending) {
    currentFragmentPending = null;
    closeFragmentCard();
  }
}

async function resolveFragment(action) {
  if (!currentFragmentPending) return;
  document.querySelectorAll('#fragment-card-actions .fragment-btn').forEach(b => b.disabled = true);
  let data = {};
  try {
    const res = await fetch('/api/fragment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, id: currentFragmentPending.id })
    });
    data = await res.json();
  } catch (e) {}

  if (data.bonusHint) {
    document.getElementById('fragment-card-bonus').style.display = 'block';
    document.getElementById('fragment-card-bonus').textContent = data.bonusHint;
    document.getElementById('fragment-card-actions').innerHTML =
      '<button class="fragment-btn fragment-btn-keep" onclick="closeFragmentCard(); currentFragmentPending = null;">知道了</button>';
  } else {
    closeFragmentCard();
    currentFragmentPending = null;
  }
  load();
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
      ${e.eventCard ? `<div class="entry-event-card">${escapeHtml(e.eventCard)}</div>` : ''}
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

// 第 1 張永遠是我編輯的那一則（owner_action），其餘是還沒被 tick 消化的系統提示（紙片、家電提示）。
let feedIndex = 0;
let feedCards = [{ text: '', editable: true }];

function buildFeedCards(ownerAction, pendingNotes) {
  const cards = [{ text: ownerAction || '', editable: true }];
  for (const n of (pendingNotes || [])) {
    if (n && (n.text || n.quote)) cards.push({ time: n.time || '', text: n.text || '', quote: n.quote || '', editable: false });
  }
  return cards;
}

function renderFeedCard() {
  const body = document.getElementById('feed-body');
  const nav = document.getElementById('feed-nav');
  const card = feedCards[feedIndex];
  let html;
  if (!card.text && !card.quote) {
    html = '<div class="empty">還沒有動態。</div>';
  } else {
    const textHtml = card.quote
      ? `${escapeHtml(card.text)}「${escapeHtml(nestQuote(card.quote))}」`
      : escapeHtml(card.text);
    html = `<div class="feed-entry"><div class="feed-time">${escapeHtml(card.editable ? '我的動態' : (card.time || ''))}</div><div class="feed-text">${textHtml}</div></div>`;
  }
  if (body.dataset.rendered !== html) {
    body.dataset.rendered = html;
    body.innerHTML = html;
  }
  nav.style.display = feedCards.length > 1 ? 'flex' : 'none';
  document.getElementById('feed-count').textContent = `${feedIndex + 1}/${feedCards.length}`;
  document.getElementById('feed-prev').disabled = feedIndex === 0;
  document.getElementById('feed-next').disabled = feedIndex === feedCards.length - 1;
}

function feedPrev() {
  if (feedIndex > 0) { feedIndex--; renderFeedCard(); }
}
function feedNext() {
  if (feedIndex < feedCards.length - 1) { feedIndex++; renderFeedCard(); }
}

function renderActivityFeed(ownerAction, pendingNotes) {
  feedCards = buildFeedCards(ownerAction, pendingNotes);
  if (feedIndex >= feedCards.length) feedIndex = feedCards.length - 1;
  renderFeedCard();
}

async function refreshTodayPanels(world) {
  renderActivityFeed(world.owner_action || '', world.pending_notes || []);
  refreshNoteWidget(world.visitor_messages || []);
}

async function logPendingNote(text) {
  try {
    await fetch('/api/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
  } catch (e) {}
}

async function refreshWeather(fallback) {
  let w = fallback;
  try {
    const res = await fetch('/api/weather?t=' + Date.now());
    const data = await res.json();
    if (data.weather) w = data.weather;
  } catch (e) {}
  document.getElementById('cover-weather').textContent = w ? `　·　${w.desc} ${w.temp}℃ 濕度${w.humidity}%` : '';
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

    // 糰糰對巨怪的稱呼（隨熟悉度/好感度變化）：顯示在「我的動態」卡片的名字位置，取代固定寫死的「巨怪」
    document.getElementById('profile-name').textContent = bt.nickname || '巨怪';
    document.getElementById('shadow-tag').textContent = world.characters.shadow.active ? '⚠ 小黑影出沒中' : '';

    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
    document.getElementById('cover-date').textContent = (now.getMonth()+1) + ' 月 ' + now.getDate() + ' 日';
    refreshWeather(world.weather);

    roomState.window_open = world.room.window_open;
    const acData = world.room.ac || {};
    roomState.ac = {
      on: acData.on !== undefined ? !!acData.on : !!world.room.ac_on,
      mode: acData.mode || 'cool',
      temp: typeof acData.temp === 'number' ? acData.temp : 22,
      fan: acData.fan || 'auto',
      sleep: !!acData.sleep,
      broken: !!acData.broken
    };
    roomState.light_on = world.room.light_on !== false;
    roomState.toilet_open = world.room.toilet_open || false;
    roomState.cleanliness = world.room.cleanliness;
    updateAllToggles();
    if (document.getElementById('ac-remote').classList.contains('open')) renderAcRemote();
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

    worldPaused = !!world.paused;
    setPauseUI(worldPaused);

    updateDeathOverlay(world.death);
    updateFarewellOverlay(world.farewell);

    maybeShowFragmentCard(world.fragments);

    await refreshTodayPanels(world);
    await refreshDatesAndDay();

  } catch(e) {
    document.getElementById('entries').innerHTML = '<div class="empty">暫時無法連線。</div>';
  }
}

// 死亡畫面：糰糰死亡（world.death.active）時蓋上暗色覆蓋，顯示重生倒數與兩顆按鈕。
// 「等待糰糰歸來」只是把覆蓋收起來繼續看日記（本次工作階段內不再跳出）；倒數結束會自動再生。
let deathDismissed = false;
function updateDeathOverlay(death) {
  const overlay = document.getElementById('death-overlay');
  if (!overlay) return;
  if (!death || !death.active) {
    deathDismissed = false; // 已再生，重置，下次死亡再跳
    overlay.style.display = 'none';
    return;
  }
  const cd = document.getElementById('death-countdown');
  if (cd) cd.textContent = death.ticksLeft > 0 ? `小黑影的報復還會持續約 ${death.ticksLeft} 次更新，之後糰糰會自行再生。` : '糰糰即將再生…';
  overlay.style.display = deathDismissed ? 'none' : 'flex';
}
function closeDeathOverlay() {
  deathDismissed = true;
  const overlay = document.getElementById('death-overlay');
  if (overlay) overlay.style.display = 'none';
}
// 永別事件：卡片顯示後等飼主選「種下蕈菇／不種」。選完前世界暫停生成（見 world.js tick()）。
// 不種＝放棄這份紀錄並封存，世界會重新開始，所以選完後直接整頁重新載入。
function updateFarewellOverlay(farewell) {
  const pendingOverlay = document.getElementById('farewell-overlay');
  if (!pendingOverlay) return;
  pendingOverlay.style.display = (farewell && farewell.pending) ? 'flex' : 'none';
}
async function farewellChoice(plant) {
  try {
    await fetch('/api/owner', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'farewell_choice', plant })
    });
    location.reload();
  } catch (e) {
    alert('選擇送出失敗，請再試一次。');
  }
}
async function resetWorld() {
  if (!confirm('確定要放棄這段紀錄、重新開始嗎？\n目前的世界與所有每日紀錄會被「封存」（搬到 archive/，不會刪除），再從初始值重置。')) return;
  try {
    const res = await fetch('/api/reset', { method: 'POST' });
    const data = await res.json();
    if (data.ok) { deathDismissed = false; location.reload(); }
    else alert('重啟失敗：' + (data.error || '未知錯誤'));
  } catch (e) {
    alert('重啟失敗：' + e.message);
  }
}

// ===================== 側欄抽屜（觀察／回顧／筆記） =====================
function openDrawer() {
  document.getElementById('side-drawer').classList.add('open');
  document.getElementById('drawer-backdrop').classList.add('open');
  document.getElementById('menu-btn').classList.add('hidden');
}
function closeDrawer() {
  document.getElementById('side-drawer').classList.remove('open', 'with-subnav');
  document.getElementById('drawer-backdrop').classList.remove('open');
  document.getElementById('menu-btn').classList.remove('hidden');
}
function isDesktopLayout() { return window.matchMedia('(min-width: 760px)').matches; }
function renderDrawerSubnav(name) {
  const box = document.getElementById('drawer-subnav');
  if (name === 'review') {
    // 時間軸＝左側導覽列：陪伴天數小標語＋搜尋＋整條時間軸＋（頁尾）歷史上的今天
    box.innerHTML = `
      <div class="review-drawer-head">
        <div class="review-daycount" id="review-today-head"></div>
        <div class="review-search-wrap">
          <i class="ti ti-search"></i>
          <input type="text" class="review-search" id="review-search" placeholder="搜尋日期、關鍵字…" oninput="renderDateTimeline()">
        </div>
      </div>
      <div class="date-tree" id="date-tree"><div class="drawer-empty">載入中…</div></div>
      <div class="anniv-row" id="anniv-row"></div>
    `;
  } else if (name === 'notes') {
    box.innerHTML = `<button class="review-nav-item" onclick="notesIndex=0;renderNotes()"><i class="ti ti-list"></i>目錄</button>`;
  } else {
    box.innerHTML = '';
  }
}
function selectDrawerTab(name) {
  document.querySelectorAll('.rail-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.page-pane').forEach(p => p.classList.toggle('active', p.dataset.page === name));
  const drawer = document.getElementById('side-drawer');
  const backdrop = document.getElementById('drawer-backdrop');
  if (name === 'review' || (isDesktopLayout() && name === 'notes')) {
    renderDrawerSubnav(name);
    drawer.classList.add('open', 'with-subnav');
    // 桌面：左側導覽常駐、背景不壓黑；手機：暫時疊在內文之上，可點外面收起
    if (isDesktopLayout()) backdrop.classList.remove('open');
    else backdrop.classList.add('open');
    document.getElementById('menu-btn').classList.add('hidden');
  } else {
    closeDrawer();
  }
  if (name === 'review') loadReview();
  if (name === 'notes') loadNotebook();
}
window.addEventListener('resize', () => {
  const drawer = document.getElementById('side-drawer');
  if (!isDesktopLayout() && drawer.classList.contains('with-subnav')) closeDrawer();
});

// ---- 回顧：陪伴總天數 / 歷史上的今天 / 完整時間軸 / 閱讀區（雙欄常駐，不使用 Modal） ----
let daySummaries = {};
let reviewSelectedDate = null;
const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];
async function loadReview() {
  try {
    const sres = await fetch('/api/day-summaries?t=' + Date.now());
    const sdata = await sres.json();
    daySummaries = {};
    (sdata.summaries || []).forEach(s => { daySummaries[s.date] = s; });
  } catch (e) { daySummaries = {}; }
  renderTodayRecall();
  renderDateTimeline();
  // 桌面：預設翻開最新一天到中間閱讀區；手機：先停在時間軸，讓使用者自己挑
  if (isDesktopLayout() && availableDates.length && !reviewSelectedDate) {
    selectReviewDay(availableDates[availableDates.length - 1]);
  }
}

function dayRowHtml(d) {
  const [y, m, day] = d.split('-').map(Number);
  const weekday = WEEKDAY_LABELS[new Date(y, m - 1, day).getDay()];
  const cur = d === reviewSelectedDate ? ' current' : '';
  const s = daySummaries[d];
  let extra = '';
  if (s) {
    const bits = [];
    if (s.preview) bits.push(escapeHtml(s.preview));
    if (s.visitorCount) bits.push(`留言 ${s.visitorCount} 則${s.visitorPreview ? '：' + escapeHtml(s.visitorPreview) : ''}`);
    if (s.ownerCount) bits.push(`你留下了動態${s.ownerPreview ? '：' + escapeHtml(s.ownerPreview) : ''}`);
    if (bits.length) extra = `<div class="tree-day-preview">${bits.join('　·　')}</div>`;
  }
  return `<div class="tree-day${cur}" data-date="${d}" onclick="selectReviewDay('${d}')">
    <div class="tree-day-dot"></div>
    <div class="tree-day-body">
      <div class="tree-day-row"><span class="tree-day-date">${day} 日</span><span class="tree-day-weekday">週${weekday}</span></div>
      ${extra}
    </div>
  </div>`;
}

// 頂部標語（陪伴關係總天數）＋「歷史上的今天」（同月日的過去紀錄，放在頁面下方，是額外發現而非主導航）
function renderTodayRecall() {
  const headBox = document.getElementById('review-today-head');
  const annivBox = document.getElementById('anniv-row');
  if (!headBox || !availableDates.length) return;
  const latest = availableDates[availableDates.length - 1];
  const [ly, lm, ld] = latest.split('-').map(Number);
  headBox.innerHTML = `一起生活第 <b>${availableDates.length}</b> 天`;

  const mmdd = latest.slice(5);
  const matches = availableDates
    .filter(d => d !== latest && d.slice(5) === mmdd)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, 3);
  if (matches.length === 0) {
    annivBox.innerHTML = '';
  } else {
    annivBox.innerHTML = `<div class="review-recent-label">歷史上的今天</div><div class="anniv-cards">${matches.map(d => {
      const yearsAgo = ly - Number(d.slice(0, 4));
      const s = daySummaries[d];
      const preview = s && s.preview ? escapeHtml(s.preview) : '這天沒有留下太多紀錄。';
      return `<div class="anniv-card" onclick="selectReviewDay('${d}')">
        <span class="anniv-card-label">${yearsAgo} 年前的今天</span><span class="anniv-card-date">${d}</span>
        <div class="anniv-card-preview">${preview}</div>
      </div>`;
    }).join('')}</div>`;
  }
}

// 時間軸：連續滾動列表，依年/月分組，由新到舊，不需展開/收合。
// 支援搜尋過濾。
function renderDateTimeline() {
  const box = document.getElementById('date-tree');
  if (!box) return;
  if (availableDates.length === 0) { box.innerHTML = '<div class="drawer-empty">還沒有任何紀錄。</div>'; return; }
  const searchEl = document.getElementById('review-search');
  const q = (searchEl ? searchEl.value || '' : '').trim();
  const dates = availableDates.filter(d => !q || d.includes(q)).slice().reverse();
  if (dates.length === 0) { box.innerHTML = '<div class="drawer-empty">找不到符合的日期。</div>'; return; }
  // 依年/月分組，每組可收合，避免累積越多天越難翻閱；搜尋時直接展開全部分組。
  const groups = [];
  let cur = null;
  dates.forEach(d => {
    const [y, m] = d.split('-');
    const groupKey = `${y}-${m}`;
    if (!cur || cur.key !== groupKey) {
      cur = { key: groupKey, y, m: Number(m), dates: [] };
      groups.push(cur);
    }
    cur.dates.push(d);
  });
  const searching = !!q;
  box.innerHTML = groups.map((g, i) => {
    const open = searching || i === 0;
    return `<div class="timeline-month-group${open ? ' open' : ''}">
      <div class="timeline-month-header" onclick="this.closest('.timeline-month-group').classList.toggle('open')">
        <span>${g.y} 年 ${g.m} 月</span><i class="ti ti-chevron-down timeline-month-caret"></i>
      </div>
      <div class="timeline-month-days">${g.dates.map(dayRowHtml).join('')}</div>
    </div>`;
  }).join('');
}

// 選某一天：直接在閱讀區換內容，不開 Modal、不離開頁面。
// 手機上會把版面切到「單頁閱讀模式」，並顯示「← 返回」。
async function selectReviewDay(d, opts) {
  opts = opts || {};
  reviewSelectedDate = d;
  // 標記時間軸目前選中的日期
  document.querySelectorAll('#date-tree .tree-day').forEach(el => {
    const isCurrent = el.dataset.date === d;
    el.classList.toggle('current', isCurrent);
    if (isCurrent) {
      const group = el.closest('.timeline-month-group');
      if (group) group.classList.add('open');
    }
  });
  // 手機：選完日期把時間軸收起，露出中間的完整內文
  if (!isDesktopLayout()) closeDrawer();
  const body = document.getElementById('review-reading-body');
  body.innerHTML = '<div class="drawer-empty">載入中…</div>';
  try {
    const res = await fetch('/api/day?date=' + d + '&t=' + Date.now());
    const day = await res.json();
    const ownerLog = day.ownerLog || [];
    const visitorLog = day.visitorLog || [];
    const diary = day.diary || [];
    const [y, m, day2] = d.split('-').map(Number);
    const entriesHtml = diary.map(e => reviewEntryHtml(e, ownerLog, visitorLog)).join('');
    body.innerHTML = `
      <div class="memory-date">${y} 年 ${m} 月 ${day2} 日</div>
      ${entriesHtml || '<div class="drawer-empty">這天沒有留下太多紀錄。</div>'}
      <button class="memory-goto-btn" onclick="jumpToDay('${d}')">前往這天的完整日記 ›</button>
    `;
  } catch (e) {
    body.innerHTML = '<div class="drawer-empty">載入失敗。</div>';
  }
}
// 一段觀察：時間是紀錄的一部分（不框）；時間後的 +／- 展開狀態卡。
// 展開後：時間那行接客觀環境（天氣・氣溫・濕度），下面兩個淡框＝房間／我，再一框＝糰糰。
// 糰糰狀態用的小圖示：毛球本體＋一圈絨毛點點，不畫眼睛（這裡只是狀態列的小標，不是角色本體）。
const FUZZBALL_ICON = `<svg class="fuzzball-icon" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
  <circle cx="12" cy="12" r="6.4" fill="currentColor"/>
  <circle cx="12" cy="3.4" r="1.5" fill="currentColor"/>
  <circle cx="19.2" cy="7.2" r="1.5" fill="currentColor"/>
  <circle cx="19.2" cy="16.8" r="1.5" fill="currentColor"/>
  <circle cx="12" cy="20.6" r="1.5" fill="currentColor"/>
  <circle cx="4.8" cy="16.8" r="1.5" fill="currentColor"/>
  <circle cx="4.8" cy="7.2" r="1.5" fill="currentColor"/>
</svg>`;

function reviewEntryHtml(e, ownerLog, visitorLog) {
  const time = e.time || '';
  const hm = time.includes(' ') ? time.split(' ').pop() : time; // 取 24h HH:MM
  const owner = ownerLog.find(o => o.time === time);
  const visitors = visitorLog.filter(v => v.time === time);

  // 客觀環境（天氣・氣溫・濕度），接在時間那一行
  const w = e.weather;
  let envHtml = '';
  if (w) {
    const bits = [];
    if (w.desc) bits.push(`<span class="entry-env-item">${escapeHtml(w.desc)}</span>`);
    if (typeof w.temp === 'number') bits.push(`<span class="entry-env-item"><i class="ti ti-temperature"></i>${w.temp}℃</span>`);
    if (typeof w.humidity === 'number') bits.push(`<span class="entry-env-item"><i class="ti ti-droplet"></i>${w.humidity}%</span>`);
    envHtml = bits.join('');
  }

  // 房間（居家狀況）＋我（狀態/動態）── 我能改的那些，一框，房間在上、我在下
  const roomTxt = e.room ? escapeHtml(e.room) : '';
  const ownerBits = [];
  if (owner && owner.status) ownerBits.push(escapeHtml(owner.status));
  if (owner && owner.action) ownerBits.push(escapeHtml(owner.action));
  const myTxt = ownerBits.join(' · ');
  let mineBox = '';
  if (roomTxt || myTxt) {
    mineBox = `<div class="detail-box">
      ${roomTxt ? `<div class="detail-line"><i class="ti ti-home"></i><span>${roomTxt}</span></div>` : ''}
      ${myTxt ? `<div class="detail-line"><i class="ti ti-user-circle"></i><span>${myTxt}</span></div>` : ''}
    </div>`;
  }

  // 糰糰狀態：上排數值(飽食・健康・位置)，下排狀況(毛況等文字描述)
  const tStatBits = [];
  if (typeof e.food === 'number') tStatBits.push(`飽食 ${e.food}`);
  if (typeof e.hp === 'number') tStatBits.push(`健康 ${e.hp}`);
  if (e.location) tStatBits.push(escapeHtml(e.location));
  const tuanBox = (tStatBits.length || e.fur)
    ? `<div class="detail-box">
      ${tStatBits.length ? `<div class="detail-line">${FUZZBALL_ICON}<span>${tStatBits.join(' · ')}</span></div>` : ''}
      ${e.fur ? `<div class="detail-line"><i class="ti ti-sparkles"></i><span>${escapeHtml(e.fur)}</span></div>` : ''}
    </div>`
    : '';

  const visitorHtml = visitors.length
    ? `<div class="detail-box">${visitors.map(v => `<div class="detail-line"><i class="ti ti-message-circle"></i><span><b>${escapeHtml(v.name || '訪客')}</b>：${escapeHtml(v.message || '')}</span></div>`).join('')}</div>`
    : '';

  const hasDetail = mineBox || tuanBox || visitorHtml || envHtml;

  const tog = `onclick="this.closest('.review-entry').classList.toggle('open')"`;
  return `<div class="review-entry">
    <div class="entry-time">${hm}${hasDetail ? `<span class="entry-toggle plus" ${tog}>+</span>` : ''}<span class="entry-env">${envHtml}</span>${hasDetail ? `<span class="entry-toggle minus" ${tog}>−</span>` : ''}</div>
    <div class="entry-detail">${mineBox}${tuanBox}${visitorHtml}</div>
    <div class="entry-scene">${escapeHtml(e.scene || '')}</div>
  </div>`;
}
function jumpToDay(d) {
  const idx = availableDates.indexOf(d);
  if (idx === -1) return;
  currentDateKey = d;
  followLatest = (idx === availableDates.length - 1);
  loadDay(d);
  selectDrawerTab('observe');
}

// ---- 筆記：黑影筆記圖鑑本（仿實體書：目錄頁→篇名頁→內文頁，每頁固定 1~3 段內容） ----
// 頁面模型：[{type:'toc'}, {type:'cover', chapter}, {type:'content', chapter, items:[...]}, ...]
let notesPages = [];
let notesIndex = 0;
const NOTES_ITEMS_PER_PAGE = 3;
function isDesktopBook() { return window.matchMedia('(min-width: 760px)').matches; }

// 新收集到的碎片第一次被看到時要顯眼一點：用 localStorage 記住「看過」的碎片 id。
function getSeenFragments() {
  try { return new Set(JSON.parse(localStorage.getItem('pp_seen_fragments') || '[]')); }
  catch (e) { return new Set(); }
}
function markFragmentsSeen(ids) {
  if (!ids.length) return;
  const seen = getSeenFragments();
  ids.forEach(id => seen.add(id));
  localStorage.setItem('pp_seen_fragments', JSON.stringify([...seen]));
}
async function loadNotebook() {
  try {
    const res = await fetch('/api/fragments?t=' + Date.now());
    const data = await res.json();
    const unlockedChapters = data.chapters.filter(c => c.unlocked).length;
    notesPages = [{ type: 'toc', chapters: data.chapters, totalGot: data.totalGot, totalAll: data.totalAll, unlockedChapters, totalChapters: data.chapters.length }];
    data.chapters.filter(c => c.unlocked).forEach(c => {
      notesPages.push({ type: 'cover', chapter: c });
      // 用固定位置排版：未收集的碎片保留原本的格位（用污漬呈現），日後收集到才會在「同一個位置」現出內容。
      for (let i = 0; i < c.items.length; i += NOTES_ITEMS_PER_PAGE) {
        notesPages.push({ type: 'content', chapter: c, items: c.items.slice(i, i + NOTES_ITEMS_PER_PAGE) });
      }
    });
    if (notesIndex >= notesPages.length) notesIndex = 0;
    renderNotes();
  } catch (e) {
    document.getElementById('notes-book').innerHTML = '<div class="drawer-empty">筆記載入失敗。</div>';
  }
}
function flipNotes(dir) {
  if (notesIndex === 0) {
    if (dir > 0) notesIndex = 1;
  } else if (isDesktopBook()) {
    notesIndex = notesIndex + dir * 2;
  } else {
    notesIndex = notesIndex + dir;
  }
  notesIndex = Math.max(0, Math.min(notesIndex, notesPages.length - 1));
  renderNotes();
}
function openChapterPage(source) {
  const i = notesPages.findIndex(p => p.type === 'cover' && p.chapter.source === source);
  if (i !== -1) { notesIndex = i; renderNotes(); }
}
function pageInnerHtml(page) {
  if (page.type === 'toc') {
    const items = page.chapters.map(c => {
      if (!c.unlocked) return `<div class="toc-item locked"><span>？？？　未發現的篇章</span><span class="toc-count">0/${c.total}</span></div>`;
      return `<div class="toc-item" onclick="openChapterPage('${c.source.replace(/'/g, "\\'")}')"><span>${escapeHtml(c.source)}</span><span class="toc-count">${c.got}/${c.total}</span></div>`;
    }).join('');
    return { running: '', body: `<div class="book-toc-title">黑影筆記・目錄</div>
      <div class="book-progress">已收集 ${page.totalGot} / ${page.totalAll} 張碎片　・　已揭開的篇章 ${page.unlockedChapters} / ${page.totalChapters}</div>
      ${items}` };
  }
  if (page.type === 'cover') {
    const c = page.chapter;
    return { running: c.source, body: `<div class="book-cover-page">
      <div class="book-cover-title">${escapeHtml(c.source)}</div>
      <div class="book-progress">${c.got} / ${c.total}</div>
    </div>` };
  }
  const c = page.chapter;
  const seen = getSeenFragments();
  let lastLabel = null;
  const slots = page.items.map(it => {
    const showLabel = it.label && it.label !== lastLabel;
    lastLabel = it.label || lastLabel;
    const labelHtml = showLabel ? `<div class="frag-slot-label">${escapeHtml(it.label)}</div>` : '';
    if (!it.collected) {
      return `<div class="frag-slot locked">${labelHtml}<div class="frag-smudge"></div></div>`;
    }
    const isNew = !seen.has(it.id);
    return `<div class="frag-slot${isNew ? ' frag-slot-new' : ''}" data-frag-id="${it.id}">${labelHtml}${escapeHtml(it.text)}</div>`;
  }).join('');
  return { running: c.source, body: slots };
}
function renderSinglePage(page, pageNum) {
  const { running, body } = pageInnerHtml(page);
  const numSide = pageNum != null ? (pageNum % 2 === 1 ? 'left' : 'right') : '';
  return `<div class="book-page">
    ${running ? `<div class="book-running-title ${numSide}">${escapeHtml(running)}</div>` : ''}
    <div class="book-page-body">${body}</div>
    ${pageNum != null ? `<div class="book-page-num ${numSide}">${pageNum}</div>` : ''}
    <div class="book-tap-zone left" onclick="flipNotes(-1)"></div>
    <div class="book-tap-zone right" onclick="flipNotes(1)"></div>
  </div>`;
}
function renderNotes() {
  const box = document.getElementById('notes-book');
  if (notesPages.length === 0) { box.innerHTML = '<div class="drawer-empty">還沒有任何碎片。<br>多陪陪白糰糰，黑影會留下些什麼。</div>'; return; }
  const desktop = isDesktopBook();
  let html;
  if (notesIndex === 0 || !desktop) {
    html = `<div class="book-spread single">${renderSinglePage(notesPages[notesIndex], notesIndex === 0 ? null : notesIndex)}</div>`;
  } else {
    const left = notesIndex % 2 === 1 ? notesIndex : notesIndex - 1;
    const right = left + 1;
    const rightPage = notesPages[right];
    html = `<div class="book-spread">
      ${renderSinglePage(notesPages[left], left)}
      ${rightPage ? renderSinglePage(rightPage, right) : '<div class="book-page blank"></div>'}
    </div>`;
    notesIndex = left;
  }
  if (notesIndex !== 0) {
    html += `<button class="book-toc-btn" onclick="notesIndex=0;renderNotes()" title="回到目錄"><i class="ti ti-list"></i></button>`;
  }
  box.innerHTML = html;
  attachSwipe(box);
  // 「新發現」的光暈先讓玩家看一眼，過一會兒才標記成已看過，下次再開就不會再亮了。
  const newIds = [...box.querySelectorAll('.frag-slot-new')].map(el => el.dataset.fragId);
  if (newIds.length) setTimeout(() => markFragmentsSeen(newIds), 1800);
}
function attachSwipe(box) {
  let startX = null;
  box.ontouchstart = e => { startX = e.touches[0].clientX; };
  box.ontouchend = e => {
    if (startX == null) return;
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 40) flipNotes(dx < 0 ? 1 : -1);
    startX = null;
  };
}
window.addEventListener('resize', () => { if (notesPages.length) renderNotes(); });

load();
setInterval(load, 3 * 60 * 1000);
