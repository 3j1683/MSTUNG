// 交期詢問：業務新增詢問 + 最近 20 筆清單 + 指定人員登入回覆工作天數
(function () {
  "use strict";

  var cfg = window.APP_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };

  var form = $("inquiry-form");
  var submitBtn = $("submit-btn");
  var formMsg = $("form-message");
  var listEl = $("inquiry-list");
  var listMsg = $("list-message");
  var refreshBtn = $("refresh-btn");
  var loginForm = $("login-form");
  var loginBtn = $("login-btn");
  var loggedIn = $("logged-in");
  var who = $("who");
  var logoutBtn = $("logout-btn");
  var loginMsg = $("login-message");

  var isResponder = false;

  function show(el, text, kind) {
    el.textContent = text;
    el.className = "message " + kind;
    el.hidden = false;
  }

  if (!window.supabase || !cfg.SUPABASE_URL || !cfg.SUPABASE_PUBLISHABLE_KEY) {
    show(formMsg, "無法載入系統元件或設定，請稍後重新整理頁面。", "error");
    submitBtn.disabled = true;
    refreshBtn.disabled = true;
    loginBtn.disabled = true;
    return;
  }

  // 回覆人員需要保持登入，所以這頁保存登入狀態（存在瀏覽器）
  var db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: "mstung-delivery-auth" },
  });

  function friendlyError(err) {
    var msg = (err && err.message) || "";
    if (/Invalid login credentials/i.test(msg)) return "Email 或密碼錯誤。";
    if (/check constraint/i.test(msg)) return "資料格式不符合規定，請檢查各欄位內容。";
    if (/permission denied|row-level security/i.test(msg)) return "沒有權限執行這個動作。";
    if (/Failed to fetch|NetworkError|network/i.test(msg)) return "網路連線失敗，請確認網路後再試一次。";
    return "操作失敗，請稍後再試。" + (msg ? "（" + msg + "）" : "");
  }

  // ---------- 新增詢問 ----------
  function readForm() {
    var d = new FormData(form);
    var qtyText = String(d.get("quantity") || "").trim();
    return {
      sales_name: String(d.get("sales_name") || "").trim(),
      customer: String(d.get("customer") || "").trim(),
      item: String(d.get("item") || "").trim(),
      quantity: /^\d+$/.test(qtyText) ? Number(qtyText) : NaN,
      desired_date: String(d.get("desired_date") || "") || null,
    };
  }

  function validate(r) {
    if (!r.sales_name) return "請填寫業務姓名。";
    if (r.sales_name.length > 50) return "業務姓名最多 50 字。";
    if (!r.customer) return "請填寫客戶或案件名稱。";
    if (r.customer.length > 100) return "客戶或案件名稱最多 100 字。";
    if (!r.item) return "請填寫品項。";
    if (r.item.length > 200) return "品項最多 200 字。";
    if (!(r.quantity >= 1 && r.quantity <= 10000000)) return "數量請填 1 到 10,000,000 的整數。";
    if (r.desired_date && !/^\d{4}-\d{2}-\d{2}$/.test(r.desired_date)) return "希望交期格式不正確。";
    return "";
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    var row = readForm();
    var problem = validate(row);
    if (problem) { show(formMsg, problem, "error"); return; }

    submitBtn.disabled = true;
    submitBtn.textContent = "送出中…";
    formMsg.hidden = true;
    try {
      // 已登入的回覆人員不能新增（資料庫只開放給未登入的業務），先提醒
      var s = await db.auth.getSession();
      if (s.data && s.data.session) {
        show(formMsg, "目前是回覆人員登入狀態，請先登出再新增詢問。", "error");
        return;
      }
      // 只送業務填的五個欄位，回覆欄位由回覆人員處理
      var res = await db.from("delivery_inquiries").insert(row);
      if (res.error) throw res.error;
      show(formMsg, "已送出詢問，回覆後會顯示在下方清單。", "ok");
      form.reset();
      loadList();
    } catch (err) {
      show(formMsg, friendlyError(err), "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "送出詢問";
    }
  });

  // ---------- 清單 ----------
  var timeFmt = new Intl.DateTimeFormat("zh-TW", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  var numFmt = new Intl.NumberFormat("zh-TW");

  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text; // 一律純文字，避免輸入內容被當成 HTML
    return n;
  }

  function replyForm(r) {
    var f = el("form", "reply-form");
    f.noValidate = true;
    var id = "days-" + r.id;
    var label = el("label", null, "回覆工作天數");
    label.htmlFor = id;
    var input = el("input");
    input.id = id;
    input.type = "number";
    input.inputMode = "numeric";
    input.min = "0";
    input.max = "365";
    input.step = "1";
    if (r.reply_working_days != null) input.value = String(r.reply_working_days);
    var btn = el("button", "secondary", r.reply_working_days == null ? "回覆" : "更新");
    btn.type = "submit";
    var msg = el("p", "message");
    msg.hidden = true;
    msg.setAttribute("role", "status");

    f.addEventListener("submit", async function (e) {
      e.preventDefault();
      var t = input.value.trim();
      if (!/^\d+$/.test(t) || Number(t) > 365) { show(msg, "請填 0 到 365 的整數。", "error"); return; }
      btn.disabled = true;
      try {
        var res = await db.from("delivery_inquiries")
          .update({ reply_working_days: Number(t) })
          .eq("id", r.id)
          .select("id");
        if (res.error) throw res.error;
        if (!res.data || res.data.length === 0) throw new Error("permission denied");
        loadList();
      } catch (err) {
        show(msg, friendlyError(err), "error");
        btn.disabled = false;
      }
    });

    var row = el("div", "reply-row");
    row.appendChild(input);
    row.appendChild(btn);
    f.appendChild(label);
    f.appendChild(row);
    f.appendChild(msg);
    return f;
  }

  function renderItem(r) {
    var li = el("li", "repair-item");
    var top = el("div", "item-top");
    if (r.reply_working_days == null) {
      top.appendChild(el("span", "tag pending", "待回覆"));
    } else {
      top.appendChild(el("span", "tag replied", r.reply_working_days + " 個工作天"));
    }
    top.appendChild(el("span", "tag",
      r.desired_date ? "希望交期 " + r.desired_date : "未填希望交期"));
    li.appendChild(top);

    li.appendChild(el("p", "item-desc", r.item + " × " + numFmt.format(r.quantity)));
    li.appendChild(el("p", "item-meta",
      r.customer + "｜業務 " + r.sales_name + "｜詢問於 " + timeFmt.format(new Date(r.created_at))));
    if (r.replied_at) {
      li.appendChild(el("p", "item-meta", "回覆於 " + timeFmt.format(new Date(r.replied_at))));
    }
    if (isResponder) li.appendChild(replyForm(r));
    return li;
  }

  async function loadList() {
    refreshBtn.disabled = true;
    show(listMsg, "載入中…", "info");
    try {
      var res = await db
        .from("delivery_inquiries")
        .select("id, created_at, sales_name, customer, item, quantity, desired_date, reply_working_days, replied_at")
        .order("created_at", { ascending: false })
        .limit(20);
      if (res.error) throw res.error;
      listEl.replaceChildren();
      if (!res.data || res.data.length === 0) { show(listMsg, "目前還沒有交期詢問。", "info"); return; }
      listMsg.hidden = true;
      res.data.forEach(function (r) { listEl.appendChild(renderItem(r)); });
    } catch (err) {
      show(listMsg, "清單載入失敗：" + friendlyError(err), "error");
    } finally {
      refreshBtn.disabled = false;
    }
  }

  // ---------- 登入 ----------
  async function refreshAuth() {
    var s = await db.auth.getSession();
    var session = s.data && s.data.session;
    isResponder = false;
    if (session) {
      var rpc = await db.rpc("is_delivery_responder");
      isResponder = !rpc.error && rpc.data === true;
      loginForm.hidden = true;
      loggedIn.hidden = false;
      who.textContent = "已登入：" + (session.user.email || "") +
        (isResponder ? "（可以回覆交期）" : "（不是指定回覆人員，只能查看）");
    } else {
      loginForm.hidden = false;
      loggedIn.hidden = true;
    }
    loadList();
  }

  loginForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    var email = $("email").value.trim();
    var password = $("password").value;
    if (!email || !password) { show(loginMsg, "請輸入 Email 和密碼。", "error"); return; }
    loginBtn.disabled = true;
    loginMsg.hidden = true;
    try {
      var res = await db.auth.signInWithPassword({ email: email, password: password });
      if (res.error) throw res.error;
      loginForm.reset();
      await refreshAuth();
    } catch (err) {
      show(loginMsg, friendlyError(err), "error");
    } finally {
      loginBtn.disabled = false;
    }
  });

  logoutBtn.addEventListener("click", async function () {
    await db.auth.signOut();
    loginMsg.hidden = true;
    await refreshAuth();
  });

  refreshBtn.addEventListener("click", loadList);
  refreshAuth();
})();
