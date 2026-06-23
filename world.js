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

// 避免寫到一半被中斷導致 world.json 截斷成不合法 JSON：先寫暫存檔再 rename（同一磁區內 rename 是原子操作）。
function writeWorldFile(world) {
  const tmp = `${WORLD_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(world, null, 2));
  fs.renameSync(tmp, WORLD_FILE);
}

// 把目前 world.json 跟所有 logs 封存到 archive/<timestamp>/，再用種子檔重置 world.json。
// 不刪除任何資料，只是搬走，未來想回顧還能找到。回傳封存路徑。
function archiveAndResetWorld() {
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
  return `archive/${stamp}`;
}

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
  // 新版格式：s.sections 是使用者在 /content-lab 自訂、可增刪改名的有序段落陣列。
  // 舊版格式：扁平 key（identity/lifecycle…），保留相容，沒有 sections 時才走這條。
  let bodyBlock;
  if (Array.isArray(s.sections)) {
    bodyBlock = s.sections
      .filter(sec => sec && (sec.title || sec.body))
      .map(sec => `${sec.title || ''}：\n${sec.body || ''}`)
      .join('\n\n');
  } else {
    const section = (key) => s[key] || '';
    bodyBlock = [
      `白糰糰是誰：\n${section('identity')}`,
      `生命週期：\n${section('lifecycle')}`,
      `尺寸與認知：\n${section('sizeCognition')}`,
      `性格與信念：\n${section('personality')}`,
      `社交與情感：\n${section('social')}`,
      `身體與感知（重要，別寫錯）：\n${section('body')}`,
      `毛況系統：\n${section('furSystem')}`,
      `小黑影：\n${section('shadow')}`,
      `訪客留言：\n${section('visitors')}`,
      `生活習性：\n${section('habits')}`,
      `規則：\n${section('rules')}`
    ].join('\n\n');
  }
  return `你是白糰糰宇宙的世界引擎。根據當前世界狀態，生成這段時間內發生的事。

${bodyBlock}

輸出格式，只輸出這個JSON，不要其他文字與markdown：
{
  "scene": "這段時間發生的事，2-4句，漫畫分鏡風格，句與句之間換行",
  "fed": true或false（判斷「這段敘述裡，白糰糰有沒有吃進任何食物」。只要牠正在吃、舔、啃、吞任何可食用的東西（巨怪剛放的、之前留在房間還沒吃完的、自己找到的都算）就回 true，跟巨怪這個 tick 有沒有動作無關——房間裡還有食物、牠還在吃，就要一直回 true，不是只有巨怪剛餵的那一次才算。只有牠完全沒吃、或只是舔牆/舔灰塵/吸馬桶水這種沒有營養的飢餓行為，才回 false。不要管數值，飽食度增減完全由程式處理）,
  "bond": "positive"、"neutral" 或 "negative"（判斷「這段時間裡，巨怪與白糰糰之間的關係是變親近、沒變化、還是受損」。巨怪做了讓牠舒服／安心／被理解的事而牠正面回應（餓時被餵、被溫柔對待、想要的被滿足、一起待著很自在）＝positive；巨怪讓牠不舒服／被忽視該被照顧時沒被照顧／被嚇到／需求被無視＝negative；這段只是自顧自過、沒有實質互動或無明顯好壞＝neutral。請從白糰糰的角度、依常理判斷，這是關係好壞的唯一依據，數值幅度由程式處理）,
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

// 特殊事件＝「腳本卡（card，主頁直接顯示的固定劇情，保證演出）」＋「prompt（AI 接著寫的餘波指示）」。
// 可在 /content-lab 編輯並自動上傳覆蓋 data/events.json。舊版 events.json 是「key→字串」，
// 會被當成只有 prompt、沒有 card 來相容處理。
const EVENT_DEFS_BUILTIN = {
  ascension: {
    card: `【飛升・渡劫】白糰糰全身絨毛微顫，靜坐窗邊仰望天空，雷雲湧動。一道光自他身上亮起。`,
    prompt: `承接上面的渡劫劇情卡，只寫「之後的餘波」，隨機二選一並寫入scene：
A. 度劫失敗（電糰糰）：遭雷擊，絨毛焦捲變黑，靜電纏身，動作僵硬，沉默放電躲回角落。
B. 度劫成功（法喜糰糰）：升空發光後「啪」一聲落地，異常開心，於地板施展誇張街舞動作。`
  },
  shadowRevenge: {
    card: `【冥影・霜解】白糰糰無聲崩解，只留下毛毛與冰屑。小黑影自陰影浮現，與殘骸融合成「冰晶暗影」。室內異常降溫結霜。`,
    prompt: `承接上面的冥影劇情卡，只寫「之後的餘波」：冰晶暗影展開一場正義與荒誕共行的審判——巨型Mr.DUST夜行騷擾、如影隨形的精神干擾。不要重述卡片已寫的崩解過程。shadow.active設為true，shadow.dust_count明顯增加。`
  },
  rebirth: {
    card: `【再生】涼濕的角落裡，散落的毛毛與冰屑悄悄聚攏。一顆小小的白糰糰重新成形，墨色豆眼緩緩睜開。冰晶暗影悄然退回影子。`,
    prompt: `承接上面的再生劇情卡，只寫「之後的餘波」：白糰糰帶著模糊的舊記憶重新醒來，動作還有點生疏小心。小黑影回到平時潛伏狀態，shadow.active設為false。`
  },
  observation: {
    card: ``,
    prompt: `特殊事件・觀察篇（玩家輸入觸發旁白模式）：
本次scene改用DISCOVERY紀錄片風格書寫：科學旁觀的趣味、俏皮詼諧的科普語氣，把白糰糰的行為包裝成「野生觀察紀錄」（例如：「在零下八度的清晨，一隻野生白糰糰⋯⋯」），但內容仍要符合他平時的行為邏輯。`
  },
  farewell: {
    card: `【永別・遺形留蕈】白糰糰站在你面前，毛毛炸開如初雪，卻不再閃爍鋒芒。他靜靜注視著你，眼神不再銳利，而是如望穿千山。緩緩地，他將竹籤插入床邊棉布之中，一縷一縷絨毛飄落，最終化為一朵微亮的白蕈，像雲一樣柔軟。\n——「這份情感與陪伴，曾經完整發生過，也被世界承認過。」`,
    prompt: `承接上面的告別劇情卡，只寫「之後的氛圍」，安靜、溫柔、留白，不要重述卡片內容，也不要替飼主做決定——種下蕈菇或不種，是飼主接下來要自己選的。`
  }
};
function loadEventDefs() {
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'events.json'), 'utf8'));
  } catch (err) {
    data = {};
  }
  const out = {};
  const keys = new Set([...Object.keys(EVENT_DEFS_BUILTIN), ...Object.keys(data)]);
  for (const k of keys) {
    const b = EVENT_DEFS_BUILTIN[k] || { card: '', prompt: '' };
    const d = data[k];
    if (typeof d === 'string') out[k] = { card: b.card || '', prompt: d };                 // 舊版字串＝只有 prompt
    else if (d && typeof d === 'object') out[k] = { card: d.card ?? b.card ?? '', prompt: d.prompt ?? b.prompt ?? '' };
    else out[k] = { card: b.card || '', prompt: b.prompt || '' };
  }
  return out;
}
const EVENT_DEFS = loadEventDefs();
function getEventCard(key) { return (EVENT_DEFS[key] || {}).card || ''; }
function buildEventInput(key) {
  const def = EVENT_DEFS[key] || {};
  const card = def.card || '';
  const prompt = def.prompt || '';
  // 腳本卡已「發生」並會原文顯示在主頁，AI 只接著寫餘波，不要重述卡片。
  if (card) return `【這段劇情卡已經發生，且會原文顯示給讀者，請勿重述卡片內容，只接著寫「之後」的餘波反應】\n${card}\n\n【接續指示】\n${prompt}`;
  return prompt;
}

