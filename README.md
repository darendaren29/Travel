# 🧭 旅遊行程規劃系統

可視化、圖像化的旅遊行程安排工具。不登入也能用（資料存在瀏覽器本機）；用 Google 登入後行程會同步到雲端（Firebase），可跨裝置使用並邀請朋友共編。

**線上版本：https://travel-planner-2734f.web.app**

## ✨ AI 產生行程（Gemini）

登入後按「✨ AI 產生」，輸入目的地、天數、預算、偏好（例如「喜歡美食和動漫、第一天 14:00 抵達」），Gemini 會產生逐日行程，含時間、地點座標、預估費用與提示，直接變成可拖拉調整的看板。

技術：透過 **Firebase AI Logic** 呼叫 Gemini（`firebase/ai` + `GoogleAIBackend`），API 金鑰不會出現在前端；回應以 `responseSchema` 強制為 JSON，再經 `src/ai.ts` 的 `toTrip()` 驗證與修正（時間格式、類別、座標、費用）。

啟用步驟（一次性）：
1. Firebase 主控台 → **AI Logic** → 開始使用 → 選 **Gemini Developer API**
2. 依引導設定 **App Check**（reCAPTCHA Enterprise），把網站金鑰填到 `src/config.ts` 的 `RECAPTCHA_SITE_KEY`
3. 模型名稱在 `src/config.ts` 的 `GEMINI_MODELS`，會依序嘗試

## 雲端功能

- **Google 登入**：登入時會把本機的行程上傳；之後所有修改即時同步到 Firestore，手機與電腦自動一致
- **邀請共編**：「🔗 分享」→ 開啟「邀請連結」，對方登入後打開連結即加入，雙方修改即時互通（最後寫入優先）
- **分享副本**：不登入也能用的連結，整份行程壓縮在網址中，對方得到一份獨立副本
- 登出會清掉這台裝置上的資料，雲端保留

### 架構

```
瀏覽器 (React) ── Firebase Auth (Google) ──┐
      │                                     │
      └── Firestore `trips/{id}`  ◄── 安全規則 firestore.rules（只有 members 能讀寫）
            每份行程一個文件，members 陣列決定誰看得到
```

### 部署

推送到 GitHub 後，`.github/workflows/deploy.yml` 會自動 build 並部署 Hosting 與 Firestore 規則。需要在 repo 的 Secrets 設定 `FIREBASE_SERVICE_ACCOUNT`（Firebase 專案設定 → 服務帳戶 → 產生私密金鑰的 JSON）。

本機手動部署：`npm run build && npx firebase-tools deploy`（需先 `npx firebase-tools login`）。

## 功能

