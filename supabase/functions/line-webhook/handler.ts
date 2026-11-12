// LINE Webhook：取得業務群組的 ID
//
// 設定方式：把這個函式的網址填到 LINE Developers 的 Webhook URL。
// 官方帳號被邀請進群組時，會在群組裡回覆「群組 ID」，
// 把這串 ID 設成 Supabase 的 LINE_GROUP_ID，notify-line 就知道要推播到哪裡。
// 之後在群組裡輸入「群組ID」也會再回覆一次。
//
// 需要的環境變數：
//   LINE_CHANNEL_SECRET        LINE Messaging API 的 Channel secret（驗證請求真的來自 LINE）
//   LINE_CHANNEL_ACCESS_TOKEN  用來回覆訊息（回覆不計入推播額度）

export interface Env {
  LINE_CHANNEL_SECRET?: string;
  LINE_CHANNEL_ACCESS_TOKEN?: string;
}

type LineEvent = {
  type?: string;
  replyToken?: string;
  source?: { type?: string; groupId?: string };
  message?: { type?: string; text?: string };
};

const LINE_REPLY_URL = "https://api.line.me/v2/bot/message/reply";

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

// LINE 簽章：以 Channel secret 對原始內容做 HMAC-SHA256，再 Base64
export async function lineSignature(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return bytesToBase64(new Uint8Array(sig));
}

export async function handle(
  req: Request,
  env: Env,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (!env.LINE_CHANNEL_SECRET || !env.LINE_CHANNEL_ACCESS_TOKEN) {
    console.error("缺少 LINE_CHANNEL_SECRET 或 LINE_CHANNEL_ACCESS_TOKEN");
    return new Response("server not configured", { status: 500 });
  }

  // 1. 驗證簽章，確認請求真的來自 LINE
  const body = await req.text();
  const given = req.headers.get("x-line-signature") ?? "";
  const expected = await lineSignature(env.LINE_CHANNEL_SECRET, body);
  if (!given || !safeEqual(given, expected)) return new Response("invalid signature", { status: 401 });

  let events: LineEvent[] = [];
  try {
    events = (JSON.parse(body).events ?? []) as LineEvent[];
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  // 2. 被加入群組，或群組裡有人輸入「群組ID」→ 回覆群組 ID
  for (const ev of events) {
    const groupId = ev.source?.type === "group" ? ev.source.groupId : undefined;
    const asked = ev.type === "message" && ev.message?.type === "text" &&
      (ev.message.text ?? "").replace(/\s/g, "").toUpperCase() === "群組ID";
    if (!groupId || !ev.replyToken || !(ev.type === "join" || asked)) continue;

    const text = `已加入群組。\n群組 ID：${groupId}\n請把這串 ID 設定到 Supabase 的 LINE_GROUP_ID。`;
    const res = await fetchFn(LINE_REPLY_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({ replyToken: ev.replyToken, messages: [{ type: "text", text }] }),
    });
    if (!res.ok) console.error("LINE 回覆失敗", res.status, await res.text().catch(() => ""));
  }

  // 3. 一律回 200，LINE 才不會重送
  return new Response("ok", { status: 200 });
}
