const http = require('http');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { FRAGMENTS, COLLECTION_HINTS, matchFragments } = require('./fragments');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
const WORLD_FILE = path.join(DATA_DIR, 'world.json');
const SEED_WORLD_FILE = path.join(__dirname, 'world.json');
const LEGACY_LOG_FILE = path.join(__dirname, 'log.txt');
const LOGS_DIR = path.join(DATA_DIR, 'logs');
const MIGRATION_MARKER = path.join(LOGS_DIR, '.migrated');

// Volume 剛掛載時是空的，用 repo 內建的 world.json 當初始值種一份過去。
function ensureWorldFile() {
  if (!fs.existsSync(WORLD_FILE)) {
    fs.mkdirSync(path.dirname(WORLD_FILE), { recursive: true });
    fs.copyFileSync(SEED_WORLD_FILE, WORLD_FILE);
  }
}

// 性格、感知、健康/飽食分級等大段文字可在 /prompt-lab 編輯並自動上傳覆蓋
// data/system-prompt.json，這裡只負責組裝固定的開場白與結構化輸出格式。
const SYSTEM_PROMPT_FILE = path.join(__dirname, 'data', 'system-prompt.json');
function buildSystemPrompt() {
  let s;
  try {
    s = JSON.parse(fs.readFileSync(SYSTEM_PROMPT_FILE, 'utf8'));
  } catch (err) {
    s = {};
  }
  const section = (key) => s[key] || '';
  return `你是白糰糰宇宙的世界引擎。根據當前世界狀態，生成這段時間內發生的事。

白糰糰是誰：
${section('identity')}

生命週期：
${section('lifecycle')}

尺寸與認知：
${section('sizeCognition')}

性格與信念：
${section('personality')}

社交與情感：
${section('social')}

身體與感知（重要，別寫錯）：
${section('body')}

毛況系統：
${section('furSystem')}

依當前狀態調整行為（這是描述性的語氣參考，不是精確數值規則，順著這條線寫，不要卡在某個門檻上）：
${section('statBands')}

小黑影：
${section('shadow')}

訪客留言：
${section('visitors')}

生活習性：
${section('habits')}

規則：
${section('rules')}

輸出格式，只輸出這個JSON，不要其他文字與markdown：
{
  "scene": "這段時間發生的事，2-4句，漫畫分鏡風格，句與句之間換行",
  "baituantuan": {
    "location": "地點",
    "fur": "正常，或簡短描述（4-8字內，例如：微髒、右耳禿一塊、毛打結）"
  },
  "shadow": {
    "active": true或false,
    "location": "地點",
    "dust_count": 數字
  },
  "room": {
    "cleanliness": 數字,
    "window_open": true或false,
    "light_on": true,
    "toilet_open": false,
    "events_today": ["事件"]
  }
}`;
}
const SYSTEM_PROMPT = buildSystemPrompt();

// 特殊事件旁白文案，可在 /content-lab 編輯並自動上傳覆蓋 data/events.json。
const EVENT_PROMPTS_BUILTIN = {
  ascension: `特殊事件・飛升篇（健康與飽食同時滿值，這次更新請完整呈現此事件，不要寫成日常動態）：
白糰糰進入「渡劫」狀態：全身絨毛微顫，靜坐窗邊仰望天空，雷雲湧動。
隨機二選一決定結局並寫入scene：
A. 度劫失敗（電糰糰）：遭雷擊，絨毛焦捲變黑，靜電纏身，動作僵硬，沉默放電躲回角落。
B. 度劫成功（法喜糰糰）：升空發光後「啪」一聲落地，異常開心，於地板施展誇張街舞動作。`,
  shadowRevenge: `特殊事件・冥影與霜解篇（健康與飽食同時歸零，這次更新請完整呈現此事件，不要寫成日常動態）：
白糰糰無聲崩解，只留下毛毛與冰屑，小黑影自陰影浮現，與殘骸融合成「冰晶暗影」，展開一場正義與荒誕共行的審判：室內異常降溫結霜、巨型Mr.DUST夜行騷擾、如影隨形的精神干擾。
終局：小黑影在無人處吐出白糰糰遺骸，俠魂等待再生。
shadow.active設為true，shadow.dust_count明顯增加。`,
  observation: `特殊事件・觀察篇（玩家輸入觸發旁白模式）：
本次scene改用DISCOVERY紀錄片風格書寫：科學旁觀的趣味、俏皮詼諧的科普語氣，把白糰糰的行為包裝成「野生觀察紀錄」（例如：「在零下八度的清晨，一隻野生白糰糰⋯⋯」），但內容仍要符合他平時的行為邏輯。`
};
function loadEventPrompts() {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'events.json'), 'utf8'));
    return { ...EVENT_PROMPTS_BUILTIN, ...data };
  } catch (err) {
    return EVENT_PROMPTS_BUILTIN;
  }
}
const EVENT_PROMPTS = loadEventPrompts();

function detectTriggeredEvent(bt, combinedPlayerText) {
  if (bt.hp >= 100 && bt.food >= 100) return 'ascension';
  if (bt.hp <= 0 && bt.food <= 0) return 'shadowRevenge';
  if (/📺|觀察日誌|研究|旁白啟動/.test(combinedPlayerText)) return 'observation';
  return null;
}

// 冷氣狀態正規化：舊資料只有 ac_on 布林，補成完整物件。
function normalizeAc(room) {
  const a = (room && room.ac) || {};
  return {
    on: a.on !== undefined ? !!a.on : !!(room && room.ac_on),
    mode: a.mode || 'cool',        // cool 冷氣 / heat 暖氣 / fan 送風 / dry 除濕
    temp: typeof a.temp === 'number' ? a.temp : 22,
    fan: a.fan || 'auto',          // auto / low / mid / high
    sleep: !!a.sleep,
    broken: !!a.broken
  };
}

