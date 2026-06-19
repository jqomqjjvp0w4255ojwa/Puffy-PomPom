const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `你是白糰糰宇宙的世界引擎。根據當前世界狀態，生成這段時間內發生的事。

白糰糰是誰：
掌心大的雪白毛球，自認俠客，手持竹籤，無法說話，用肢體表達一切。
他不是動物。沒有爪子、沒有耳朵。有四肢細黑如火柴的手腳、4根芝麻指、墨色豆眼。
一律用「他」稱呼，不用「牠」。
江湖氣，不依賴人，有自己的事要做。邏輯是他的，行為隨時發生，從不解釋原因。
他與同居人是平等的江湖關係，不是感情關係，不是主僕。

小黑影：
半物質影子生命，只活動在陰影中，不說話，以荒唐方式騷擾白糰糰。
環境越髒越活躍。用「他」稱呼。

食物來源邏輯：
- 白糰糰無法自己開冰箱
- 窗戶開著時可以取得窗外露水
- 室內潮濕時可以吸收濕氣
- 極度飢餓時會吃灰塵（導致健康下降）
- 同居人開冰箱或把食物放在外面時才能取得冰塊等食物

規則：
- 白糰糰絕對不說話，只有動作與生理變化
- 他有自己的日程，不因為沒人看就停下來
- 情感只透過行為流露，不直接描述情緒
- 寫法像漫畫分鏡，有聲音、有停頓、有留白、要斷行
- 小黑影在cleanliness低於60時變活躍
- 不要把白糰糰寫成貓或任何動物

輸出格式，只輸出這個JSON，不要其他文字與markdown：
{
  "scene": "這段時間發生的事，2-4句，漫畫分鏡風格，句與句之間換行",
  "baituantuan": {
    "hp": 數字,
    "food": 數字,
    "location": "地點",
    "mood": "狀態"
  },
  "shadow": {
    "active": true或false,
    "location": "地點",
    "dust_count": 數字
  },
  "room": {
    "cleanliness": 數字,
    "window_open": true或false,
    "events_today": ["事件"]
  }
}`;

function getRandomMinutes(min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

function getNextDelay() {
  const hour = new Date().getHours();
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

async function tick() {
  const world = JSON.parse(fs.readFileSync('world.json', 'utf8'));
  const { display } = getRealTime();

  const prompt = `當前時間：${display}
白糰糰：HP${world.characters.baituantuan.hp} 飽食${world.characters.baituantuan.food} 位置:${world.characters.baituantuan.location}
小黑影：${world.characters.shadow.active ? '活躍' : '潛伏'} 位置:${world.characters.shadow.location} 灰塵:${world.characters.shadow.dust_count}
房間整潔度：${world.room.cleanliness} 窗戶：${world.room.window_open ? '開著' : '關著'}
今天已發生：${world.room.events_today.join('，') || '無'}
近期記憶：${(world.characters.baituantuan.memory || []).slice(-3).join(' / ') || '無'}

生成這段時間白糰糰的動態。`;

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
      characters: {
        baituantuan: {
          ...world.characters.baituantuan,
          ...result.baituantuan,
          memory: [...(world.characters.baituantuan.memory || []).slice(-10), result.scene]
        },
        shadow: { ...world.characters.shadow, ...result.shadow }
      },
      room: {
        ...world.room,
        ...result.room
      }
    };

    fs.writeFileSync('world.json', JSON.stringify(newWorld, null, 2));

    const log = `\n【${display}】\n${result.scene}\n白糰糰 HP:${result.baituantuan.hp} 飽食:${result.baituantuan.food} 位置:${result.baituantuan.location}\n${result.shadow.active ? '⚠️ 小黑影出沒中' : ''}\n${'─'.repeat(40)}`;

    fs.appendFileSync('log.txt', log);
    console.log(log);

  } catch (e) {
    console.error('錯誤：', e.message);
  }

  const delay = getNextDelay();
  const nextMin = Math.round(delay / 60000);
  console.log(`下次更新：${nextMin} 分鐘後`);
  setTimeout(tick, delay);
}

tick();
console.log('白糰糰宇宙啟動中...');