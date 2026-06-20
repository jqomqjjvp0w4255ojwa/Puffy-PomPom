/**
 * 糰糰隱藏數值實驗室 — Google Apps Script 後端
 *
 * 用途：讓 trait-lab.html 把資料存到一份 Google Sheet，這樣換裝置、清快取
 * 都不會丟資料，而且妳隨時可以打開那份 Sheet 直接看/改/匯出 CSV。
 *
 * 設定步驟（一次性）：
 * 1. 開一份新的 Google Sheet（隨便取名，例如「糰糰實驗室資料」）。
 * 2. 選單「擴充功能」→「Apps Script」，打開腳本編輯器。
 * 3. 把編輯器裡原本的內容全部刪掉，貼上這個檔案全部的程式碼。
 * 4. 上方選單「部署」→「新增部署作業」：
 *    - 類型選「網頁應用程式」
 *    - 「具有應用程式存取權的使用者」選「任何人」
 *    - 「執行身份」選「我」
 *    - 按「部署」，第一次會要求授權，照著按「允許」就好
 * 5. 部署完成後會給妳一個網址（結尾是 /exec），那就是要貼回
 *    trait-lab.html 上方「同步設定」欄位的網址。
 * 6. 之後妳改了程式碼想更新，要再「管理部署作業」→ 編輯 → 部署新版本，
 *    網址不會變，不用重新貼。
 *
 * 資料格式：整份資料（暱稱表／質地表／心情色彩表）會整包存成一個 JSON
 * 字串，放在「TraitLabData」分頁的 A1 格。妳平常不用管這格，工具會自己讀寫。
 * 如果想要更「電子表格」感的呈現，之後可以請我再加一個把 JSON 展開成
 * 一般表格列的版本。
 */

const SHEET_NAME = 'TraitLabData';

function getOrCreateSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  return sheet;
}

function doGet(e) {
  const sheet = getOrCreateSheet_();
  const json = sheet.getRange('A1').getValue();
  return ContentService.createTextOutput(json || '{}').setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const sheet = getOrCreateSheet_();
  const body = (e && e.postData && e.postData.contents) || '{}';
  // 簡單驗證一下是合法 JSON，壞資料就不要寫進去蓋掉舊的
  try {
    JSON.parse(body);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'invalid json' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  sheet.getRange('A1').setValue(body);
  sheet.getRange('B1').setValue(new Date().toISOString());
  return ContentService.createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