| 檢視 | 說明 |
| --- | --- |
| 🗓️ **行程看板** | 每天一欄，活動卡片可**拖拉**調整順序或移到其他天；移動後自動依前一個活動的結束時間重新排程。欄頂的 24 小時色帶顯示當日時間分布；卡片之間顯示空檔、時間重疊警告與景點間距離。 |
| 🗺️ **互動地圖** | **非韓國行程用 Google Maps**（`@vis.gl/react-google-maps`：編號標記、虛線路線、InfoWindow、地圖/衛星切換），地名搜尋走 **Google Places API (New)**，會以行程內已定位的景點做鄰近偏好。**韓國行程或未設定金鑰時用 Leaflet + OpenStreetMap**，搜尋走 Nominatim。金鑰與 Map ID 設在 `src/config.ts`。<br>Leaflet 模式下**底圖可選**：標準 OSM、簡潔淺灰（Esri）、深色（Esri）、衛星（Esri）、地形（OpenTopoMap）、日本地理院；「自動」會跟隨深色模式。全部免費、免金鑰。（CARTO 底圖自 2026-09 起需金鑰，在 `src/config.ts` 填入免費的 `CARTO_API_KEY` 後才會出現。）編輯活動時可用地名搜尋（Nominatim）或直接在地圖上點選位置。 |
| 🚇 **真實交通時間與路徑** | 用 **Google Routes API** 計算相鄰景點間的實際移動時間與距離（大眾運輸／步行／開車／單車，於旅程設定列選擇）。卡片之間顯示「🚇 23分 · 2.1 km · 餘 12分」，空檔不夠時標紅「⚠ 趕不上」並出現 **⏩ 重新排程** 按鈕（把後面的活動依交通時間往後推）。24 小時色帶以斜紋顯示移動時間。地圖上的路線改為沿街道／鐵路的真實路徑。結果快取在行程內（同步給共編者），改順序或交通方式才重算。 |
| 🔀 **最佳順序** | 每天一顆按鈕，用 Routes API 的路線最佳化把當天景點重排成移動時間最短（第一站與最後一站固定；大眾運輸以步行估算），並自動重新安排時間。需所有活動都有座標。 |
| 📷 **地點照片** | 用 Google 搜尋選定地點時自動帶入照片；編輯面板也可按「從 Google 取得照片」補上（例如 AI 產生的行程）。卡片顯示縮圖。 |
| 🧭 **一鍵導航** | 每張卡片、編輯面板與地圖標記都有導航按鈕，依目的地自動挑選：**韓國 → Kakao Map / Naver Map**（Google 在韓國無法規劃路線），其他地區 → Google 地圖，iPhone/Mac 另有 Apple 地圖。每天欄位的「🧭 路線」會把當天所有已定位景點串成一條 Google 地圖大眾運輸路線。純深層連結，不需 API 金鑰。 |
| 💰 **預算分析** | 總花費 / 預算 / 剩餘 / 每日平均 KPI，依類別的環圖與依天的堆疊長條圖，並附表格。 |
| 📤 **匯出 / 分享** | 匯出或匯入 JSON 備份、產生含完整行程的分享連結（壓縮編碼在網址中）、列印版面。 |

支援多個旅程切換與深色模式。

### 📱 手機

- 看板改為一天一頁，左右滑動切換天數
- **長按約 0.25 秒**卡片即可拖拉（直接滑動則是捲動列表）
- 編輯面板以底部抽屜呈現；旅程設定列可收合
- 可「加入主畫面」以全螢幕方式使用

## 開發

```bash
npm install
npm run dev        # 開發伺服器 http://localhost:5173
npm run build      # 產出 dist/
npm run preview    # 預覽 build 結果
npm run typecheck  # TypeScript 檢查
```

## 技術

React 19 · Vite 7 · TypeScript · Zustand（狀態與持久化）· @dnd-kit（拖拉）· react-leaflet（地圖）· Recharts（圖表）· lz-string（分享連結壓縮）· Firebase（Auth、Firestore、Hosting）

## 專案結構

```
src/
  types.ts          資料型別與類別/顏色設定
  store.ts          Zustand store：旅程、活動 CRUD、拖拉重排
  utils.ts          時間、金額、衝突偵測、距離計算
  share.ts          JSON 匯出入、分享連結
  nav.ts            導航深層連結（Google / Apple / Kakao / Naver）、當日路線、韓國偵測
  places.ts         地名搜尋（Google Places New ↔ Nominatim 自動切換）、照片 URL
  routes.ts         Google Routes API：路段計算、順序最佳化、polyline 解碼、快取鍵
  useRouteSync.ts   自動補齊目前旅程缺少的路段（防抖、併發 3、失敗 10 分鐘後重試）
  basemaps.ts       免費底圖清單與深色模式對應
  sample.ts         預設範例（東京三日遊）
  config.ts         App Check 金鑰、Gemini 模型清單
  firebase.ts       Firebase 初始化（公開的 web 設定、App Check）
  ai.ts             Gemini 行程產生（Firebase AI Logic、JSON schema、結果驗證）
  auth.ts           Google 登入/登出、邀請連結加入
  sync.ts           Firestore 雙向同步（即時讀取、防抖寫入）
  components/
    Header.tsx      旅程切換、分頁、匯入匯出
    TripBar.tsx     旅程基本資料
    Board.tsx       每日看板與拖拉
    ActivityEditor.tsx  活動編輯側欄（含地點搜尋）
    MapView.tsx     地圖檢視（側欄、圖例；Leaflet 實作）
    GoogleMap.tsx   Google Maps 實作
    BudgetView.tsx  預算檢視
    PrintView.tsx   列印版面
    ShareDialog.tsx 分享連結 / 邀請共編對話框
    AiDialog.tsx    AI 產生行程對話框
```
