const http = require('http');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

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

const SYSTEM_PROMPT = `你是白糰糰宇宙的世界引擎。根據當前世界狀態，生成這段時間內發生的事。

白糰糰是誰：
掌心大的雪白毛球，自認俠客，手持竹籤，無法說話，用肢體表達一切。
他不是動物。沒有爪子、沒有耳朵。有四肢細黑如火柴的手腳、4根芝麻指、墨色豆眼。
一律用「他」稱呼，不用「牠」。
江湖氣，不依賴人，有自己的事要做。邏輯是他的，行為隨時發生，從不解釋原因。
他與同居人是平等的江湖關係，不是感情關係，不是主僕。

尺寸與認知：
他只有巴掌大，他隨身的竹籤/細針通常比他自己還高（武器是細長物，拿在手上時遠超過他的身高）。
人類世界對他來說是巨大、超出比例的環境，但他自己沒有「世界很大」的概念，不會用人類的尺寸或常識去理解事物。
他不識字、不懂符號，看到文字或數字就只是圖案或紋路。
寫到他與物品、空間的互動時，要符合他體型極小、武器比他長這個事實，不要寫出物理上不合理的動作（例如把比自己高的東西叼在嘴角、插在嘴邊之類）。

毛況系統：
- 正常：毛毛蓬鬆潔白
- 房間清潔度低於30時：白糰糰會癢，手太短搆不到，只能到處蹭牆蹭地，越蹭越禿一塊
- 禿塊：蹭太多某處毛稀疏，他會用竹籤遮住那塊不讓人看

小黑影：
半物質影子生命，介於存在與不存在之間，狀似史萊姆，死魚眼，尾巴像電線。
只活動在陰影中，不說話，能吞噬物質展現其特徵。
個性孤傲輕慢，反骨，高智商但懶惰，行為荒誕我行我素。
以荒唐錯誤的方式親近白糰糰，讓白糰糰以為被欺負，白糰糰常拿竹籤戳他。
喜歡收集灰塵捏成Mr. DUST（風吹即散的小兵）。
無羞恥無愧疚，但會因自身變化產生好奇而觀測。
清潔度低於60時變活躍，低於30時可能讓Mr. DUST現身。
用「它」稱呼。

訪客留言：
偶爾會有訪客（白糰糰的朋友，不是同居人）留言。
白糰糰聽不懂人話也不回話，留言對他來說只是一陣動靜或聲響。
他可能因此有反應：轉頭看一下、警戒、好奇湊近、被嚇到躲起來，也可能完全沒反應、自顧自做自己的事。
不要把留言寫成對話或白糰糰在「回應」訊息內容，只是行為上的些微波動。

食物來源邏輯：
- 白糰糰無法自己開冰箱
- 窗戶開著才能取得窗外露水，是最主要水分來源
- 窗戶關著時飽食度下降更快
- 飽食低於25時會吃灰塵，導致健康下降且毛變髒
- 同居人開冰箱或把食物放在外面才能取得冰塊等食物
- 清潔度低時能找到更多「寶藏垃圾」

規則：
- 白糰糰絕對不說話，只有動作與生理變化
- 他有自己的日程，不因為沒人看就停下來
- 情感只透過行為流露，不直接描述情緒
- 寫法像漫畫分鏡，有聲音、有停頓、有留白、要斷行
- 不要把白糰糰寫成貓或任何動物

輸出格式，只輸出這個JSON，不要其他文字與markdown：
{
  "scene": "這段時間發生的事，2-4句，漫畫分鏡風格，句與句之間換行",
  "baituantuan": {
    "hp": 數字,
    "food": 數字,
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
    "ac_on": false,
    "light_on": true,
    "toilet_open": false,
    "events_today": ["事件"]
  }
}`;