// 世界書（lorebook）：條目＝關鍵字＋補充設定文字。content 空白＝草稿，即使關鍵字命中也不送出。
// 在 content-lab 編輯、上傳覆蓋 data/lorebook.json。供主世界AI與電視台共用。
function loadLorebook() {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'lorebook.json'), 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (err) {
    return [];
  }
}
function matchLorebook(text) {
  const hay = text || '';
  return loadLorebook().filter(e =>
    e.content && e.content.trim() &&
    Array.isArray(e.keywords) && e.keywords.some(k => k && hay.includes(k))
  );
}
function buildLoreInput(text) {
  const hits = matchLorebook(text).slice(0, 4);
  if (hits.length === 0) return '';
  return '\n世界書補充設定（符合目前情境，自然融入敘述，不要逐字唸出標題）：\n' + hits.map(e => `- ${e.content}`).join('\n');
}

// 糰糰行為籤庫：只給「牠做什麼」的動作參考，不寫情緒（情緒由 AI 依當下脈絡自然流出）。
// 用來在沒有強事件（訪客／特殊事件）時，給 AI 一點具體靈感，避免每回合都安靜發呆。
// 可在 /content-lab「行為籤庫」分頁編輯、上傳覆蓋 data/actions.json，能灌大量條目。
const DEFAULT_ACTION_POOL = [
  { type: 'patrol', action: '繞著房間邊界巡一圈，確認沒有東西被動過' },
  { type: 'nest', action: '在某個角落重新理一次窩，把棉布或碎屑挪位' },
  { type: 'forage', action: '翻找地上或縫隙裡有沒有露水、冰塊、碎屑可吃' },
  { type: 'weapon', action: '檢查竹籤或細針還夠不夠尖，試著刺一下紙張或軟物' },
  { type: 'grind', action: '找東西磨牙，啃一下竹籤、家具邊角' },
  { type: 'climb', action: '貼著牆面或家具邊緣，無聲攀爬一段' },
  { type: 'squeeze', action: '鑽進一個狹窄縫隙，試試看能不能擠過去' },
  { type: 'scratch', action: '在粗糙表面磨蹭身體，理一理毛' },
  { type: 'invent', action: '把垃圾或雜物堆疊排列，自認在發明糰式文明' },
  { type: 'water', action: '跑去廁所或水邊碰一下水，小心別被沖走' },
  { type: 'sun', action: '找一塊有光的地方靠著，留意溫度別太高' },
  { type: 'stare', action: '盯著一個固定的小東西不動，像在判斷它算不算數' },
];
function loadActionPool() {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'actions.json'), 'utf8'));
    const pool = Array.isArray(data) ? data.filter(a => a && a.action && a.action.trim()) : [];
    return pool.length > 0 ? pool : DEFAULT_ACTION_POOL;
  } catch (err) {
    return DEFAULT_ACTION_POOL;
  }
}
// 選一支籤：避開最近 3 次已經用過的類型，降低重複感；全部都用過就退回完整籤庫。
function pickActionTag(recentTypes) {
  const recent = recentTypes || [];
  const allActions = loadActionPool();
  const pool = allActions.filter(a => !recent.includes(a.type));
  const usePool = pool.length > 0 ? pool : allActions;
  return usePool[Math.floor(Math.random() * usePool.length)];
}

