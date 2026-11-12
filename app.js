// 報修登記：新增表單 + 最近 20 筆清單
(function () {
  "use strict";

  var cfg = window.APP_CONFIG || {};
  var form = document.getElementById("repair-form");
  var submitBtn = document.getElementById("submit-btn");
  var formMsg = document.getElementById("form-message");
  var listEl = document.getElementById("repair-list");
  var listMsg = document.getElementById("list-message");
  var refreshBtn = document.getElementById("refresh-btn");
  var desc = document.getElementById("description");
  var descCount = document.getElementById("desc-count");

  // 和資料庫 CHECK 限制一致的長度上限
  var LIMITS = { reporter_name: 50, location: 100, description: 1000 };
  var CATEGORIES = ["設備", "網路", "環境", "其他"];
  var URGENCIES = ["低", "中", "高"];

  function show(el, text, kind) {
    el.textContent = text;
    el.className = "message " + kind;
    el.hidden = false;
  }

  if (!window.supabase || !cfg.SUPABASE_URL || !cfg.SUPABASE_PUBLISHABLE_KEY) {
    show(formMsg, "無法載入系統元件或設定，請稍後重新整理頁面。", "error");
    submitBtn.disabled = true;
    refreshBtn.disabled = true;
    return;
  }

  var db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  desc.addEventListener("input", function () {
    descCount.textContent = String(desc.value.length);
  });

  function readForm() {
    var data = new FormData(form);
    return {
      reporter_name: String(data.get("reporter_name") || "").trim(),
      location: String(data.get("location") || "").trim(),
      category: String(data.get("category") || ""),
      description: String(data.get("description") || "").trim(),
      urgency: String(data.get("urgency") || "中"),
    };
  }

  function validate(row) {
    if (!row.reporter_name) return "請填寫報修人。";
    if (row.reporter_name.length > LIMITS.reporter_name) return "報修人最多 50 字。";
    if (!row.location) return "請填寫地點或部門。";
    if (row.location.length > LIMITS.location) return "地點或部門最多 100 字。";
    if (CATEGORIES.indexOf(row.category) === -1) return "請選擇類別。";
    if (!row.description) return "請填寫問題說明。";
    if (row.description.length > LIMITS.description) return "問題說明最多 1000 字。";
    if (URGENCIES.indexOf(row.urgency) === -1) return "請選擇緊急程度。";
    return "";
  }

  function friendlyError(err) {
    var msg = (err && err.message) || "";
    if (/check constraint/i.test(msg)) return "資料格式不符合規定，請檢查各欄位內容。";
    if (/permission denied|row-level security/i.test(msg)) return "沒有權限執行這個動作，請聯絡管理員。";
    if (/Failed to fetch|NetworkError|network/i.test(msg)) return "網路連線失敗，請確認網路後再試一次。";
    return "送出失敗，請稍後再試。" + (msg ? "（" + msg + "）" : "");
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    var row = readForm();
    var problem = validate(row);
    if (problem) {
      show(formMsg, problem, "error");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "送出中…";
    formMsg.hidden = true;

    try {
      // 不送 status、id、created_at，由資料庫預設值產生
      var result = await db.from("repair_requests").insert(row);
      if (result.error) throw result.error;

      show(formMsg, "已送出報修，謝謝！", "ok");
      form.reset();
      descCount.textContent = "0";
      loadList();
    } catch (err) {
      show(formMsg, friendlyError(err), "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "送出報修";
    }
  });

  var timeFmt = new Intl.DateTimeFormat("zh-TW", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text; // 一律用 textContent，避免使用者輸入被當成 HTML
    return node;
  }

  function renderItem(r) {
    var li = el("li", "repair-item");
    var top = el("div", "item-top");
    top.appendChild(el("span", "tag", r.status));
    top.appendChild(el("span", "tag", r.category));
    top.appendChild(el("span", "tag urg-" + r.urgency, "緊急程度：" + r.urgency));
    li.appendChild(top);
    li.appendChild(el("p", "item-desc", r.description));
    var when = r.created_at ? timeFmt.format(new Date(r.created_at)) : "";
    li.appendChild(el("p", "item-meta", r.reporter_name + "｜" + r.location + "｜" + when));
    return li;
  }

  async function loadList() {
    refreshBtn.disabled = true;
    show(listMsg, "載入中…", "info");
    try {
      var result = await db
        .from("repair_requests")
        .select("id, created_at, reporter_name, location, category, description, urgency, status")
        .order("created_at", { ascending: false })
        .limit(20);
      if (result.error) throw result.error;

      listEl.replaceChildren();
      if (!result.data || result.data.length === 0) {
        show(listMsg, "目前還沒有報修紀錄。", "info");
        return;
      }
      listMsg.hidden = true;
      result.data.forEach(function (r) { listEl.appendChild(renderItem(r)); });
    } catch (err) {
      show(listMsg, "清單載入失敗：" + friendlyError(err), "error");
    } finally {
      refreshBtn.disabled = false;
    }
  }

  refreshBtn.addEventListener("click", loadList);
  loadList();
})();