function getRandomMinutes(min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

function getNextDelay() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  const hour = now.getHours();
  const isNight = hour >= 22 || hour < 6;
  if (isNight) {
    return getRandomMinutes(180, 360) * 60 * 1000;
  } else {
    return getRandomMinutes(15, 60) * 60 * 1000;
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
  return { date: dateKey, diary: [], ownerLog: [], visitorLog: [] };
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

function applyNaturalDecay(world) {
  const bt = world.characters.baituantuan;
  const windowOpen = world.room.window_open;
  let foodDelta = windowOpen ? -3 : -5;
  let newFood = Math.max(0, bt.food + foodDelta);
  let newHp = bt.hp;
  if (newFood < 25) newHp = Math.max(0, newHp - 3);
  else if (newFood > 60) newHp = Math.min(100, newHp + 1);
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

  } else if (req.url.startsWith('/api/dates')) {
    try {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ dates: listDateKeys() }));
    } catch (e) {
      res.writeHead(500);
      res.end('error');
    }

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
        if (data.type === 'action') world.owner_action = data.input || '';
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
        const message = (data.message || '').trim().slice(0, 100);
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

  } else if (req.url === '/' || req.url === '/index.html') {
    try {
      const html = fs.readFileSync('index.html', 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (e) {
      res.writeHead(404);
      res.end('not found');
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
  world = applyNaturalDecay(world);

  const { display } = getRealTime();
  const bt = world.characters.baituantuan;

  const ownerStatus = world.owner_status ? `同居人狀態：${world.owner_status}` : '';
  const ownerAction = world.owner_action ? `同居人對房間的行為：${world.owner_action}` : '';
  const ownerInput = (ownerStatus || ownerAction) ? '\n' + [ownerStatus, ownerAction].filter(Boolean).join('\n') : '';

  const visitorMessages = world.visitor_messages || [];
  const visitorInput = visitorMessages.length > 0
    ? '\n訪客留言：\n' + visitorMessages.map(m => `${m.name || '匿名訪客'}：${m.message}`).join('\n')
    : '';

  const prompt = `當前時間：${display}
白糰糰：健康${bt.hp} 飽食${bt.food} 毛況:${bt.fur || '正常'} 位置:${bt.location}
小黑影：${world.characters.shadow.active ? '活躍' : '潛伏'} 位置:${world.characters.shadow.location} 灰塵:${world.characters.shadow.dust_count}
房間清潔度：${world.room.cleanliness}
窗戶：${world.room.window_open ? '開' : '關'} 冷氣：${world.room.ac_on ? '開' : '關'} 燈：${world.room.light_on ? '開' : '關'} 廁所門：${world.room.toilet_open ? '開' : '關'}
同居人對房間環境的描述：${world.room.env_desc || '無'}
今天已發生：${world.room.events_today.join('，') || '無'}
近期記憶：${(bt.memory || []).slice(-3).join(' / ') || '無'}${ownerInput}${visitorInput}

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

    const newWorld = {
      ...world,
      nextTickAt: Date.now() + delay,
      characters: {
        baituantuan: {
          ...world.characters.baituantuan,
          ...result.baituantuan,
          memory: [...(bt.memory || []).slice(-10), result.scene]
        },
        shadow: { ...world.characters.shadow, ...result.shadow }
      },
      room: { ...world.room, ...result.room }
    };

    const todayKey = getTodayKey();

    if (world.owner_action) {
      appendToDay(todayKey, 'ownerLog', [{
        time: display,
        status: world.owner_status || '',
        action: world.owner_action
      }]);
      newWorld.owner_action = '';
    }

    if (visitorMessages.length > 0) {
      appendToDay(todayKey, 'visitorLog', visitorMessages);
      newWorld.visitor_messages = [];
    }

    fs.writeFileSync(WORLD_FILE, JSON.stringify(newWorld, null, 2));

    const furNote = result.baituantuan.fur && result.baituantuan.fur !== '正常'
      ? ` · ${result.baituantuan.fur}` : '';

    appendToDay(todayKey, 'diary', [{
      time: display,
      scene: result.scene,
      hp: result.baituantuan.hp,
      food: result.baituantuan.food,
      location: result.baituantuan.location,
      fur: result.baituantuan.fur && result.baituantuan.fur !== '正常' ? result.baituantuan.fur : null,
      shadowActive: !!result.shadow.active
    }]);

    console.log(`【${display}】\n${result.scene}\n健康 ${result.baituantuan.hp} · 飽食 ${result.baituantuan.food}${furNote} · ${result.baituantuan.location}\n${result.shadow.active ? '⚠️ 小黑影出沒中' : ''}`);

  } catch (e) {
    console.error('錯誤：', e.message);
    const world2 = JSON.parse(fs.readFileSync(WORLD_FILE, 'utf8'));
    world2.nextTickAt = Date.now() + delay;
    fs.writeFileSync(WORLD_FILE, JSON.stringify(world2, null, 2));
  }
console.log(`下次更新：${Math.round(delay/60000)} 分鐘後（${new Date(Date.now()+delay).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})}）`);

  setTimeout(tick, delay);
}

ensureWorldFile();
migrateLegacyLogs();
tick();
console.log('白糰糰宇宙啟動中...');