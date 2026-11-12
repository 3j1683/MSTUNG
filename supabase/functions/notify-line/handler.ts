// 交期回覆 → LINE 群組通知
//
// 由 Supabase「Database Webhook」在 delivery_inquiries 有 UPDATE 時呼叫。
// 只有在「工作天數」被填入或改變時才發通知，推播到業務的 LINE 群組。
//
// 需要的環境變數（Supabase → Edge Functions → Secrets）：
//   LINE_CHANNEL_ACCESS_TOKEN  LINE Messaging API 的 Channel access token（長期）
//   LINE_GROUP_ID              業務 LINE 群組的 ID（由 line-webhook 函式取得）
//   NOTIFY_WEBHOOK_SECRET      自訂的一串密碼，Database Webhook 要帶在 x-webhook-secret 標頭
//   DELIVERY_PAGE_URL          （可不設）訊息裡附的網址

export interface Env {
  LINE_CHANNEL_ACCESS_TOKEN?: string;
  LINE_GROUP_ID?: string;
  NOTIFY_WEBHOOK_SECRET?: string;
  DELIVERY_PAGE_URL?: string;
}

type Row = {
  id?: string;
  sales_name?: string;
  customer?: string;
  item?: string;
  quantity?: number;
  desired_date?: string | null;
  reply_working_days?: number | null;
};

type WebhookPayload = {
  type?: string;
  table?: string;
  schema?: string;
  record?: Row | null;
  old_record?: Row | null;
};

const DEFAULT_PAGE_URL = "https://3j1683.github.io/MSTUNG/delivery.html";
const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

// 固定時間比較，避免從回應時間猜出密碼
function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) {
    diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  }
  return diff === 0;
}

export function buildMessage(record: Row, old: Row | null | undefined, pageUrl: string): string {
  const days = record.reply_working_days;
  const before = old?.reply_working_days;
  const qty = typeof record.quantity === "number" ? record.quantity.toLocaleString("zh-TW") : "";
  const lines = [
    before == null ? "【交期回覆】" : "【交期回覆更新】",
    `業務：${record.sales_name ?? ""}`,
    `客戶／案件：${record.customer ?? ""}`,
    `品項：${record.item ?? ""}${qty ? ` × ${qty}` : ""}`,
    `希望交期：${record.desired_date || "未填"}`,
    before == null
      ? `回覆：下單後 ${days} 個工作天`
      : `回覆：下單後 ${days} 個工作天（原本 ${before} 個工作天）`,
    `查看：${pageUrl}`,
  ];
  // LINE 文字訊息上限 5000 字
  return lines.join("\n").slice(0, 5000);
}

export async function handle(
  req: Request,
  env: Env,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  // 1. 驗證呼叫者：必須帶正確的 x-webhook-secret
  const expected = env.NOTIFY_WEBHOOK_SECRET ?? "";
  const given = req.headers.get("x-webhook-secret") ?? "";
  if (!expected || !safeEqual(given, expected)) return json(401, { error: "unauthorized" });

  if (!env.LINE_CHANNEL_ACCESS_TOKEN || !env.LINE_GROUP_ID) {
    console.error("缺少 LINE_CHANNEL_ACCESS_TOKEN 或 LINE_GROUP_ID");
    return json(500, { error: "server not configured" });
  }

  let payload: WebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: "invalid json" });
  }

  // 2. 只處理 delivery_inquiries 的 UPDATE
  if (payload.type !== "UPDATE" || payload.schema !== "public" || payload.table !== "delivery_inquiries" || !payload.record) {
    return json(200, { skipped: "not a delivery_inquiries update" });
  }

  // 3. 只有工作天數被填入或改變才通知；清空回覆不通知
  const now = payload.record.reply_working_days;
  const before = payload.old_record?.reply_working_days ?? null;
  if (now == null || now === before) {
    return json(200, { skipped: "reply not changed" });
  }

  // 4. 推播到業務群組
  const text = buildMessage(payload.record, payload.old_record, env.DELIVERY_PAGE_URL || DEFAULT_PAGE_URL);
  const res = await fetchFn(LINE_PUSH_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ to: env.LINE_GROUP_ID, messages: [{ type: "text", text }] }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("LINE 推播失敗", res.status, detail);
    return json(502, { error: "line push failed", status: res.status });
  }
  return json(200, { sent: true });
}
