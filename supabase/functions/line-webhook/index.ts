// Supabase Edge Function 進入點：LINE Webhook（取得業務群組 ID）
// 邏輯在 handler.ts，這裡只讀取環境變數並啟動服務。
import { handle } from "./handler.ts";

Deno.serve((req) =>
  handle(req, {
    LINE_CHANNEL_SECRET: Deno.env.get("LINE_CHANNEL_SECRET"),
    LINE_CHANNEL_ACCESS_TOKEN: Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN"),
  })
);
