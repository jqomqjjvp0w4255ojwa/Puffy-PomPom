const http = require('http');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `你是白糰糰宇宙的世界引擎。根據當前世界狀態，生成這段時間內發生的事。

白糰糰是誰：
掌心大的雪白毛球，自認俠客，手持竹籤，無法說話，用肢體表達一切。
他不是動物。沒有爪子、沒有耳朵。有四肢細黑如火柴的手腳、4根芝麻指、墨色豆眼。
一律用「他」稱呼，不用「牠」。
江湖氣，不依賴人，有自己的事要做。邏輯是他的，行為隨時發生，從不解釋原因。
他與同居人是平等的江湖關係，不是感情關係，不是主僕。

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
    "fur": "正常或髒污或禿塊描述"
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
      const world = JSON.parse(fs.readFileSync('world.json', 'utf8'));
      const logContent = fs.existsSync('log.txt') ? fs.readFileSync('log.txt', 'utf8') : '';
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ world, log: logContent }));
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
        const world = JSON.parse(fs.readFileSync('world.json', 'utf8'));
        world.room = { ...world.room, ...data };
        fs.writeFileSync('world.json', JSON.stringify(world, null, 2));
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
        const world = JSON.parse(fs.readFileSync('world.json', 'utf8'));
        if (data.type === 'status') world.owner_status = data.input || '';
        if (data.type === 'action') world.owner_action = data.input || '';
        fs.writeFileSync('world.json', JSON.stringify(world, null, 2));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
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
  } else {
    res.writeHead(404);
    res.end('not found');
  }
});

server.listen(process.env.PORT || 3000, () => {
  console.log(`伺服器啟動，port ${process.env.PORT || 3000}`);
});

async function tick() {
  let world = JSON.parse(fs.readFileSync('world.json', 'utf8'));
  world = applyNaturalDecay(world);

  const { display } = getRealTime();
  const bt = world.characters.baituantuan;

  const ownerStatus = world.owner_status ? `同居人狀態：${world.owner_status}` : '';
  const ownerAction = world.owner_action ? `同居人對房間的行為：${world.owner_action}` : '';
  const ownerInput = (ownerStatus || ownerAction) ? '\n' + [ownerStatus, ownerAction].filter(Boolean).join('\n') : '';

  const prompt = `當前時間：${display}
白糰糰：健康${bt.hp} 飽食${bt.food} 毛況:${bt.fur || '正常'} 位置:${bt.location}
小黑影：${world.characters.shadow.active ? '活躍' : '潛伏'} 位置:${world.characters.shadow.location} 灰塵:${world.characters.shadow.dust_count}
房間清潔度：${world.room.cleanliness}
窗戶：${world.room.window_open ? '開' : '關'} 冷氣：${world.room.ac_on ? '開' : '關'} 燈：${world.room.light_on ? '開' : '關'} 廁所門：${world.room.toilet_open ? '開' : '關'}
今天已發生：${world.room.events_today.join('，') || '無'}
近期記憶：${(bt.memory || []).slice(-3).join(' / ') || '無'}${ownerInput}

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

    if (world.owner_action) {
      newWorld.owner_log = [...(world.owner_log || []).slice(-20), {
        time: display,
        status: world.owner_status || '',
        action: world.owner_action
      }];
      newWorld.owner_action = '';
    }
    fs.writeFileSync('world.json', JSON.stringify(newWorld, null, 2));

    const furNote = result.baituantuan.fur && result.baituantuan.fur !== '正常'
      ? ` · ${result.baituantuan.fur}` : '';
    const log = `\n【${display}】\n${result.scene}\n健康 ${result.baituantuan.hp} · 飽食 ${result.baituantuan.food}${furNote} · ${result.baituantuan.location}\n${result.shadow.active ? '⚠️ 小黑影出沒中' : ''}\n${'─'.repeat(40)}`;

    fs.appendFileSync('log.txt', log);
    console.log(log);

  } catch (e) {
    console.error('錯誤：', e.message);
    const world2 = JSON.parse(fs.readFileSync('world.json', 'utf8'));
    world2.nextTickAt = Date.now() + delay;
    fs.writeFileSync('world.json', JSON.stringify(world2, null, 2));
  }
console.log(`下次更新：${Math.round(delay/60000)} 分鐘後（${new Date(Date.now()+delay).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})}）`);

  setTimeout(tick, delay);
}

tick();
console.log('白糰糰宇宙啟動中...');