// 把冷氣模式/溫度/風速 + 戶外天氣 蒸餾成「室內體感」一行，只有這行進 AI。
function distillClimate(room, weather) {
  const ac = normalizeAc(room);
  const outTemp = weather && typeof weather.temp === 'number' ? weather.temp : 24;
  const outHum = weather && typeof weather.humidity === 'number' ? weather.humidity : 60;
  let felt = outTemp, hum = outHum, windy = false, note = '';

  if (ac.on && ac.broken) {
    felt = outTemp + 5;
    hum = Math.min(95, outHum + 10);
    note = '冷氣故障，吹出與設定相反的悶熱怪風';
  } else if (ac.on) {
    if (ac.mode === 'cool') { felt = ac.temp; hum = Math.max(30, outHum - 15); note = `冷氣冷房設定${ac.temp}℃`; }
    else if (ac.mode === 'heat') { felt = ac.temp; hum = Math.max(25, outHum - 20); note = `暖氣設定${ac.temp}℃`; }
    else if (ac.mode === 'dry') { felt = outTemp - 2; hum = Math.max(18, outHum - 45); note = '除濕中、空氣偏乾'; }
    else if (ac.mode === 'fan') { felt = outTemp; hum = outHum; windy = true; note = '送風、只吹風不調溫'; }
    if (ac.fan === 'high') windy = true;
    if (ac.sleep) note += '・舒眠柔風';
  } else if (room.window_open) {
    felt = outTemp; note = '窗開、接近戶外';
  } else {
    felt = outTemp + 2; hum = Math.min(95, outHum + 5); note = '門窗緊閉、略悶';
  }

  const tempWord = felt <= 18 ? '涼爽' : felt <= 26 ? '適中' : '偏熱';
  const humWord = hum <= 40 ? '乾燥' : hum <= 70 ? '濕度適中' : '潮濕';
  return `室內體感：${tempWord}約${Math.round(felt)}℃、${humWord}${windy ? '、有風流動' : ''}（${note}）。`
    + `白糰糰適溫0~20℃：太熱絨毛蒸發變裸糰糰並躲藏、情緒過載變紅糰糰，涼爽則絨毛蓬鬆變涼糰糰；潮濕毛軟塌、乾燥易靜電炸毛。`;
}

function getRandomMinutes(min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

function getNextDelay() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  const hour = now.getHours();
  const isNight = hour >= 22 || hour < 6;
  const bal = loadBalance();
  if (isNight) {
    return getRandomMinutes(bal.tickNightMinMin, bal.tickNightMaxMin) * 60 * 1000;
  } else {
    return getRandomMinutes(bal.tickDayMinMin, bal.tickDayMaxMin) * 60 * 1000;
  }
}

function getRealTime() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  const month = now.getMonth() + 1;
  const date = now.getDate();
  const hour = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  return { display: `${month}/${date} ${hour}:${min}`, hour: now.getHours() };
}

function getTaipeiNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
}

// WMO weather code -> 中文氣候
function weatherDesc(code) {
  if (code === 0) return '晴';
  if (code <= 3) return '多雲';
  if (code <= 48) return '霧';
  if (code <= 57) return '毛毛雨';
  if (code <= 67) return '雨';
  if (code <= 77) return '雪';
  if (code <= 82) return '陣雨';
  if (code <= 86) return '陣雪';
  if (code <= 99) return '雷雨';
  return '—';
}

// 抓台北即時天氣（Open-Meteo，免金鑰）。失敗回 null，不影響 tick。
async function fetchWeather() {
  try {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=25.033&longitude=121.565&current=temperature_2m,relative_humidity_2m,weather_code&timezone=Asia%2FTaipei';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    const c = data.current;
    return {
      temp: Math.round(c.temperature_2m),
      humidity: Math.round(c.relative_humidity_2m),
      desc: weatherDesc(c.weather_code),
      time: getRealTime().display,
    };
  } catch (e) {
    return null;
  }
}