// 死亡（健康＋飽食歸零）改由 tick 內的死亡狀態機處理（要管重生倒數與小黑影好感），
// 這裡只負責偵測飛升與觀察兩種即時事件。
function detectTriggeredEvent(world, bt, combinedPlayerText) {
  if (bt.hp >= 100 && bt.food >= 100) return 'ascension';
  const farewell = world.farewell;
  if (!farewell || !farewell.pending) {
    if (/放下|結束|祝福|告別|不會再回來/.test(combinedPlayerText)) return 'farewell';
  }
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

// 回顧頁狀態卡用：把當下房間（冷氣/窗/巨怪描述）濃縮成一句很短的居家狀況，存進每日紀錄。
function roomBrief(room) {
  if (!room) return '';
  const ac = normalizeAc(room);
  let note;
  if (ac.on && ac.broken) note = '冷氣故障、悶熱怪風';
  else if (ac.on) {
    if (ac.mode === 'cool') note = `冷氣冷房 ${ac.temp}℃`;
    else if (ac.mode === 'heat') note = `暖氣 ${ac.temp}℃`;
    else if (ac.mode === 'dry') note = '除濕中';
    else if (ac.mode === 'fan') note = '送風';
    else note = '冷氣開啟';
  } else if (room.window_open) note = '開窗';
  else note = '門窗緊閉';
  const extra = (room.env_desc || '').trim();
  return extra ? `${note}・${extra}` : note;
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

// 抓台北即時天氣（Open-Meteo，免金鑰）。失敗回 null，不影響 tick；失敗時重試一次，避免單次網路抖動就整段漏記天氣。
async function fetchWeatherOnce() {
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=25.033&longitude=121.565&current=temperature_2m,relative_humidity_2m,weather_code&timezone=Asia%2FTaipei';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { signal: controller.signal });
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
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWeather() {
  return (await fetchWeatherOnce()) || (await fetchWeatherOnce());
}

// ===== Gemini（電視頻道專用，獨立於主世界的 Claude 呼叫）=====
// 玩家主動點頻道才觸發，回傳一段短文字，不改世界數值、不佔 tick 預算。
// gemini-2.5-flash 在免費層有自己的配額；把 thinking 關掉避免思考吃光 token 回空白。
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

async function callGemini(prompt, maxTokens = 400) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { error: 'no_key' };
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 1.0, maxOutputTokens: maxTokens, thinkingConfig: { thinkingBudget: 0 } }
      }),
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error(`Gemini 回應錯誤 ${res.status}：${detail.slice(0, 300)}`);
      return { error: `http_${res.status}`, detail: detail.slice(0, 300) };
    }
    const data = await res.json();
    const cand = data?.candidates?.[0];
    const text = cand?.content?.parts?.map(p => p.text).filter(Boolean).join('').trim();
    if (!text) {
      const reason = cand?.finishReason || data?.promptFeedback?.blockReason || 'unknown';
      console.error(`Gemini 空回應，finishReason=${reason}：`, JSON.stringify(data).slice(0, 300));
      return { error: 'empty', detail: `finishReason=${reason}` };
    }
    return { text };
  } catch (e) {
    console.error('Gemini 呼叫失敗：', e.message);
    return { error: 'exception', detail: e.message };
  }
}

// 把目前世界狀態整理成電視頻道要用的上下文。
function buildTvContext() {
  const world = JSON.parse(fs.readFileSync(WORLD_FILE, 'utf8'));
  const bt = world.characters.baituantuan;
  const room = world.room || {};
  const recentMemory = (bt.memory || []).slice(-5);
  const recentScene = recentMemory.slice(-1)[0] || '（暫無最新動態）';
  const moodColor = getMoodColorFor(typeof bt.mood === 'number' ? bt.mood : 0);
  return {
    recentScene,
    recentMemory,
    fur: bt.fur || '正常',
    food: bt.food,
    hp: bt.hp,
    location: bt.location || '',
    mood: moodColor ? moodColor.name : '平靜',
    cleanliness: room.cleanliness,
    envDesc: room.env_desc || '',
    weather: world.weather ? `${world.weather.desc} ${world.weather.temp}℃` : '',
    eventsToday: (room.events_today || []).join('，'),
    windowOpen: !!room.window_open,
    lightOn: room.light_on !== false,
    acOn: !!(room.ac && room.ac.on),
    shadowActive: !!(world.characters.shadow && world.characters.shadow.active)
  };
}

// 給電視台用的世界觀補充：抽幾張小黑影紙片當背景知識＋符合目前情境的世界書條目，
// 讓 Gemini 也認識他的調性（免費模型，多讀點資料無妨）。
function buildLoreSnippetForTv(ctx) {
  const parts = [];
  if (FRAGMENTS && FRAGMENTS.length > 0) {
    const sample = FRAGMENTS.filter(f => f.source && f.text).slice(0, 8).map(f => `「${f.text}」`).join('\n');
    if (sample) parts.push(`以下是世界裡流傳的小黑影紙片字句（背景調性參考，不必引用原文）：\n${sample}`);
  }
  const loreInput = buildLoreInput((ctx && ctx.recentMemory || []).join(' '));
  if (loreInput) parts.push(loreInput.replace(/^\n/, ''));
  return parts.length ? '\n' + parts.join('\n') : '';
}

