const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `你是白糰糰宇宙的世界引擎。根據當前世界狀態，生成接下來15分鐘內發生的事。

白糰糰是誰：掌心大的雪白毛球，自認俠客，手持竹籤，不說話，用肢體表達一切。江湖氣，不依賴人，有自己的事要做。牠的邏輯是牠自己的，行為隨時發生，從不解釋原因。

小黑影：半物質影子生命，只活動在陰影中，以荒唐方式騷擾白糰糰，環境越髒越活躍。

規則：
- 白糰糰絕對不說話，只有動作與生理變化
- 牠有自己的日程，不因為沒人看就停下來
- 情感只透過行為流露，不直接描述情緒
- 寫法像漫畫分鏡，有聲音有停頓有留白
- 小黑影在cleanliness低於60時變活躍
- 白糰糰與同居人是江湖關係，不是感情關係

輸出格式，只輸出這個JSON，不要其他文字：
{
  "scene": "這段時間發生的事，2-4句，漫畫分鏡風格",
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
    "events_today": ["事件"]
  },
  "time": "下一個時間點"
}`;

async function tick() {
  const world = JSON.parse(fs.readFileSync('world.json', 'utf8'));
  
  const prompt = `當前世界狀態：
第${world.day}天 ${world.time} ${world.weather} ${world.temp}℃
白糰糰：HP${world.characters.baituantuan.hp} 飽食${world.characters.baituantuan.food} 位置:${world.characters.baituantuan.location} 持有:${world.characters.baituantuan.inventory.join(',')}
小黑影：${world.characters.shadow.active ? '活躍' : '潛伏'} 位置:${world.characters.shadow.location} 灰塵:${world.characters.shadow.dust_count}
房間整潔度：${world.room.cleanliness}
今天已發生：${world.room.events_today.join('，') || '無'}
近期記憶：${(world.characters.baituantuan.memory || []).slice(-3).join(' / ') || '無'}

生成接下來15分鐘發生的事。`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
      system: SYSTEM_PROMPT
    });

    let text = response.content[0].text.trim();
text = text.replace(/^```json\s*/,'').replace(/```\s*$/,'');
const result = JSON.parse(text);
    
    const newWorld = {
      day: world.day,
      time: result.time,
      weather: world.weather,
      temp: world.temp,
      characters: {
        baituantuan: {
          ...world.characters.baituantuan,
          ...result.baituantuan,
          memory: [...(world.characters.baituantuan.memory || []).slice(-10), result.scene]
        },
        shadow: { ...world.characters.shadow, ...result.shadow }
      },
      room: result.room
    };

    fs.writeFileSync('world.json', JSON.stringify(newWorld, null, 2));

    const log = `\n【第${world.day}天 ${world.time}】\n${result.scene}\n白糰糰 HP:${result.baituantuan.hp} 飽食:${result.baituantuan.food} 位置:${result.baituantuan.location}\n${result.shadow.active ? '⚠️ 小黑影出沒中' : ''}\n${'─'.repeat(40)}`;
    
    fs.appendFileSync('log.txt', log);
    console.log(log);

  } catch (e) {
    console.error('錯誤：', e.message);
  }
}

tick();
setInterval(tick, 15 * 60 * 1000);
console.log('Puffy_PomPom 世界啟動，每15分鐘更新一次...');