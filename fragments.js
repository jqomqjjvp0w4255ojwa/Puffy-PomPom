// 黑影紙片蒐集系統 — 紙片資料
// =====================================================================
// 這個檔案是「模板」也是「資料來源」：你把隨筆切成一段段填進來，
// 之後 world.js（後台偵測）與前端（顯示）都讀這份資料，全程不經過 AI，
// 所以不管累積多少張紙片都不會增加任何 token 花費。
//
// 每一張紙片的欄位：
//   id              唯一代號，不能重複（建議：來源縮寫-編號，例：huangdan-01）
//   source          來自哪一篇（之後筆記面板會用這個分組）
//   label           段落小標，可省略（例：今日哲學、頁三、觀察紀錄）
//   text            紙片上實際顯示的字（幾十字內最好，這就是玩家會看到的內容）
//   scene_keywords  白糰糰日記 scene 裡出現哪些字會嘗試觸發這張（陣列，命中任一個就算）
//   player_keywords 玩家輸入（狀態／動態／留言）裡出現哪些字會嘗試觸發（可留空陣列）
//   match           "or"  = scene 或 player 命中其一就嘗試（預設、較容易觸發）
//                   "and" = scene 跟 player 都要命中才嘗試（較稀有、需要剛好對上）
//   probability     關鍵字命中後，真正掉落的機率（0~1，例：0.25 = 兩成五）
//
// 觸發流程（後台）：scene/玩家文字符合 keywords → 擲一次 probability →
//   命中就把這張 id 丟進「待領取」，前端跳出碎紙片讓你選 丟棄／收起。
//   已經收進筆記的紙片不會再次掉落；丟棄的紙片未來還能再次掉落。
// =====================================================================

const FRAGMENTS = [
  // ---- 已填好的範例（你可以照這個格式繼續加，或直接改掉）----
  {
    id: 'huangdan-01',
    source: '《小黑影的荒誕紙片》',
    label: '今日哲學',
    text: '灰塵越多，真相越模糊。這不是比喻，是策略。',
    scene_keywords: ['灰塵', '髒', '塵'],
    player_keywords: [],
    match: 'or',
    probability: 0.25
  },
  {
    id: 'huangdan-02',
    source: '《小黑影的荒誕紙片》',
    label: '觀察紀錄：白糰糰',
    text: '他跳舞那次，有一根毛掉進我裡面。',
    scene_keywords: ['跳舞', '戰鬥舞', '街舞'],
    player_keywords: [],
    match: 'or',
    probability: 0.3
  },
  {
    id: 'shouzha-03',
    source: '《小黑影的影子手札》',
    label: '頁三｜白糰糰觀察錄',
    text: '他會拔那根竹籤像在念咒，但我從來沒看他真的刺過誰。',
    scene_keywords: ['竹籤'],
    player_keywords: ['竹籤', '武器', '籤'],
    match: 'and',
    probability: 0.3
  },

  // ---- 空白模板：複製下面這塊，填好後把開頭結尾的 /* */ 拿掉 ----
  /*
  {
    id: '',
    source: '',
    label: '',
    text: '',
    scene_keywords: [],
    player_keywords: [],
    match: 'or',
    probability: 0.25
  },
  */
];

// 後台偵測：傳入這次日記的 scene 文字、玩家相關文字、以及已收集的 id 清單，
// 回傳這次「命中」的紙片陣列（通常 0 或 1 張）。純程式碼，不呼叫 AI。
function matchFragments(sceneText, playerText, collectedIds) {
  const scene = sceneText || '';
  const player = playerText || '';
  const collected = collectedIds || [];
  const hits = [];

  for (const f of FRAGMENTS) {
    if (!f.id || collected.includes(f.id)) continue;

    const sceneHit = (f.scene_keywords || []).some(k => k && scene.includes(k));
    const playerHit = (f.player_keywords || []).some(k => k && player.includes(k));

    const keywordHit = f.match === 'and' ? (sceneHit && playerHit) : (sceneHit || playerHit);
    if (!keywordHit) continue;

    if (Math.random() < (f.probability ?? 0)) hits.push(f);
  }
  return hits;
}

module.exports = { FRAGMENTS, matchFragments };