function buildTvPrompt(channel, ctx) {
  const stateLine = `白糰糰目前狀態：飽食${ctx.food}、健康${ctx.hp}、心情「${ctx.mood}」、位置「${ctx.location}」、毛況「${ctx.fur}」。\n` +
    `房間：清潔度${ctx.cleanliness}（${ctx.envDesc || '無特別描述'}）、窗戶${ctx.windowOpen ? '開' : '關'}、燈${ctx.lightOn ? '開' : '關'}、空調${ctx.acOn ? '開' : '關'}、小黑影${ctx.shadowActive ? '出沒中' : '潛伏'}。\n` +
    (ctx.weather ? `戶外天氣：${ctx.weather}。\n` : '') +
    (ctx.eventsToday ? `今天已發生：${ctx.eventsToday}。\n` : '') +
    `白糰糰最近的動態紀錄（由舊到新）：\n${(ctx.recentMemory && ctx.recentMemory.length ? ctx.recentMemory : [ctx.recentScene]).map((m, i) => `${i + 1}. ${m}`).join('\n')}`;

  const lengthRule = '篇幅維持在約 120 字左右即可，不用硬性規定字數，偶爾超過沒關係；只能根據上面提供的資訊發揮，不要編造與設定矛盾的內容。';
  const lorePrefix = `${SYSTEM_PROMPT}\n\n———\n以上是角色設定，務必遵守白糰糰的身體構造（沒有耳朵、鼻子，靠觸感與顏色感知世界）與小黑影的設定。${buildLoreSnippetForTv(ctx)}\n\n`;

  if (channel === 'nature') {
    return `${lorePrefix}${stateLine}\n\n你是 DISCOVERY 生態紀錄片的旁白。請以科學旁觀又俏皮詼諧的科普語氣，把白糰糰「當下這一刻」的行為包裝成一段野生觀察紀錄（例如開場「在零下八度的清晨，一隻野生白糰糰……」）。${lengthRule}繁體中文、只輸出旁白本身，不要加標題或前言。`;
  }
  if (channel === 'news') {
    return `${lorePrefix}${stateLine}\n\n你是地方新聞台的主播，正在報導「白糰糰房間」這條荒誕又一本正經的即時新聞。根據上面的房間與狀態，用煞有介事的播報腔調寫一則短新聞報導。${lengthRule}繁體中文、只輸出播報內容，開頭可用「插播一則最新消息——」。`;
  }
  // shopping
  return `${lorePrefix}${stateLine}\n\n你是深夜購物頻道的主持人，正在向觀眾推銷一件「白糰糰現在最需要」的商品（依他目前的飽食、心情、房間狀況挑選，例如餓了就賣零食、冷了就賣暖窩）。用浮誇熱情的購物台語氣介紹，可吹捧賣點、報出限時優惠價、製造搶購感，但這只是節目演出、實際還不能下單。${lengthRule}繁體中文，結尾自然帶一句「錢包功能即將上線，敬請期待」。只輸出主持人的口播。`;
}