function dateKeyOf(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getTodayKey() {
  return dateKeyOf(getTaipeiNow());
}

// "display" 是沒有年份的 "M/D HH:MM" 字串，靠跟現在時間比較推回年份
function inferDateKey(display, refNow) {
  const m = display && display.match(/^(\d+)\/(\d+)/);
  if (!m) return null;
  const month = parseInt(m[1], 10);
  const day = parseInt(m[2], 10);
  let year = refNow.getFullYear();
  const candidate = new Date(year, month - 1, day);
  if (candidate.getTime() - refNow.getTime() > 24 * 60 * 60 * 1000) year -= 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function ensureLogsDir() {
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function dayFilePath(dateKey) {
  return path.join(LOGS_DIR, `${dateKey}.json`);
}

function emptyDay(dateKey) {
  return { date: dateKey, diary: [], ownerLog: [], visitorLog: [], fragmentLog: [] };
}

// world.json 裡的 fragments 欄位可能是舊資料（不存在）或半成形，補齊成完整結構。
const FRAGMENT_COOLDOWN_TICKS = 2; // 紙片掉落後，至少要再過這麼多次世界回應才可能再掉

// ===================== 隱藏數值對照表（暱稱／質地／心情色彩，來自 tools/trait-lab.html 匯出） =====================
const HIDDEN_STATS_FILE = path.join(__dirname, 'data', 'hidden-stats.json');
let hiddenStatsCache = null;

function loadHiddenStats() {
  if (hiddenStatsCache) return hiddenStatsCache;
  try {
    hiddenStatsCache = JSON.parse(fs.readFileSync(HIDDEN_STATS_FILE, 'utf8'));
  } catch (err) {
    hiddenStatsCache = { fam: { min: 0, max: 100, bands: 7 }, aff: { min: -100, max: 100, bands: 7 }, unit: { min: 0, max: 100, bands: 7 }, nicknameGrid: [], textureGrid: [], moodBands: [] };
  }
  return hiddenStatsCache;
}

function bandIndex(value, axis) {
  const { min, max, bands } = axis;
  const edges = [];
  for (let i = 0; i <= bands; i++) edges.push(min + i * (max - min) / bands);
  for (let i = 0; i < bands; i++) {
    if (value <= edges[i + 1] || i === bands - 1) return i;
  }
  return bands - 1;
}

function getNicknameFor(familiarity, affection) {
  const stats = loadHiddenStats();
  const grid = stats.nicknameGrid;
  if (!grid || !grid.length) return null;
  const i = bandIndex(familiarity, stats.fam);
  const j = bandIndex(affection, stats.aff);
  return (grid[i] && grid[i][j]) || null;
}

function getTextureFor(shape, hardness) {
  const stats = loadHiddenStats();
  const grid = stats.textureGrid;
  if (!grid || !grid.length) return null;
  const i = bandIndex(shape, stats.unit);
  const j = bandIndex(hardness, stats.unit);
  return (grid[i] && grid[i][j]) || null;
}

function getMoodColorFor(moodValue) {
  const stats = loadHiddenStats();
  const bands = stats.moodBands || [];
  const band = bands.find(b => moodValue >= b.min && moodValue <= b.max);
  return band || null;
}

function clampStat(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// 依本回合訊號自動推進五個隱藏數值（熟悉度／好感度／形狀／硬度／心情），純程式碼、不經 AI。
// signals: { interacted, away, hasVisitor, food, hp }
function computeHiddenStats(bt, signals, bal) {
  const cur = {
    familiarity: typeof bt.familiarity === 'number' ? bt.familiarity : 0,
    affection: typeof bt.affection === 'number' ? bt.affection : 0,
    shape: typeof bt.shape === 'number' ? bt.shape : 50,
    hardness: typeof bt.hardness === 'number' ? bt.hardness : 50,
    mood: typeof bt.mood === 'number' ? bt.mood : 0
  };
  const wellCared = signals.food > bal.highFoodThreshold && signals.hp > 60;
  const crisis = signals.food < bal.lowFoodThreshold || signals.hp < 25;

  // 熟悉度：在場累積、互動加成，預設外出不倒退（單調成長）
  let familiarity = cur.familiarity;
  if (!signals.away) familiarity += bal.familiarityPresent;
  if (signals.interacted) familiarity += bal.familiarityInteract;
  if (signals.away) familiarity += bal.familiarityAwayDecay;
  familiarity = clampStat(familiarity, 0, 100);

  // 好感度：互動／被好好照顧會升，外出冷落／受苦會降
  let affection = cur.affection;
  if (signals.interacted) affection += bal.affectionInteract;
  if (wellCared) affection += bal.affectionWellCared;
  if (signals.away) affection += bal.affectionAway;
  if (crisis) affection += bal.affectionNeglect;
  affection = clampStat(affection, -100, 100);

  // 心情：短期情緒，每回合先朝中性回歸，再疊加本回合事件
  let mood = cur.mood * (1 - bal.moodDecay);
  if (signals.interacted) mood += bal.moodInteract;
  if (wellCared) mood += bal.moodWellCared;
  if (crisis) mood += bal.moodCrisis;
  if (signals.away) mood += bal.moodAway;
  if (signals.hasVisitor) mood += bal.moodVisitor;
  mood = clampStat(Math.round(mood), -100, 100);

  // 質地（觸感印象）：朝由好感／熟悉推出的長期目標緩慢靠近
  const targetShape = clampStat(50 + affection * 0.4, 0, 100);
  const targetHardness = clampStat(50 + affection * 0.3 + (familiarity - 50) * 0.2, 0, 100);
  const shape = clampStat(cur.shape + (targetShape - cur.shape) * bal.textureEase, 0, 100);
  const hardness = clampStat(cur.hardness + (targetHardness - cur.hardness) * bal.textureEase, 0, 100);

  return {
    familiarity: Math.round(familiarity),
    affection: Math.round(affection),
    shape: Math.round(shape),
    hardness: Math.round(hardness),
    mood
  };
}

function ensureFragmentsState(world) {
  if (!world.fragments) world.fragments = { collected: [], pending: null, hintsShown: [] };
  if (!Array.isArray(world.fragments.collected)) world.fragments.collected = [];
  if (world.fragments.pending === undefined) world.fragments.pending = null;
  if (!Array.isArray(world.fragments.hintsShown)) world.fragments.hintsShown = [];
  if (typeof world.fragments.cooldown !== 'number') world.fragments.cooldown = 0;
  return world.fragments;
}

const PENDING_NOTE_CAP = 6;
// 未消化完的系統項目（紙片丟棄/收起、冷氣報修提示）暫存這裡，是「我的動態」第 1 張卡之後的卡片。
// 下次 tick 產生「糰糰觀察紀錄」時，這些會被折進那一則日記、然後清空（＝消化）。
// owner_action 不進這裡：它是第 1 張「我的動態」卡，消化後寫進 ownerLog 與場景本身。
// 連續重複同一句（例如連按重開冷氣）只留一筆，避免洗版。
function pushPendingNote(world, payload, time) {
  const note = typeof payload === 'string' ? { text: payload } : (payload || {});
  if (!note.text && !note.quote) return;
  if (!Array.isArray(world.pending_notes)) world.pending_notes = [];
  const last = world.pending_notes[world.pending_notes.length - 1];
  if (last && last.text === (note.text || '') && last.quote === (note.quote || '')) return;
  world.pending_notes.push({ time: time || getRealTime().display, text: note.text || '', quote: note.quote || '' });
  if (world.pending_notes.length > PENDING_NOTE_CAP) {
    world.pending_notes = world.pending_notes.slice(-PENDING_NOTE_CAP);
  }
}

function readDay(dateKey) {
  const p = dayFilePath(dateKey);
  if (!fs.existsSync(p)) return emptyDay(dateKey);
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return emptyDay(dateKey);
  }
}

function writeDay(dateKey, data) {
  ensureLogsDir();
  fs.writeFileSync(dayFilePath(dateKey), JSON.stringify(data, null, 2));
}

function appendToDay(dateKey, section, entries) {
  const day = readDay(dateKey);
  day[section] = [...(day[section] || []), ...entries];
  writeDay(dateKey, day);
}

function listDateKeys() {
  ensureLogsDir();
  return fs.readdirSync(LOGS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''))
    .sort();
}

// 把舊的 log.txt（單一檔案）跟 world.json 裡的 owner_log/visitor_log 轉成每日一檔的格式。
// 只會新增檔案，絕不刪除或覆寫原始資料，且用 .migrated 標記避免重複轉檔。
function migrateLegacyLogs() {
  ensureLogsDir();
  if (fs.existsSync(MIGRATION_MARKER)) return;

  const now = getTaipeiNow();
  const buckets = {};
  const bucket = dateKey => (buckets[dateKey] = buckets[dateKey] || emptyDay(dateKey));

  if (fs.existsSync(LEGACY_LOG_FILE)) {
    const logContent = fs.readFileSync(LEGACY_LOG_FILE, 'utf8');
    const blocks = logContent.split('─'.repeat(40)).map(b => b.trim()).filter(Boolean);
    for (const block of blocks) {
      const timeMatch = block.match(/【(.+?)】/);
      if (!timeMatch) continue;
      const display = timeMatch[1];
      const dateKey = inferDateKey(display, now);
      if (!dateKey) continue;
      const sceneMatch = block.match(/】\n([\s\S]+?)\n健康/);
      const hpMatch = block.match(/健康 (\d+)/);
      const foodMatch = block.match(/飽食 (\d+)/);
      const furMatch = block.match(/飽食 \d+ · (.+?) · /);
      const locMatch = block.match(/· ([^·\n]+)$/m);
      bucket(dateKey).diary.push({
        time: display,
        scene: sceneMatch ? sceneMatch[1].trim() : '',
        hp: hpMatch ? Number(hpMatch[1]) : null,
        food: foodMatch ? Number(foodMatch[1]) : null,
        location: locMatch ? locMatch[1].trim() : '',
        fur: furMatch ? furMatch[1] : null,
        shadowActive: block.includes('小黑影出沒中')
      });
    }
  }

  let world = {};
  try { world = JSON.parse(fs.readFileSync(WORLD_FILE, 'utf8')); } catch (e) {}

  for (const entry of (world.owner_log || [])) {
    const dateKey = inferDateKey(entry.time, now) || getTodayKey();
    bucket(dateKey).ownerLog.push(entry);
  }
  for (const entry of (world.visitor_log || [])) {
    const dateKey = inferDateKey(entry.time, now) || getTodayKey();
    bucket(dateKey).visitorLog.push(entry);
  }

  for (const [dateKey, data] of Object.entries(buckets)) {
    writeDay(dateKey, data);
  }

  fs.writeFileSync(MIGRATION_MARKER, new Date().toISOString());
  console.log(`已將舊資料轉檔成 ${Object.keys(buckets).length} 個每日檔案（logs/）`);
}

const BALANCE_BUILTIN = {
  foodDeltaWindowOpen: -3,
  foodDeltaWindowClosed: -5,
  lowFoodThreshold: 25,
  lowFoodHpDelta: -3,
  highFoodThreshold: 60,
  highFoodHpDelta: 1,
  familiarityPresent: 1,
  familiarityInteract: 2,
  familiarityAwayDecay: 0,
  affectionInteract: 2,
  affectionWellCared: 1,
  affectionAway: -1,
  affectionNeglect: -3,
  moodDecay: 0.3,
  moodInteract: 15,
  moodWellCared: 5,
  moodCrisis: -20,
  moodAway: -5,
  moodVisitor: 8,
  textureEase: 0.05,
  ownerFeedFoodBoost: 35,
  tickNightMinMin: 180,
  tickNightMaxMin: 360,
  tickDayMinMin: 15,
  tickDayMaxMin: 60
};
function loadBalance() {
  try {
    return { ...BALANCE_BUILTIN, ...JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'balance.json'), 'utf8')) };
  } catch (err) {
    return BALANCE_BUILTIN;
  }
}

