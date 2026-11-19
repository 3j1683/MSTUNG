# 報修登記系統

用來登記報修需求並集中查看處理進度，另有重量試算與客戶貼紙查詢。手機與電腦都能使用。

目前版本：**v1.5.0**（更新紀錄見 [CHANGELOG.md](CHANGELOG.md)）

## 網址

| 頁面 | 網址 | 誰會用 |
|---|---|---|
| 報修登記 | https://3j1683.github.io/MSTUNG/ | 所有同事；報修管理人員登入後更新處理狀態 |
| 重量試算 | https://3j1683.github.io/MSTUNG/weight.html | 出貨人員：計算架材總重與車數 |
| 客戶貼紙 | https://3j1683.github.io/MSTUNG/stickers.html | 生產、出貨：查客戶貼紙、滾字與貼法位置 |
| 使用說明 | https://3j1683.github.io/MSTUNG/help.html | 所有人 |

## 功能

- **報修登記**：報修人、地點或部門、類別、問題說明、緊急程度；清單顯示最近 20 筆，可依處理狀態與類別篩選。
- **報修狀態管理**：報修管理人員登入後，把狀態改成 待處理／處理中／已完成，系統自動記錄更新時間。
- **重量試算**：架材單重 × 數量計算總重與所需車數（板車／吊車／貨車），可複製清單；資料只存在裝置上。
- **客戶貼紙**：依客戶查貼紙樣式圖、滾字（字模）、貼紙位置與貼法位置圖。
- **交期詢問（已停用）**：v1.5.0 起從選單移除，頁面與資料仍保留，詳見 CHANGELOG。
- 一般使用者不需要登入；報修管理人員在報修登記頁登入。
- 可以「加入主畫面」，像 App 一樣從手機桌面開啟。

## 系統架構

- 網頁：純 HTML／CSS／JavaScript，以 GitHub Pages 發佈（`main` 分支根目錄）。
- 資料庫與登入：Supabase。網頁只使用 publishable key（公開金鑰），權限由資料庫的 GRANT、RLS、CHECK 三層控管。
- 通知：Supabase Edge Functions 呼叫 LINE Messaging API。

## 檔案

| 檔案 | 用途 |
|---|---|
| `index.html`、`app.js` | 報修登記頁 |
| `delivery.html`、`delivery.js` | 交期詢問頁（已從選單移除，保留檔案） |
| `weight.html`、`weight.js` | 重量試算頁 |
| `weight-data.js` | 架材品項與單重資料（修改單重或新增品項改這裡） |
| `stickers.html`、`stickers.js` | 客戶貼紙頁 |
| `stickers-data.js`、`stickers/` | 客戶貼紙資料與圖片（更新客戶資料改這裡） |
| `help.html` | 使用說明頁 |
| `common.js` | 共用：Supabase 連線、管理人員登入、訊息與時間格式 |
| `config.js` | Supabase 網址與 publishable key（**不可放 secret 金鑰**） |
| `style.css` | 樣式 |
| `favicon.svg`、`apple-touch-icon.png`、`icons/` | App 圖示（分頁、iPhone、Android 主畫面） |
| `manifest.webmanifest` | 加入主畫面後的 App 名稱、圖示與顏色 |
| `og-image.png` | 分享到 LINE、Facebook 時的預覽圖 |
| `supabase/schema.sql` | 報修資料表與權限（v1.0） |
| `supabase/delivery_inquiries.sql` | 交期詢問資料表與權限（v1.0） |
| `supabase/update_v1.1.sql` | v1.1：報修管理人員可更新處理狀態 |
| `supabase/functions/` | LINE 通知的 Edge Functions |
| `文件/報修欄位表.xlsx` | 欄位定義與範例資料 |
| `文件/LINE通知設定步驟.md` | LINE 通知的設定步驟 |
| `報修需求筆記.txt` | 需求筆記、已決定事項與待確認事項 |

## 設定與部署

依序完成（✅ 為已完成）：

1. ✅ 在 Supabase SQL Editor 執行 `supabase/schema.sql`、`supabase/delivery_inquiries.sql`。
2. ✅ GitHub Pages：Settings → Pages，分支 `main`、資料夾 `/ (root)`。
3. **執行 `supabase/update_v1.1.sql`**（v1.1 新增）。沒執行時網頁照常運作，只是管理人員登入後會顯示「管理功能尚未啟用」。
4. 建立管理人員帳號：Supabase → Authentication → Users 新增使用者，再用 SQL 加入名單：
   - 報修管理人員：`supabase/update_v1.1.sql` 最後的範例 SQL（加入 `repair_admins`）
   - 交期回覆人員：`supabase/delivery_inquiries.sql` 最後的範例 SQL（加入 `delivery_responders`）
5. 建議在 Supabase → Authentication 關閉開放註冊，避免陌生人自行建立帳號。
6. 設定登入信件的回到網址（邀請信、忘記密碼信才會連回網站）：Supabase → Authentication → URL Configuration
   - **Site URL**：`https://3j1683.github.io/MSTUNG/`
   - **Redirect URLs** 新增：`https://3j1683.github.io/MSTUNG/**`
7. （已停用）交期回覆的 LINE 通知：隨交期詢問一起停用，不需設定。

## 注意事項

- 清單任何拿到網址的人都看得到，請勿填寫機密資料。
- 客戶貼紙頁含真實客戶名稱與部分電話，網站與儲存庫都是公開的（已確認可公開）。
- 報修與詢問送出後不能修改或刪除，以保留紀錄。
- 網站更新後最多約 10 分鐘生效；版本號顯示在每頁最下方。
