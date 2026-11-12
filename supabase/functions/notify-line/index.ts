// Supabase Edge Function 進入點：交期回覆 → LINE 群組通知
// 邏輯在 handler.ts，這裡只讀取環境變數並啟動服務。
import { handle } from "./handler.ts";

Deno.serve((req) =>
  handle(req, {
    LINE_CHANNEL_ACCESS_TOKEN: Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN"),
    LINE_GROUP_ID: Deno.env.get("LINE_GROUP_ID"),
    NOTIFY_WEBHOOK_SECRET: Deno.env.get("NOTIFY_WEBHOOK_SECRET"),
    DELIVERY_PAGE_URL: Deno.env.get("DELIVERY_PAGE_URL"),
  })
);