// 把健康/飽食數值轉成一句簡短的狀態描述給AI，而不是直接餵數字讓AI卡在門檻上判斷。
function describeVital(hp, food) {
  let hpLine;
  if (hp >= 95) hpLine = '健康飽滿，毛澎潤渾圓，眼神銳利，動作靈活';
  else if (hp > 75) hpLine = '健康穩定，動作平穩，略顯疲態';
  else if (hp > 50) hpLine = '毛開始塌軟，動作微歪，偏好躲陰影靜坐、咬竹籤';
  else if (hp > 25) hpLine = '健康亮紅燈，掉毛變扁，動作遲緩，可能啃家具找東西吃';
  else if (hp > 5) hpLine = '健康危急，瀕臨崩潰，行為混亂';
  else hpLine = '健康瀕臨崩潰邊緣，絨毛因重病蒸發，露出粉色身體，無法戰鬥，急需介入';

  let foodLine;
  if (food >= 95) foodLine = '活力充沛、毛炸成球，會跳舞玩水';
  else if (food > 75) foodLine = '飽足，主動找小東西啃、舔冰舔竹籤';
  else if (food > 50) foodLine = '略餓，動作變慢，偷舔牆、舔灰塵、跑廁所吸水';
  else if (food > 25) foodLine = '飢餓，行為開始混亂';
  else foodLine = '極度飢餓，可能啃自己、變裸糰糰、排出黑色霜晶，這是需要緊急介入的危險狀態';

  return `${hpLine}；${foodLine}`;
}

