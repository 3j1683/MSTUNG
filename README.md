# 報修登記系統

用來登記報修需求、詢問交期，並集中查看處理進度。手機與電腦都能使用。

目前版本：**v1.1.0**（更新紀錄見 [CHANGELOG.md](CHANGELOG.md)）

## 網址

| 頁面 | 網址 | 誰會用 |
|---|---|---|
| 報修登記 | https://3j1683.github.io/MSTUNG/ | 所有同事；報修管理人員登入後更新處理狀態 |
| 交期詢問 | https://3j1683.github.io/MSTUNG/delivery.html | 業務；交期回覆人員登入後回覆工作天數 |
| 使用說明 | https://3j1683.github.io/MSTUNG/help.html | 所有人 |

## 功能

- **報修登記**：報修人、地點或部門、類別、問題說明、緊急程度；清單顯示最近 20 筆，可依處理狀態與類別篩選。
- **報修狀態管理**：報修管理人員登入後，把狀態改成 待處理／處理中／已完成，系統自動記錄更新時間。
- **交期詢問**：業務填寫客戶、品項、數量、希望交期；回覆人員登入後回覆「下單後幾個工作天」。清單可依業務姓名、只看待回覆篩選。
- **LINE 通知**：交期回覆後推播到業務的 LINE 群組（需另外設定，見下方）。
- 一般使用者不需要登入；管理人員在任一頁登入一次，兩頁共用。

## 系統架構

- 網頁：純 HTML／CSS／JavaScript，以 GitHub Pages 發佈（`main` 分支根目錄）。
- 資料庫與登入：Supabase。網頁只使用 publishable key（公開金鑰），權限由資料庫的 GRANT、RLS、CHECK 三層控管。
- 通知：Supabase Edge Functions 呼叫 LINE Messaging API。

## 檔案

| 檔案 | 用途 |
|---|---|
| `index.html`、`app.js` | 報修登記頁 |
| `delivery.html`、`delivery.js` | 交期詢問頁 |
| `help.html` | 使用說明頁 |
| `common.js` | 共用：Supabase 連線、管理人員登入、訊息與時間格式 |
| `config.js` | Supabase 網址與 publishable key（**不可放 secret 金鑰**） |
| `style.css`、`favicon.svg` | 樣式與圖示 |
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
6. （選用）LINE 通知：依 [文件/LINE通知設定步驟.md](文件/LINE通知設定步驟.md) 設定。

## 注意事項

- 清單任何拿到網址的人都看得到，請勿填寫機密資料。
- 報修與詢問送出後不能修改或刪除，以保留紀錄。
- 網站更新後最多約 10 分鐘生效；版本號顯示在每頁最下方。
