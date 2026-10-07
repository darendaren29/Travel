# 🧭 旅遊行程規劃系統

可視化、圖像化的旅遊行程安排工具。所有資料儲存在瀏覽器本機（localStorage），不需後端。

## 功能

| 檢視 | 說明 |
| --- | --- |
| 🗓️ **行程看板** | 每天一欄，活動卡片可**拖拉**調整順序或移到其他天；移動後自動依前一個活動的結束時間重新排程。欄頂的 24 小時色帶顯示當日時間分布；卡片之間顯示空檔、時間重疊警告與景點間距離。 |
| 🗺️ **互動地圖** | Leaflet + OpenStreetMap（免 API 金鑰），依天數上色的編號標記與路線，可切換顯示的天數。編輯活動時可用地名搜尋（Nominatim）或直接在地圖上點選位置。 |
| 💰 **預算分析** | 總花費 / 預算 / 剩餘 / 每日平均 KPI，依類別的環圖與依天的堆疊長條圖，並附表格。 |
| 📤 **匯出 / 分享** | 匯出或匯入 JSON 備份、產生含完整行程的分享連結（壓縮編碼在網址中）、列印版面。 |

支援多個旅程切換、深色模式與手機寬度。

## 開發

```bash
npm install
npm run dev        # 開發伺服器 http://localhost:5173
npm run build      # 產出 dist/
npm run preview    # 預覽 build 結果
npm run typecheck  # TypeScript 檢查
```

## 技術

React 19 · Vite 7 · TypeScript · Zustand（狀態與持久化）· @dnd-kit（拖拉）· react-leaflet（地圖）· Recharts（圖表）· lz-string（分享連結壓縮）

## 專案結構

```
src/
  types.ts          資料型別與類別/顏色設定
  store.ts          Zustand store：旅程、活動 CRUD、拖拉重排
  utils.ts          時間、金額、衝突偵測、距離計算
  share.ts          JSON 匯出入、分享連結
  sample.ts         預設範例（東京三日遊）
  components/
    Header.tsx      旅程切換、分頁、匯入匯出
    TripBar.tsx     旅程基本資料
    Board.tsx       每日看板與拖拉
    ActivityEditor.tsx  活動編輯側欄（含地點搜尋）
    MapView.tsx     地圖檢視
    BudgetView.tsx  預算檢視
    PrintView.tsx   列印版面
    ShareDialog.tsx 分享連結對話框
```
