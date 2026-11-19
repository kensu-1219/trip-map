# 🗺️ 旅遊地圖 Trip Map

出國旅遊用的行程地圖：把想去的地點放上地圖，看點與點之間的距離、各種交通方式要花多久，並自動排成每天的行程。

**網址：<https://kensu-1219.github.io/trip-map/>**
iPhone 用 Safari 打開 → 分享 → **加入主畫面**，之後就像 App 一樣使用。

- 不用註冊、不用安裝、不用金鑰就能用
- 資料存在你自己的手機上（可另外開雲端同步）
- 同事拿網址就能用，完全不用碰命令列

---

## 功能

| 分頁 | 做什麼 |
|---|---|
| 🗓️ 行程 | 設定天數、出發日、住宿 → **✨ 自動排行程**：依遠近分成每天一群，排出最順的拜訪順序。每段路可切換 🚶步行／🚲單車／🚗開車／🚇大眾運輸，並顯示時間與距離，按「導航」直接開 Google Maps |
| 📍 地點 | 所有地點清單、篩選、編輯備註／停留時間、刪除 |
| ➕ 新增 | 貼上 Google Maps 連結（可一次貼多行）、座標、地名搜尋、在地圖上點選、**匯入 Google 已儲存清單** |
| 📏 量距離 | 任選兩點（或「我的位置」、地圖上任一點），同時算出四種交通方式的時間、距離與直線距離 |
| 📤 分享 | 產生行程連結傳給同行的人、下載／匯入 .json 備份、開啟多人即時同步 |

**小技巧**
- 手動把地點移到別天時，它會自動 🔒 鎖定，之後再按「自動排行程」也不會被移走
- 地圖上點任一個標記 →「從這裡量／量到這裡」
- 看過的地圖會留在手機裡，到國外沒網路時，那些範圍還看得到
- 電腦版可以直接把檔案拖進視窗匯入

## 把 Google Maps 存的地點整批匯入

1. 用電腦打開 <https://takeout.google.com/>，先按「**取消全選**」
2. 只勾選 **「已儲存」**（各清單的 .csv，例如「想去的地點」）和 **「地圖（你的地點）」**（已加星號，.json）
3. 建立匯出 → 下載 zip → 解壓縮
4. 在工具的「➕ 新增 → 選擇檔案」選 .csv 或 .json（可一次選多個）

> Google 匯出的 .csv **沒有座標**，工具會用地名自動查（每秒約 1 個）。查不到的會列出來，可以手動搜尋。填了 Google 金鑰會查得更準。
> Google「我的地圖」（My Maps）：選單 → 匯出為 KML/KMZ → 勾「匯出為 KML」。

**手機分享的 `maps.app.goo.gl` 短網址**：網址本身看不到座標，工具會改用分享文字裡的店名／地址搜尋。想要最準的話，用 Safari 打開短網址，等它跳轉成完整網址後，再從網址列複製。

---

## Google 金鑰（選填）

不填也能用：步行、單車、開車都是實際路線，大眾運輸則用估算，並提供一鍵開 Google Maps 查班次。
填了以後，**大眾運輸會顯示實際轉乘**（例如 🚶4分 › 🚇銀座線 淺草→上野（4站）），地名搜尋也更準。

**費用**：Google 每個月有免費額度（每項功能 5,000～10,000 次），個人旅遊用不完。但申請時仍要綁信用卡，所以請照下面做好**限制**，以防萬一。

1. 到 <https://console.cloud.google.com/> → 建立專案（名稱隨意，例如 trip-map）
2. 依提示設定帳單（綁卡）
3. 左上選單 → API 和服務 → 程式庫，搜尋並**啟用**：
   - **Routes API**
   - **Places API (New)**
4. API 和服務 → 憑證 → 建立憑證 → **API 金鑰**
5. 點進這把金鑰，設定限制（**很重要**）：
   - 應用程式限制：選「**網站**」，新增 `https://kensu-1219.github.io/*`
   - API 限制：選「限制金鑰」，只勾 Routes API、Places API (New)
6. 設定**每日上限**（被盜用也不會爆）：API 和服務 → 已啟用的 API → Routes API → 配額 → 把「Compute Routes requests per day」改成 `300`；Places API (New) 的「Text Search requests per day」改成 `200`
7. （建議）帳單 → 預算與快訊 → 設一個 US$1 的預算通知
8. 把金鑰貼進工具的 ⚙️ 設定 → 按「測試」，看到 ✅ 就完成了

## Firebase 同步（選填）

不設定時，資料只在你這台裝置上，可以用分享連結或備份檔給別人。
設定後，你和同行的人會**即時共用同一份行程**：任何人修改，大家的畫面都會更新。大約 10 分鐘，全程點網頁。

1. 到 <https://console.firebase.google.com/> 用 Google 帳號登入 → **新增專案**（不需要 Google Analytics）
2. 左側「建構」→ **Authentication** → 開始使用 → 登入方式 → 啟用「**匿名**」
3. 左側「建構」→ **Firestore Database** → 建立資料庫 → 位置選 `asia-east1`（台灣）→ 以**正式版模式**開始
4. Firestore 的「**規則**」分頁，整段換成下面這段後按「發布」：
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /trips/{tripId} {
         allow read, write: if request.auth != null
           && (request.resource == null || request.resource.size() < 900000);
       }
     }
   }
   ```
5. 專案總覽旁的齒輪 → 專案設定 → 「你的應用程式」→ 按 **</>（網頁）** → 名稱隨意 → 註冊
6. 畫面會出現一段 `const firebaseConfig = { apiKey: "...", ... };`，**整段複製**
7. 貼到工具的 ⚙️ 設定 →「Firebase 設定」→ 儲存
8. 📤 分享 → **☁️ 開啟這趟旅程的即時同步** → 把「共同編輯連結」傳給同行的人

> Firebase 免費方案（Spark）每天可讀 5 萬次、寫 2 萬次，旅遊用綽綽有餘，**不用綁卡**。
> 隱私：行程的代碼是 16 碼亂數，只有拿到連結的人能存取。不要把共同編輯連結貼在公開的地方。

---

## 檔案結構

```
index.html            入口
css/app.css           樣式（手機底部抽屜／電腦左側欄、深色模式）
js/core.js            純邏輯：網址解析、匯入、分天排程、路線解析（可單獨測試）
js/services.js        外部服務：OSRM 路線、Nominatim/Google 搜尋、快取
js/sync.js            Firebase 同步（有設定才載入）
js/app.js             介面
sw.js                 離線快取（程式本體＋看過的地圖）
vendor/               Leaflet 1.9.4、Firebase 10.14.1（已內含，不依賴 CDN）
tests/                單元測試＋端對端測試
```

## 使用的免費服務

| 用途 | 服務 | 備註 |
|---|---|---|
| 地圖 | OpenStreetMap 圖磚（可換 CARTO） | 地名用當地文字 |
| 步行／單車／開車路線 | [FOSSGIS OSRM](https://routing.openstreetmap.de/) | 免費公益伺服器，工具會快取結果、限制同時請求數 |
| 地名搜尋 | Nominatim | 每秒 1 次限制，工具已遵守 |
| 大眾運輸（選填） | Google Routes API | 需金鑰 |

## 開發與測試

```bash
node --test tests/core.test.js     # 21 項單元測試
pip install playwright pillow
python3 tests/e2e.py               # 25 項端對端測試（模擬外部服務），截圖輸出到 tests/out/
```
