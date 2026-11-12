# 交期回覆 LINE 通知：設定步驟

回覆人員在交期詢問頁填好「下單後幾個工作天」後，系統會自動推播一則訊息到**業務的 LINE 群組**。

## 運作方式

```
回覆人員填工作天數
  → Supabase 資料表 delivery_inquiries 更新
  → Database Webhook 呼叫 Edge Function「notify-line」
  → LINE Messaging API 推播到業務群組
```

另一個 Edge Function「line-webhook」只用來**取得業務群組的 ID**：官方帳號被拉進群組時，會在群組裡回覆群組 ID。

為什麼推播到群組，而不是個別業務：

- 業務不登入，系統無法知道誰是誰；推播給個人需要每位業務的 LINE userId，必須另外做綁定流程。
- 不需要在表單新增欄位，也不會把業務的 LINE 資料公開在清單上。

訊息範例：

```
【交期回覆】
業務：示範業務A
客戶／案件：示範客戶
品項：螺絲 M6 × 5,000
希望交期：2026-12-01
回覆：下單後 7 個工作天
查看：https://3j1683.github.io/MSTUNG/delivery.html
```

回覆被修改時，標題會變成「【交期回覆更新】」並附上原本的天數。清空回覆不會通知。

## 事前準備

- 已在 Supabase 執行 `supabase/delivery_inquiries.sql`。
- 公司**現有的** LINE 官方帳號（已決定沿用，不另開）。
- 能登入這個官方帳號後台與 LINE Developers Console 的管理員權限。
- 一個業務的 LINE 群組。

## 步驟一：檢查現有的 LINE 官方帳號

沿用現有帳號時，先確認它目前有沒有接其他系統，避免改設定時把原本的功能弄壞。

1. 在 LINE Official Account Manager 打開這個官方帳號，到設定中的 Messaging API：
   - **還沒啟用**：按啟用，系統會帶你到 LINE Developers 建立 Provider 與 Channel。
   - **已經啟用**：記下它連到的 Channel，到 LINE Developers Console 打開那個 Channel。
2. 在 LINE Developers Console 的 **Messaging API** 分頁，看 **Webhook URL** 有沒有填：
   - **空白**：照下面步驟設定即可。
   - **已經有網址**：代表有其他系統（例如客服機器人）在接收訊息。一個官方帳號只能設一個 Webhook URL，**先把原本的網址記下來**，步驟四取得群組 ID 後要改回去。
3. 在官方帳號設定中**允許加入群組**。
4. 「自動回應訊息」與「加入好友的歡迎訊息」是給客人用的，**不要關**。官方帳號進群組後，若有人說到關鍵字可能會自動回覆，這是正常的。
5. 記下兩個值（**不要貼到聊天、程式碼或 GitHub**）：
   - **Basic settings → Channel secret**
   - **Messaging API → Channel access token (long-lived)**
     - 如果已經有 token：**不要按 Reissue**，重新發行會讓舊的立刻失效，正在使用它的系統會壞掉。請向管理這個官方帳號的人取得現有的 token。
     - 如果還沒有：按 Issue 產生。

## 步驟二：在 Supabase 設定密鑰

到 Supabase 專案的 **Edge Functions → Secrets**，新增：

| 名稱 | 值 |
|---|---|
| `LINE_CHANNEL_SECRET` | 步驟一的 Channel secret |
| `LINE_CHANNEL_ACCESS_TOKEN` | 步驟一的 Channel access token |
| `NOTIFY_WEBHOOK_SECRET` | 自己想一串夠長的亂碼（例如 32 個以上英數字），步驟五會用到 |
| `LINE_GROUP_ID` | 先留空，步驟四取得後再填 |
| `DELIVERY_PAGE_URL` | （可不設）訊息裡的網址，預設是 GitHub Pages 的交期詢問頁 |

## 步驟三：部署兩個 Edge Function

程式在 `supabase/functions/notify-line/` 與 `supabase/functions/line-webhook/`，每個資料夾有 `index.ts` 與 `handler.ts` 兩個檔案。