// Gemini 偶爾會夾帶 markdown 符號、程式碼框、把設定提示或分隔線回吐進輸出，這裡清乾淨只留純播報文字。
function cleanTvText(raw) {
  let t = String(raw || '');
  t = t.replace(/```[a-zA-Z]*\s*/g, '').replace(/```/g, '');     // 程式碼框
  t = t.replace(/^[\s\-—–=*#>·•]+/, '');                          // 開頭殘留的符號／分隔線
  t = t.replace(/[*_`#]+/g, '');                                  // 行內 markdown 強調符號
  t = t.replace(/^(旁白|播報|口播|主持人|新聞)[：:]\s*/m, '');     // 角色標籤前綴
  t = t.replace(/\n{3,}/g, '\n\n');                               // 多餘空行
  return t.trim();
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
    hiddenStatsCache = { fam: { min: 0, max: 100, bands: 7 }, aff: { min: -100, max: 100, bands: 7 }, unit: { min: 0, max: 100, bands: 7 }, stat: { min: 0, max: 100, bands: 7 }, nicknameGrid: [], textureGrid: [], moodBands: [], statGrid: [] };
  }
  return hiddenStatsCache;
}

function bandIndex(value, axis) {
  const { min, max, bands } = axis;
  // axis.edges（可選）：自訂分界點，讓中間「正常」區間更寬、兩端極值更窄（山坡曲線）。
  // 必須是 bands+1 個遞增數值，例如 7 段：[0,8,20,38,62,80,92,100]。沒給就退回等寬切分。
  let edges;
  if (Array.isArray(axis.edges) && axis.edges.length === bands + 1) {
    edges = axis.edges;
  } else {
    edges = [];
    for (let i = 0; i <= bands; i++) edges.push(min + i * (max - min) / bands);
  }
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

function getStatBandFor(food, hp) {
  const stats = loadHiddenStats();
  const grid = stats.statGrid;
  if (!grid || !grid.length) return null;
  const statAxis = stats.stat || { min: 0, max: 100, bands: 7 };
  const i = bandIndex(hp, statAxis);
  const j = bandIndex(food, statAxis);
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
  // 關係好壞由 AI 判斷的 bond 決定（來自上一輪場景的常理判斷），程式只負責換成可控數值。
  const bondPos = signals.bond === 'positive';
  const bondNeg = signals.bond === 'negative';
  // 有沒有實際接觸（巨怪送動態，或這段發生了會影響關係的事）→ 熟悉度成長用，跟好壞無關。
  const interacted = signals.interacted || bondPos || bondNeg;
  const wellCared = signals.food > bal.highFoodThreshold && signals.hp > 60;
  // 客觀疏忽保底：長期挨餓又沒在吃，即使 AI 沒判 negative 也輕扣一點。
  const neglected = signals.food < bal.lowFoodThreshold && !signals.fed;
  // 心情用的危機（短期情緒會難過）：挨餓沒吃、或健康亮紅燈。
  const crisis = neglected || signals.hp < 25;

  // 熟悉度：在場累積、有接觸就加成，預設外出不倒退（單調成長）
  let familiarity = cur.familiarity;
  if (!signals.away) familiarity += bal.familiarityPresent;
  if (interacted) familiarity += bal.familiarityInteract;
  if (signals.away) familiarity += bal.familiarityAwayDecay;
  familiarity = clampStat(familiarity, 0, 100);

  // 好感度：主要看 AI 判斷的關係好壞（bond），外出冷落／客觀疏忽再各扣一點保底
  let affection = cur.affection;
  if (bondPos) affection += bal.affectionBondPositive;
  else if (bondNeg) affection += bal.affectionBondNegative;
  if (signals.away) affection += bal.affectionAway;
  if (neglected) affection += bal.affectionNeglect;
  affection = clampStat(affection, -100, 100);

  // 心情：短期情緒，每回合先朝中性回歸，再疊加本回合事件
  let mood = cur.mood * (1 - bal.moodDecay);
  if (bondPos) mood += bal.moodInteract;
  else if (bondNeg) mood += bal.moodBondNegative;
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
  affectionBondPositive: 4,
  affectionBondNegative: -4,
  affectionWellCared: 1,
  affectionAway: -1,
  affectionNeglect: -2,
  moodDecay: 0.3,
  moodInteract: 15,
  moodBondNegative: -15,
  moodWellCared: 5,
  moodCrisis: -20,
  moodAway: -5,
  moodVisitor: 8,
  textureEase: 0.05,
  ownerFeedFoodBoost: 35,
  feedStreakStep: 12,
  feedStreakMax: 75,
  rebirthTicks: 4,
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

  } else if (req.url.startsWith('/api/day-summaries')) {
    // 回顧用：不經 AI，直接從既有的每日紀錄檔取材，做成「那天發生了什麼」的簡短預覽。
    try {
      const dates = listDateKeys();
      const summaries = dates.map(d => {
        const day = readDay(d);
        const firstScene = (day.diary || []).find(e => e.scene)?.scene || '';
        const preview = firstScene ? firstScene.slice(0, 40).trim() + (firstScene.length > 40 ? '…' : '') : '';
        const visitorLog = day.visitorLog || [];
        const ownerLog = day.ownerLog || [];
        return {
          date: d,
          preview,
          visitorCount: visitorLog.length,
          visitorPreview: visitorLog.length ? visitorLog[0].message.slice(0, 24) : '',
          ownerCount: ownerLog.length,
          ownerPreview: ownerLog.length && ownerLog[0].action ? ownerLog[0].action.slice(0, 24) : ''
        };
      });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ summaries }));
    } catch (e) {
      res.writeHead(500);
      res.end('error');
    }

  } else if (req.url.startsWith('/api/fragments')) {
    // 筆記（黑影筆記）圖鑑：依「篇章（source）」分組，回傳每張碎片的收集狀態。
    // 未收集的不回傳 text，避免在圖鑑裡提前劇透；只有收集過才看得到全貌。
    try {
      const world = JSON.parse(fs.readFileSync(WORLD_FILE, 'utf8'));
      ensureFragmentsState(world);
      const collected = new Set(world.fragments.collected || []);
      const chapters = [];
      const bySource = {};
      for (const f of FRAGMENTS) {
        const src = f.source || '（未分類）';
        if (!bySource[src]) { bySource[src] = { source: src, total: 0, got: 0, items: [] }; chapters.push(bySource[src]); }
        const ch = bySource[src];
        const isGot = collected.has(f.id);
        ch.total++;
        if (isGot) ch.got++;
        ch.items.push({ id: f.id, label: f.label || '', collected: isGot, text: isGot ? f.text : null });
      }
      // 一張都沒收集的篇章，連篇名都不顯示（unlocked=false）。
      chapters.forEach(c => { c.unlocked = c.got > 0; });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ chapters, totalGot: collected.size, totalAll: FRAGMENTS.length }));
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

  } else if (req.url.startsWith('/api/tv')) {
    // 電視頻道：玩家點頻道時即時呼叫 Gemini 回一段短文字，不改世界狀態。
    const body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', async () => {
      try {
        const data = JSON.parse(Buffer.concat(body).toString() || '{}');
        const channel = ['nature', 'news', 'shopping'].includes(data.channel) ? data.channel : 'nature';
        const ctx = buildTvContext();
        const result = await callGemini(buildTvPrompt(channel, ctx), 280);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        if (result.error) {
          res.end(JSON.stringify({ ok: false, error: result.error, detail: result.detail || '' }));
        } else {
          res.end(JSON.stringify({ ok: true, channel, text: cleanTvText(result.text) }));
        }
      } catch (e) {
        res.writeHead(500);
        res.end('error');
      }
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
        writeWorldFile(world);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    } catch (e) {
      res.writeHead(500);
      res.end('error');
    }
} else if (req.url === '/api/owner-auth' && req.method === 'POST') {
    try {
      const body = [];
      req.on('data', chunk => body.push(chunk));
      req.on('end', () => {
        const data = JSON.parse(Buffer.concat(body).toString());
        const expected = process.env.OWNER_PANEL_PASSWORD;
        // 沒設密碼變數時不擋，方便本機開發；正式環境在 Railway Variables 設 OWNER_PANEL_PASSWORD 即會啟用密碼保護。
        const ok = !expected || data.password === expected;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok }));
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
        if (data.type === 'pause') world.paused = !!data.paused;
        let archivedTo = null;
        if (data.type === 'farewell_choice' && world.farewell && world.farewell.pending) {
          if (data.plant) {
            world.farewell = { pending: false, planted: true, spawned: false, spawnAt: Date.now() + 30 * 24 * 60 * 60 * 1000 };
            writeWorldFile(world);
          } else {
            // 不種＝放棄這份紀錄，重新開始：先把目前紀錄完整封存，再用種子檔重置 world.json。
            writeWorldFile(world);
            archivedTo = archiveAndResetWorld();
          }
        } else {
          writeWorldFile(world);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, archivedTo }));
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
        writeWorldFile(world);
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
        writeWorldFile(world);
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
        writeWorldFile(world);
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
        const VALID_NOTE_LOCATIONS = ['desk_leg', 'fridge_bottom', 'wall', 'floor', 'computer', 'custom'];
        const location = VALID_NOTE_LOCATIONS.includes(data.location) ? data.location : 'floor';
        const locationLabel = location === 'custom' ? (data.locationLabel || '').trim().slice(0, 12) : '';
        if (!message) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'empty message' }));
          return;
        }
        const world = JSON.parse(fs.readFileSync(WORLD_FILE, 'utf8'));
        const { display } = getRealTime();
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        world.visitor_messages = [...(world.visitor_messages || []), { id, name: name || '匿名訪客', message, time: display, color, location, locationLabel }];
        writeWorldFile(world);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, id }));
      });
    } catch (e) {
      res.writeHead(500);
      res.end('error');
    }

  } else if (req.url === '/api/reset' && req.method === 'POST') {
    try {
      const archivedTo = archiveAndResetWorld();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, archivedTo }));
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
      const allow = { 'system-prompt': 'system-prompt.json', 'fragments': 'fragments.json', 'events': 'events.json', 'balance': 'balance.json', 'hidden-stats': 'hidden-stats.json', 'lorebook': 'lorebook.json', 'actions': 'actions.json' };
      if (!allow[name]) { res.writeHead(404); res.end('not found'); return; }
      const content = fs.readFileSync(path.join(__dirname, 'data', allow[name]), 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(content);
    } catch (e) {
      res.writeHead(404);
      res.end('{}');
    }
  } else if (req.url.split('?')[0] === '/style.css' || req.url.split('?')[0] === '/app.js') {
    try {
      const file = req.url.split('?')[0].slice(1);
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

  if (world.paused) {
    // 時間停止：玩家手動凍結世界，不生成、不衰減、不呼叫 API。解除前一直保持原狀。
    const delay = getNextDelay();
    console.log(`時間停止中，跳過這次更新。下次檢查：${Math.round(delay/60000)} 分鐘後`);
    setTimeout(tick, delay);
    return;
  }

  if (world.farewell && world.farewell.pending) {
    // 永別事件卡已顯示，等飼主在前端選擇「種下蕈菇／不種」，這段時間世界暫停。
    const delay = getNextDelay();
    setTimeout(tick, delay);
    return;
  }

  if (world.farewell && world.farewell.planted && !world.farewell.spawned) {
    if (Date.now() >= (world.farewell.spawnAt || 0)) {
      world.farewell.spawned = true;
      world.characters.baituantuan = {
        ...world.characters.baituantuan,
        hp: 80, food: 80, fur: '正常', location: '床邊棉布', memory: []
      };
      world.characters.shadow = { ...world.characters.shadow, active: false };
      console.log('30 日後，陰影潮濕處出現了一隻小糰糰——遺形留蕈，重新開始。');
      writeWorldFile(world);
    }
  }

  const preDecay = { food: world.characters.baituantuan.food, hp: world.characters.baituantuan.hp };
  world = applyNaturalDecay(world);

  const { display } = getRealTime();
  let bt = world.characters.baituantuan;
  const decayFoodDelta = bt.food - preDecay.food;
  const decayHpDelta = bt.hp - preDecay.hp;

  // owner_action 只在第一次被 AI 讀到時納入 prompt；讀過一次就只是顯示用的唯讀文字，
  // 直到玩家送出新的一則才會再次變成「未讀」。
  const ownerActionUnread = !!world.owner_action && !world.owner_action_read;

  // 飽食加成的「有沒有吃」交給AI每輪判斷（result.fed），「加多少」固定由程式決定，
  // 套用時機放在拿到AI回應之後（見下方），避免巨怪持續餵食的多輪場景只在第一輪加到分。

  const ownerStatus = world.owner_status ? `巨怪狀態：${world.owner_status}` : '';
  const ownerAction = ownerActionUnread ? `巨怪對房間的行為：${world.owner_action}` : '';
  const ownerInput = (ownerStatus || ownerAction) ? '\n' + [ownerStatus, ownerAction].filter(Boolean).join('\n') : '';
  const awayInput = world.owner_away ? '\n巨怪現在外出不在房間（最棒的事正發生在沒人的時候）。' : '';

  const NOTE_LOCATION_DESC = {
    desk_leg: '貼在桌腳（低處，牠平常走動就會經過）',
    fridge_bottom: '貼在冰箱下方（低處，牠很常待在那附近）',
    floor: '貼在地板上（低處，牠隨時可能碰到、踩到或聞到）',
    wall: '貼在牆上（高處，除非牠自己爬上去否則不會注意到）',
    computer: '貼在電腦上（高處，除非牠自己爬上去否則不會注意到）',
  };
  const visitorMessages = world.visitor_messages || [];
  const visitorInput = visitorMessages.length > 0
    ? '\n訪客留言（白糰糰不懂上面寫什麼，留言對牠僅是一陣動靜或聲響。牠可能因此有反應：轉頭看一下、警戒、好奇湊近、被嚇到躲起來，也可能完全沒反應、自顧自做自己的事。低處的留言牠走動時會經過、踩到，可以自然帶到牠在紙片上留下小腳印（這就是牠看過、經過的記號）；高處的留言牠通常碰不到、不會注意到，除非牠自己爬上去）：\n' +
      visitorMessages.map(m => {
        const desc = m.location === 'custom' && m.locationLabel
          ? `貼在${m.locationLabel}（位置不確定，牠碰不碰得到看運氣）`
          : (NOTE_LOCATION_DESC[m.location] || NOTE_LOCATION_DESC.floor);
        return `${m.name || '匿名訪客'}：${m.message}（${desc}）`;
      }).join('\n')
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
    // 上一輪 AI 對「關係好壞」的判斷，這一輪才換算成好感（隱藏數值算在 AI 回應之前，故用上一輪結果）
    bond: world.last_bond || 'neutral',
    // 上一輪糰糰實際有沒有吃到東西（客觀疏忽保底用）
    fed: !!world.last_fed,
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

  // 小黑影好感（對糰糰）＝事件驅動：平時 0，糰糰死亡 -100（觸發報復循環），飛升 +1。
  if (typeof world.characters.shadow.affection !== 'number') world.characters.shadow.affection = 0;
  // 死亡狀態機：{ active, ticksLeft }。死亡後每個 tick 都是暗影復仇，倒數歸零時自動再生。
  if (!world.death || typeof world.death !== 'object') world.death = { active: false, ticksLeft: 0 };

  let triggeredEvent = detectTriggeredEvent(world, bt, combinedPlayerText); // ascension / observation / farewell / null
  if (world.death.active) {
    // 復仇期間：還有倒數就繼續復仇，最後一格改成再生事件並結束死亡。
    if (world.death.ticksLeft > 1) {
      world.death.ticksLeft -= 1;
      triggeredEvent = 'shadowRevenge';
    } else {
      world.death.ticksLeft = 0;
      world.death.active = false;
      world.characters.shadow.affection = 0; // 糰糰歸來，小黑影好感回到平時的 0
      triggeredEvent = 'rebirth';
    }
  } else if (bt.hp <= 0 && bt.food <= 0) {
    // 剛死亡：進入復仇倒數，小黑影好感砸到 -100。
    world.death = { active: true, ticksLeft: Math.max(1, balance.rebirthTicks) };
    world.characters.shadow.affection = -100;
    triggeredEvent = 'shadowRevenge';
  } else if (triggeredEvent === 'ascension') {
    world.characters.shadow.affection = (world.characters.shadow.affection || 0) + 1;
  }

  const eventCard = triggeredEvent ? getEventCard(triggeredEvent) : '';
  const eventInput = triggeredEvent ? '\n' + buildEventInput(triggeredEvent) : '';
  if (triggeredEvent) console.log(`特殊事件觸發：${triggeredEvent}（死亡倒數剩 ${world.death.ticksLeft}）`);

  // 健康/飽食完全由機制決定（衰減、餵食加成、特殊事件強制值），AI不再直接控制這兩個數字，
  // 只透過一句簡短狀態描述去理解該怎麼寫，避免被硬數值門檻卡住敘述。
  // 注意：vitalLine 必須用「觸發當下」的真實數值（例如歸零瀕死）來描述，讓AI寫出對應的危急/狂喜場景；
  // 強制值是給「這次事件結束後」的重生/復原狀態存檔用，順序顛倒會讓AI同時收到矛盾訊號（叙述死亡又被告知健康穩定）。
  // 觸發特殊事件時一律用內建的危急/狂喜句子（statGrid 是給日常波動用的，事件需要更強烈的固定敘述）。
  const customVitalLine = triggeredEvent ? null : getStatBandFor(bt.food, bt.hp);
  const vitalLine = customVitalLine || describeVital(bt.hp, bt.food);
  if (triggeredEvent === 'ascension') {
    world.characters.baituantuan = { ...bt, food: 50, hp: 120 };
    bt = world.characters.baituantuan;
  } else if (triggeredEvent === 'shadowRevenge') {
    world.characters.baituantuan = { ...bt, food: 60, hp: 60 };
    bt = world.characters.baituantuan;
  } else if (triggeredEvent === 'rebirth') {
    world.characters.baituantuan = { ...bt, food: 80, hp: 80 }; // 再生＝回到初始健康/飽食
    bt = world.characters.baituantuan;
  }

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
  const loreInput = buildLoreInput([combinedPlayerText, ...(bt.memory || []).slice(-3)].join(' '));

  // 行為籤：給一點具體靈感，避開最近用過的類型，不寫情緒，情緒交給 AI 自己從脈絡長出來。
  const recentActionTypes = (bt.actionLog || []).slice(-3);
  const actionTag = pickActionTag(recentActionTypes);
  const actionInput = `\n行為參考籤（僅供靈感、不是必須照寫，只是「牠做什麼」，不要直接套用情緒詞如「寂寞地」「開心地」，情緒讓場景自然帶出）：${actionTag.action}`;
  const acLabel = acNow.on
    ? `${acNow.broken ? '故障' : { cool: '冷氣', heat: '暖氣', fan: '送風', dry: '除濕' }[acNow.mode] || '冷氣'}${acNow.mode === 'fan' ? '' : acNow.temp + '℃'}`
    : '關';

  // 小黑影出沒條件：房間髒（清潔度<40）或環境暗（關燈／深夜 22:00-06:00），或死亡復仇期間。
  const roomDirty = (world.room.cleanliness ?? 100) < 40;
  const isDark = world.room.light_on === false || getRealTime().hour >= 22 || getRealTime().hour < 6;
  const shadowShouldAppear = !!world.death.active || roomDirty || isDark;
  const shadowInput = shadowShouldAppear && !world.death.active
    ? `\n小黑影現在從陰影裡出沒了（${roomDirty ? '房間髒亂' : ''}${roomDirty && isDark ? '又' : ''}${isDark ? '光線昏暗' : ''}，正是牠浮現的時機）。牠是躲在影子裡的另一個主角，不是背景。白糰糰一見到牠就會故意去招惹、找碴、跟牠摩擦——撲牠、踩牠、跟牠搶地盤或對峙，鬧出一段有來有往的小衝突。請把這段互動寫進敘述裡。`
    : '';

  const prompt = `當前時間：${display}
白糰糰目前狀態：${vitalLine} · 毛況:${bt.fur || '正常'} · 位置:${bt.location}
小黑影：${shadowShouldAppear ? '活躍' : '潛伏'} 位置:${world.characters.shadow.location} 灰塵:${world.characters.shadow.dust_count}
房間清潔度：${world.room.cleanliness}
窗戶：${world.room.window_open ? '開' : '關'} 冷氣：${acLabel} 燈：${world.room.light_on ? '開' : '關'} 廁所門：${world.room.toilet_open ? '開' : '關'}
巨怪對房間環境的描述：${world.room.env_desc || '無'}
今天已發生：${world.room.events_today.join('，') || '無'}
近期記憶：${(bt.memory || []).slice(-5).join(' / ') || '無'}（這只是延續性參考，不要被它的安靜基調綁住——白糰糰本來就靈動古怪、有自己的事要做，沒人理牠時也會主動找事做，不是發呆等待）${weatherInput}${climateInput}${shadowInput}${actionInput}${ownerInput}${awayInput}${visitorInput}${eventInput}${pendingNotesInput}${hiddenInput}${loreInput}

生成這段時間白糰糰的動態。`;

  const delay = getNextDelay();

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1400,
      temperature: 0.95,
      messages: [{ role: 'user', content: prompt }],
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral', ttl: '1h' } }]
    }, {
      headers: { 'anthropic-beta': 'extended-cache-ttl-2025-04-11' }
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

    // 「有沒有吃」交給AI（result.fed）判斷，「加多少」由程式決定，套在自然衰減之後的飽食值上。
    // 連續進食加權：連續好幾個 tick 都在吃，會越吃越快（狼吞虎嚥），玩家不必一直補食。
    // 一旦某輪沒吃，streak 歸零，下次重新從基礎量算起。
    const fedNow = !!result.fed;
    const feedStreak = fedNow ? (world.feed_streak || 0) + 1 : 0;
    const feedDelta = fedNow
      ? Math.min(balance.feedStreakMax, balance.ownerFeedFoodBoost + (feedStreak - 1) * balance.feedStreakStep)
      : 0;
    const finalFood = Math.min(100, bt.food + feedDelta);
    if (feedDelta > 0) console.log(`AI 判斷本輪有餵食（連續第 ${feedStreak} 輪），飽食 +${feedDelta} → ${finalFood}`);

    const mechanismLog = `自然衰減 飽食${decayFoodDelta >= 0 ? '+' : ''}${decayFoodDelta}/健康${decayHpDelta >= 0 ? '+' : ''}${decayHpDelta}、餵食 飽食${feedDelta >= 0 ? '+' : ''}${feedDelta}${fedNow ? `（連續第${feedStreak}輪）` : ''}`;

    const newWorld = {
      ...world,
      nextTickAt: Date.now() + delay,
      weather: weather || world.weather || null,
      // 記下這輪糰糰有沒有吃到，給下一輪客觀疏忽保底判斷用。
      last_fed: fedNow,
      // 連續進食輪數，給下一輪算進食加權用（沒吃會在上面歸零）。
      feed_streak: feedStreak,
      // 記下這輪 AI 對關係好壞的判斷，給下一輪換算好感／心情用。
      last_bond: ['positive', 'neutral', 'negative'].includes(result.bond) ? result.bond : 'neutral',
      tokenUsage,
      characters: {
        baituantuan: {
          ...world.characters.baituantuan,
          ...(({ hp, food, ...rest }) => rest)(result.baituantuan || {}),
          ...hidden,
          food: finalFood,
          nickname,
          texture,
          mood_color: moodColor ? { name: moodColor.name, color: moodColor.color } : null,
          memory: [...(bt.memory || []).slice(-10), result.scene],
          // 記下這輪用過的行為籤類型，下一輪挑籤時避開最近重複的類型。
          actionLog: [...(bt.actionLog || []).slice(-4), actionTag.type]
        },
        // 小黑影是躲在影子裡的另一個主角，出沒與否由環境決定，不交給 AI 自由設定：
        // 房間髒（清潔度低）或暗（關燈／深夜）牠就會從陰影裡浮現；死亡復仇期間必然活躍。
        // 這樣 active 才會真的對應敘述裡看得到的動靜，不會卡在 true 卻整段沒提到牠。
        shadow: { ...world.characters.shadow, ...(result.shadow || {}), active: shadowShouldAppear }
      },
      room: { ...world.room, ...result.room }
    };

    if (triggeredEvent === 'farewell') {
      newWorld.farewell = { ...(world.farewell || {}), pending: true };
    }

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

    writeWorldFile(newWorld);

    const furNote = result.baituantuan.fur && result.baituantuan.fur !== '正常'
      ? ` · ${result.baituantuan.fur}` : '';

    const finalBt = newWorld.characters.baituantuan;

    const entryWeather = newWorld.weather
      ? { desc: newWorld.weather.desc, temp: newWorld.weather.temp, humidity: newWorld.weather.humidity }
      : null;

    appendToDay(todayKey, 'diary', [{
      time: display,
      scene: result.scene,
      hp: finalBt.hp,
      food: finalBt.food,
      location: result.baituantuan.location,
      fur: result.baituantuan.fur && result.baituantuan.fur !== '正常' ? result.baituantuan.fur : null,
      // 回顧頁狀態卡：客觀環境（天氣）＋居家狀況（房間），從今天起逐日記錄；過去日無此欄會留空。
      weather: entryWeather,
      room: roomBrief(newWorld.room),
      shadowActive: !!result.shadow.active,
      // 特殊事件的腳本卡：主頁會用特殊框原文顯示在 AI 續寫的 scene 之前。
      eventKey: triggeredEvent || null,
      eventCard: eventCard || null,
      mechanismLog: triggeredEvent ? `特殊事件強制設值，不走一般機制` : mechanismLog,
      tokens: { input: usage.input_tokens || 0, output: usage.output_tokens || 0 }
    }]);

    console.log(`【${display}】\n${result.scene}\n健康 ${finalBt.hp} · 飽食 ${finalBt.food}${furNote} · ${result.baituantuan.location}\n${result.shadow.active ? '⚠️ 小黑影出沒中' : ''}\n機制：${mechanismLog}\ntoken：本次input${usage.input_tokens || 0}/output${usage.output_tokens || 0} · 累計input${tokenUsage.inputTokens}/output${tokenUsage.outputTokens}（共${tokenUsage.calls}次）`);

  } catch (e) {
    console.error('錯誤：', e.message);
    // world.json 萬一損毀，這裡重讀也會炸；退回 tick 開頭讀到的 world，至少能把 nextTickAt 寫回去續命。
    let world2;
    try {
      world2 = JSON.parse(fs.readFileSync(WORLD_FILE, 'utf8'));
    } catch (readErr) {
      console.error('world.json 讀取/解析失敗，改用記憶體中的版本回寫：', readErr.message);
      world2 = world;
    }
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

    writeWorldFile(world2);
  }
console.log(`下次更新：${Math.round(delay/60000)} 分鐘後（${new Date(Date.now()+delay).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})}）`);

  setTimeout(tick, delay);
}

ensureWorldFile();
migrateLegacyLogs();
tick();
console.log('白糰糰宇宙啟動中...');