function applyNaturalDecay(world) {
  const bt = world.characters.baituantuan;
  const windowOpen = world.room.window_open;
  const bal = loadBalance();
  let foodDelta = windowOpen ? bal.foodDeltaWindowOpen : bal.foodDeltaWindowClosed;
  let newFood = Math.max(0, bt.food + foodDelta);
  let newHp = bt.hp;
  if (newFood < bal.lowFoodThreshold) newHp = Math.max(0, newHp + bal.lowFoodHpDelta);
  else if (newFood > bal.highFoodThreshold) newHp = Math.min(100, newHp + bal.highFoodHpDelta);
  return {
    ...world,
    characters: {
      ...world.characters,
      baituantuan: { ...bt, food: newFood, hp: newHp }
    }
  };
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.url.startsWith('/api/world')) {
    try {
      const world = JSON.parse(fs.readFileSync(WORLD_FILE, 'utf8'));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ world }));
    } catch (e) {
      res.writeHead(500);
      res.end('error');
    }

  } else if (req.url.startsWith('/api/usage')) {
    try {
      const world = JSON.parse(fs.readFileSync(WORLD_FILE, 'utf8'));
      const usage = world.tokenUsage || { inputTokens: 0, outputTokens: 0, calls: 0 };
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ usage }));
    } catch (e) {
      res.writeHead(500);
      res.end('error');
    }

  } else if (req.url.startsWith('/api/dates')) {
    try {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ dates: listDateKeys() }));
    } catch (e) {
      res.writeHead(500);
      res.end('error');
    }

  } else if (req.url.startsWith('/api/weather')) {
    // 直接抓即時天氣給前端顯示用，不經過 AI、不花 token。
    fetchWeather().then(weather => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ weather }));
    }).catch(() => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ weather: null }));
    });

  } else if (req.url.startsWith('/api/day')) {
    try {
      const url = new URL(req.url, 'http://localhost');
      const dateKey = url.searchParams.get('date') || getTodayKey();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(readDay(dateKey)));
    } catch (e) {
      res.writeHead(500);
      res.end('error');
    }

  } else if (req.url.startsWith('/api/room')) {
    try {
      const body = [];
      req.on('data', chunk => body.push(chunk));
      req.on('end', () => {
        const data = JSON.parse(Buffer.concat(body).toString());
        const world = JSON.parse(fs.readFileSync(WORLD_FILE, 'utf8'));
        world.room = { ...world.room, ...data };
        if ('env_desc' in data) {
          world.room.env_desc_time = data.env_desc ? getRealTime().display : '';
        }
        fs.writeFileSync(WORLD_FILE, JSON.stringify(world, null, 2));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    } catch (e) {
      res.writeHead(500);
      res.end('error');
    }
} else if (req.url.startsWith('/api/owner')) {
    try {
      const body = [];
      req.on('data', chunk => body.push(chunk));
      req.on('end', () => {
        const data = JSON.parse(Buffer.concat(body).toString());
        const world = JSON.parse(fs.readFileSync(WORLD_FILE, 'utf8'));
        if (data.type === 'status') {
          world.owner_status = data.input || '';
          world.owner_status_time = data.input ? getRealTime().display : '';
        }
        if (data.type === 'action') {
          world.owner_action = data.input || '';
          world.owner_action_read = !data.input;
        }
        if (data.type === 'away') world.owner_away = !!data.away;
        fs.writeFileSync(WORLD_FILE, JSON.stringify(world, null, 2));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    } catch (e) {
      res.writeHead(500);
      res.end('error');
    }

  } else if (req.url.startsWith('/api/fragment')) {
    try {
      const body = [];
      req.on('data', chunk => body.push(chunk));
      req.on('end', () => {
        const data = JSON.parse(Buffer.concat(body).toString());
        const world = JSON.parse(fs.readFileSync(WORLD_FILE, 'utf8'));
        const fragState = ensureFragmentsState(world);
        const pending = fragState.pending;
        let bonusHint = null;

        if (pending && pending.id === data.id) {
          const { display } = getRealTime();
          if (data.action === 'keep') {
            if (!fragState.collected.includes(pending.id)) fragState.collected.push(pending.id);
            const sourceIds = FRAGMENTS.filter(f => f.source === pending.source).map(f => f.id);
            const isComplete = sourceIds.length > 0 && sourceIds.every(id => fragState.collected.includes(id));
            if (isComplete && COLLECTION_HINTS[pending.source] && !fragState.hintsShown.includes(pending.source)) {
              bonusHint = COLLECTION_HINTS[pending.source];
              fragState.hintsShown.push(pending.source);
            }
            pushPendingNote(world, { text: '得到一張紙片：', quote: pending.text }, display);
          } else {
            pushPendingNote(world, '剛剛丟了張怪紙片', display);
          }
          fragState.pending = null;
          appendToDay(getTodayKey(), 'fragmentLog', [{
            time: display, id: pending.id, source: pending.source, action: data.action,
            text: data.action === 'keep' ? pending.text : null
          }]);
        }

        world.fragments = fragState;
        fs.writeFileSync(WORLD_FILE, JSON.stringify(world, null, 2));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, bonusHint }));
      });
    } catch (e) {
      res.writeHead(500);
      res.end('error');
    }

  } else if (req.url.startsWith('/api/activity')) {
    try {
      const body = [];
      req.on('data', chunk => body.push(chunk));
      req.on('end', () => {
        const data = JSON.parse(Buffer.concat(body).toString());
        const text = (data.text || '').trim().slice(0, 60);
        const world = JSON.parse(fs.readFileSync(WORLD_FILE, 'utf8'));
        pushPendingNote(world, text);
        fs.writeFileSync(WORLD_FILE, JSON.stringify(world, null, 2));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    } catch (e) {
      res.writeHead(500);
      res.end('error');
    }

  } else if (req.url.startsWith('/api/visitor/delete')) {
    try {
      const body = [];
      req.on('data', chunk => body.push(chunk));
      req.on('end', () => {
        const data = JSON.parse(Buffer.concat(body).toString());
        const world = JSON.parse(fs.readFileSync(WORLD_FILE, 'utf8'));
        world.visitor_messages = (world.visitor_messages || []).filter(m => m.id !== data.id);
        fs.writeFileSync(WORLD_FILE, JSON.stringify(world, null, 2));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    } catch (e) {
      res.writeHead(500);
      res.end('error');
    }

  } else if (req.url.startsWith('/api/visitor')) {
    try {
      const body = [];
      req.on('data', chunk => body.push(chunk));
      req.on('end', () => {
        const data = JSON.parse(Buffer.concat(body).toString());
        const name = (data.name || '').trim().slice(0, 20);
        const message = (data.message || '').trim().slice(0, 50);
        const color = (data.color || 'yellow').trim().slice(0, 20);
        if (!message) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'empty message' }));
          return;
        }
        const world = JSON.parse(fs.readFileSync(WORLD_FILE, 'utf8'));
        const { display } = getRealTime();
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        world.visitor_messages = [...(world.visitor_messages || []), { id, name: name || '匿名訪客', message, time: display, color }];
        fs.writeFileSync(WORLD_FILE, JSON.stringify(world, null, 2));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, id }));
      });
    } catch (e) {
      res.writeHead(500);
      res.end('error');
    }

  } else if (req.url === '/api/reset' && req.method === 'POST') {
    // 重啟：把目前 world.json 跟所有 logs 封存到 archive/<timestamp>/，再用種子檔重置 world.json。
    // 不刪除任何資料，只是搬走，未來想回顧還能找到。
    try {
      const stamp = getRealTime().display.replace(/[\/: ]/g, '-') + '_' + Date.now();
      const archiveDir = path.join(DATA_DIR, 'archive', stamp);
      fs.mkdirSync(archiveDir, { recursive: true });
      if (fs.existsSync(WORLD_FILE)) {
        fs.copyFileSync(WORLD_FILE, path.join(archiveDir, 'world.json'));
      }
      if (fs.existsSync(LOGS_DIR)) {
        const archiveLogsDir = path.join(archiveDir, 'logs');
        fs.mkdirSync(archiveLogsDir, { recursive: true });
        for (const file of fs.readdirSync(LOGS_DIR)) {
          const src = path.join(LOGS_DIR, file);
          if (fs.statSync(src).isFile()) {
            fs.renameSync(src, path.join(archiveLogsDir, file));
          }
        }
      }
      fs.copyFileSync(SEED_WORLD_FILE, WORLD_FILE);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, archivedTo: `archive/${stamp}` }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
  } else if (req.url === '/' || req.url === '/index.html') {
    try {
      const html = fs.readFileSync('index.html', 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (e) {
      res.writeHead(404);
      res.end('not found');
    }
  } else if (req.url === '/content-lab' || req.url === '/content-lab.html') {
    try {
      const html = fs.readFileSync(path.join(__dirname, 'tools', 'content-lab.html'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (e) {
      res.writeHead(404);
      res.end('not found');
    }
  } else if (req.url.startsWith('/api/content/')) {
    // 給 content-lab 讀目前線上的 data/*.json，方便手機開頁面時帶出最新內容。
    try {
      const name = req.url.split('/')[3].split('?')[0];
      const allow = { 'system-prompt': 'system-prompt.json', 'fragments': 'fragments.json', 'events': 'events.json', 'balance': 'balance.json', 'hidden-stats': 'hidden-stats.json' };
      if (!allow[name]) { res.writeHead(404); res.end('not found'); return; }
      const content = fs.readFileSync(path.join(__dirname, 'data', allow[name]), 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(content);
    } catch (e) {
      res.writeHead(404);
      res.end('{}');
    }
  } else if (req.url === '/style.css' || req.url === '/app.js') {
    try {
      const file = req.url.slice(1);
      const type = file.endsWith('.css') ? 'text/css' : 'application/javascript';
      const content = fs.readFileSync(file, 'utf8');
      res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
      res.end(content);
    } catch (e) {
      res.writeHead(404);
      res.end('not found');
    }
  } else {
    res.writeHead(404);
    res.end('not found');
  }
});

server.listen(process.env.PORT || 3000, () => {
  console.log(`伺服器啟動，port ${process.env.PORT || 3000}`);
});

async function tick() {
  let world = JSON.parse(fs.readFileSync(WORLD_FILE, 'utf8'));

  if (world.for_rent) {
    // 吉屋出租：房間空置，不讀取任何輸入、不呼叫 API（節省成本）
    const delay = getNextDelay();
    console.log(`吉屋出租中，跳過這次更新。下次檢查：${Math.round(delay/60000)} 分鐘後`);
    setTimeout(tick, delay);
    return;
  }

  world = applyNaturalDecay(world);

  const { display } = getRealTime();
  let bt = world.characters.baituantuan;

  // owner_action 只在第一次被 AI 讀到時納入 prompt；讀過一次就只是顯示用的唯讀文字，
  // 直到玩家送出新的一則才會再次變成「未讀」。
  const ownerActionUnread = !!world.owner_action && !world.owner_action_read;

  // 巨怪的行為描述若提到餵食/留置食物，機制上直接加飽食度，不完全依賴 AI 自行判斷給多少。
  // 否則每一輪 applyNaturalDecay 持續扣飽食，玩家明明餵了東西，數值卻沒有反映。
  const FEED_KEYWORDS = /冰棒|冰塊|水|麵包|食物|餵|放.*吃|留.*吃|奶|點心|零食/;
  if (ownerActionUnread && FEED_KEYWORDS.test(world.owner_action)) {
    const bal = loadBalance();
    const newFood = Math.min(100, bt.food + bal.ownerFeedFoodBoost);
    world.characters.baituantuan = { ...bt, food: newFood };
    bt = world.characters.baituantuan;
    console.log(`偵測到餵食行為，飽食 +${bal.ownerFeedFoodBoost} → ${newFood}`);
  }

  const ownerStatus = world.owner_status ? `巨怪狀態：${world.owner_status}` : '';
  const ownerAction = ownerActionUnread ? `巨怪對房間的行為：${world.owner_action}` : '';
  const ownerInput = (ownerStatus || ownerAction) ? '\n' + [ownerStatus, ownerAction].filter(Boolean).join('\n') : '';
  const awayInput = world.owner_away ? '\n巨怪現在外出不在房間（最棒的事正發生在沒人的時候）。' : '';

  const visitorMessages = world.visitor_messages || [];
  const visitorInput = visitorMessages.length > 0
    ? '\n訪客留言：\n' + visitorMessages.map(m => `${m.name || '匿名訪客'}：${m.message}`).join('\n')
    : '';

  const pendingNotes = world.pending_notes || [];
  const pendingNotesInput = pendingNotes.length > 0
    ? '\n尚未消化的系統紀錄（紙片、家電提示等，請自然融入或收尾這段動態，之後就會清空）：\n' +
      pendingNotes.map(n => `- ${n.text}${n.quote ? `「${n.quote}」` : ''}`).join('\n')
    : '';

  // 隱藏數值（熟悉度／好感度／質地／心情）自動推進，並算出本回合的暱稱／心情色彩／質地。
  const balance = loadBalance();
  const hidden = computeHiddenStats(bt, {
    interacted: ownerActionUnread,
    away: !!world.owner_away,
    hasVisitor: visitorMessages.length > 0,
    food: bt.food,
    hp: bt.hp
  }, balance);
  const nickname = getNicknameFor(hidden.familiarity, hidden.affection) || '';
  const texture = getTextureFor(hidden.shape, hidden.hardness) || '';
  const moodColor = getMoodColorFor(hidden.mood);
  const hiddenInput = [
    nickname ? `\n白糰糰此刻心裡如何看待巨怪：以「${nickname}」相稱（這是他熟悉與好感程度的體現，請讓動態自然流露這份態度；他不會說話，這只是敘述者的稱呼語氣）` : '',
    moodColor ? `\n白糰糰當前心情：${moodColor.name}（心情值${hidden.mood}），請讓這段動態的氣氛與之相符` : '',
    texture ? `\n白糰糰對巨怪長期累積的觸感印象：${texture}（隱藏設定，可微妙影響他靠近或迴避的方式，不要直接把這幾個字寫進動態）` : ''
  ].join('');

  const combinedPlayerText = [world.owner_status, ownerActionUnread ? world.owner_action : null, ...visitorMessages.map(m => m.message)]
    .filter(Boolean).join(' ');
  const triggeredEvent = detectTriggeredEvent(bt, combinedPlayerText);
  const eventInput = triggeredEvent ? '\n' + EVENT_PROMPTS[triggeredEvent] : '';
  if (triggeredEvent) console.log(`特殊事件觸發：${triggeredEvent}`);

  // 健康/飽食完全由機制決定（衰減、餵食加成、特殊事件強制值），AI不再直接控制這兩個數字，
  // 只透過一句簡短狀態描述去理解該怎麼寫，避免被硬數值門檻卡住敘述。
  if (triggeredEvent === 'ascension') {
    world.characters.baituantuan = { ...bt, food: 50, hp: 120 };
    bt = world.characters.baituantuan;
  } else if (triggeredEvent === 'shadowRevenge') {
    world.characters.baituantuan = { ...bt, food: 60, hp: 60 };
    bt = world.characters.baituantuan;
  }
  const vitalLine = describeVital(bt.hp, bt.food);

  const weather = await fetchWeather() || world.weather || null;
  const weatherInput = weather
    ? `\n戶外天氣（台北實況）：${weather.desc} ${weather.temp}℃ 濕度${weather.humidity}%`
    : '';

  // 冷氣偶發故障：開機中約 4% 機率壞掉，壞了維持到玩家重新開機（前端重開會清掉 broken）。
  const acNow = normalizeAc(world.room);
  if (acNow.on && !acNow.broken && Math.random() < 0.04) {
    world.room.ac = { ...acNow, broken: true };
    console.log('冷氣故障了。');
  } else {
    world.room.ac = acNow;
  }
  const climateInput = '\n' + distillClimate(world.room, weather);
  const acLabel = acNow.on
    ? `${acNow.broken ? '故障' : { cool: '冷氣', heat: '暖氣', fan: '送風', dry: '除濕' }[acNow.mode] || '冷氣'}${acNow.mode === 'fan' ? '' : acNow.temp + '℃'}`
    : '關';

  const prompt = `當前時間：${display}
白糰糰目前狀態：${vitalLine} · 毛況:${bt.fur || '正常'} · 位置:${bt.location}
小黑影：${world.characters.shadow.active ? '活躍' : '潛伏'} 位置:${world.characters.shadow.location} 灰塵:${world.characters.shadow.dust_count}
房間清潔度：${world.room.cleanliness}
窗戶：${world.room.window_open ? '開' : '關'} 冷氣：${acLabel} 燈：${world.room.light_on ? '開' : '關'} 廁所門：${world.room.toilet_open ? '開' : '關'}
巨怪對房間環境的描述：${world.room.env_desc || '無'}
今天已發生：${world.room.events_today.join('，') || '無'}
近期記憶：${(bt.memory || []).slice(-3).join(' / ') || '無'}${weatherInput}${climateInput}${ownerInput}${awayInput}${visitorInput}${eventInput}${pendingNotesInput}${hiddenInput}

生成這段時間白糰糰的動態。`;

  const delay = getNextDelay();

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
      system: SYSTEM_PROMPT
    });

    let text = response.content[0].text.trim();
    text = text.replace(/^```json\s*/, '').replace(/```\s*$/, '');
    const result = JSON.parse(text);

    const usage = response.usage || {};
    const prevUsage = world.tokenUsage || { inputTokens: 0, outputTokens: 0, calls: 0 };
    const tokenUsage = {
      inputTokens: prevUsage.inputTokens + (usage.input_tokens || 0),
      outputTokens: prevUsage.outputTokens + (usage.output_tokens || 0),
      calls: prevUsage.calls + 1
    };

    const newWorld = {
      ...world,
      nextTickAt: Date.now() + delay,
      weather: weather || world.weather || null,
      tokenUsage,
      characters: {
        baituantuan: {
          ...world.characters.baituantuan,
          ...(({ hp, food, ...rest }) => rest)(result.baituantuan || {}),
          ...hidden,
          nickname,
          texture,
          mood_color: moodColor ? { name: moodColor.name, color: moodColor.color } : null,
          memory: [...(bt.memory || []).slice(-10), result.scene]
        },
        shadow: { ...world.characters.shadow, ...result.shadow }
      },
      room: { ...world.room, ...result.room }
    };

    const fragState = ensureFragmentsState(world);
    newWorld.fragments = { ...fragState };
    if (!fragState.pending && fragState.cooldown > 0) {
      newWorld.fragments = { ...fragState, cooldown: fragState.cooldown - 1 };
    } else if (!fragState.pending) {
      const hits = matchFragments(result.scene, combinedPlayerText, fragState.collected);
      if (hits.length > 0) {
        const f = hits[0];
        newWorld.fragments = {
          ...fragState,
          pending: { id: f.id, source: f.source, label: f.label || '', text: f.text, time: display },
          cooldown: FRAGMENT_COOLDOWN_TICKS
        };
        console.log(`紙片掉落待領取：${f.id}`);
      }
    }

    const todayKey = getTodayKey();

    if (ownerActionUnread) {
      appendToDay(todayKey, 'ownerLog', [{
        time: display,
        status: world.owner_status || '',
        action: world.owner_action
      }]);
      // 文字本身不清空，留著顯示在「我的動態」第 1 張；只標記已讀，下次 tick 不會再讀它。
      newWorld.owner_action_read = true;
    }

    if (visitorMessages.length > 0) {
      appendToDay(todayKey, 'visitorLog', visitorMessages);
      newWorld.visitor_messages = [];
    }

    // 未消化的系統紀錄已經被寫進這次的 prompt、融入 result.scene，消化完畢即清空。
    if (pendingNotes.length > 0) {
      newWorld.pending_notes = [];
    }

    fs.writeFileSync(WORLD_FILE, JSON.stringify(newWorld, null, 2));

    const furNote = result.baituantuan.fur && result.baituantuan.fur !== '正常'
      ? ` · ${result.baituantuan.fur}` : '';

    const finalBt = newWorld.characters.baituantuan;

    appendToDay(todayKey, 'diary', [{
      time: display,
      scene: result.scene,
      hp: finalBt.hp,
      food: finalBt.food,
      location: result.baituantuan.location,
      fur: result.baituantuan.fur && result.baituantuan.fur !== '正常' ? result.baituantuan.fur : null,
      shadowActive: !!result.shadow.active,
      tokens: { input: usage.input_tokens || 0, output: usage.output_tokens || 0 }
    }]);

    console.log(`【${display}】\n${result.scene}\n健康 ${finalBt.hp} · 飽食 ${finalBt.food}${furNote} · ${result.baituantuan.location}\n${result.shadow.active ? '⚠️ 小黑影出沒中' : ''}\ntoken：本次input${usage.input_tokens || 0}/output${usage.output_tokens || 0} · 累計input${tokenUsage.inputTokens}/output${tokenUsage.outputTokens}（共${tokenUsage.calls}次）`);

  } catch (e) {
    console.error('錯誤：', e.message);
    const world2 = JSON.parse(fs.readFileSync(WORLD_FILE, 'utf8'));
    world2.nextTickAt = Date.now() + delay;
    if (weather) world2.weather = weather;

    // 額度用盡 / 金鑰失效 → 進入吉屋出租（停止呼叫 API，前端蓋上告示）。
    // 只在帳務/授權類錯誤時觸發，暫時性網路或伺服器錯誤照常重試。
    const msg = (e.message || '').toLowerCase();
    const billingError = e.status === 401 || e.status === 403 ||
      (e.status === 400 && /credit|billing|balance|quota|insufficient/.test(msg)) ||
      /credit balance|billing|insufficient_quota|insufficient credit/.test(msg);
    if (billingError) {
      world2.for_rent = true;
      console.error('偵測到額度/金鑰問題，進入吉屋出租狀態。');
    }

    fs.writeFileSync(WORLD_FILE, JSON.stringify(world2, null, 2));
  }
console.log(`下次更新：${Math.round(delay/60000)} 分鐘後（${new Date(Date.now()+delay).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})}）`);

  setTimeout(tick, delay);
}

ensureWorldFile();
migrateLegacyLogs();
tick();
console.log('白糰糰宇宙啟動中...');