**兩個函式都要關閉「JWT 驗證」**：呼叫者是 LINE 與 Database Webhook，不是登入的使用者。函式自己會驗證（line-webhook 檢查 LINE 簽章，notify-line 檢查 `x-webhook-secret`）。

用 Supabase CLI 部署（在儲存庫根目錄）：

```bash
supabase functions deploy line-webhook --no-verify-jwt --project-ref frndcsvhzolwtuqvofmg
```

```bash
supabase functions deploy notify-line --no-verify-jwt --project-ref frndcsvhzolwtuqvofmg
```

也可以在 Supabase 後台的 Edge Functions 用網頁編輯器建立：函式名稱要一樣，把 `index.ts` 與 `handler.ts` 兩個檔案都貼上，並把 JWT 驗證關掉。

部署後的網址：

- `https://frndcsvhzolwtuqvofmg.supabase.co/functions/v1/line-webhook`
- `https://frndcsvhzolwtuqvofmg.supabase.co/functions/v1/notify-line`

## 步驟四：取得業務群組 ID

1. 到 LINE Developers Console → 這個 Channel → **Messaging API**：
   - Webhook URL 填 `https://frndcsvhzolwtuqvofmg.supabase.co/functions/v1/line-webhook`
   - 打開 **Use webhook**
   - 按 **Verify**，應顯示成功
2. 把官方帳號邀請進業務的 LINE 群組。
3. 官方帳號會在群組裡回覆「群組 ID：C……」。如果沒看到，在群組裡輸入「群組ID」再試一次。
4. 把這串 ID 填到 Supabase Secrets 的 `LINE_GROUP_ID`。
5. 如果步驟一發現原本就有 Webhook URL：現在把它**改回原本的網址**。通知只用推播，不需要 Webhook；只有之後要重新取得群組 ID 時才需要再暫時改過來。

## 步驟五：建立 Database Webhook

到 Supabase 後台的 **Database Webhooks**（在 Database 或 Integrations 選單下），新增一個：

| 項目 | 設定 |
|---|---|
| 名稱 | `notify_line_on_reply` |
| 資料表 | `public.delivery_inquiries` |
| 事件 | 只勾 **Update** |
| 類型 | HTTP Request |
| 方法 | POST |
| 網址 | `https://frndcsvhzolwtuqvofmg.supabase.co/functions/v1/notify-line` |
| 標頭 | `Content-Type: application/json`<br>`x-webhook-secret: `（步驟二的 NOTIFY_WEBHOOK_SECRET） |

## 步驟六：測試

1. 在交期詢問頁新增一筆詢問。
2. 用回覆人員帳號登入，填工作天數。
3. 業務群組應在幾秒內收到通知。

沒收到時，到 Supabase 後台 **Edge Functions → notify-line → Logs** 看錯誤：

| 記錄內容 | 原因 |
|---|---|
| 回應 401 | Database Webhook 的 `x-webhook-secret` 和 Secrets 裡的不一樣 |
| 缺少 LINE_CHANNEL_ACCESS_TOKEN 或 LINE_GROUP_ID | Secrets 沒設好 |
| LINE 推播失敗 401 | Channel access token 錯誤或過期 |
| LINE 推播失敗 400 | 群組 ID 錯誤，或官方帳號已不在群組裡 |
| LINE 推播失敗 429 | 本月推播額度用完 |

## 注意事項

- **推播額度**：LINE 官方帳號的推播訊息每月有免費上限，超過要升級方案；額度怎麼計算請以官方帳號後台的說明為準。現有帳號的額度會和**對客人發的行銷訊息共用**，請先看目前每月用量還剩多少。回覆群組 ID 用的是「回覆訊息」，不佔推播額度。
- **群組裡顯示的名稱**：業務群組會看到公司官方帳號的名稱與頭像在發通知。
- **訊息內容**：通知會包含客戶名稱、品項與數量，請確認業務群組裡只有公司內部的人。
- **金鑰保管**：Channel secret、Channel access token、NOTIFY_WEBHOOK_SECRET 只放在 Supabase Secrets，不要放進 `config.js` 或任何上傳到 GitHub 的檔案。
