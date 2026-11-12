// 報修登記：新增表單、最近 20 筆清單（可篩選）、管理人員更新處理狀態
(function () {
  "use strict";

  var A = window.APP;
  var $ = A.$;
  var form = $("repair-form");
  var submitBtn = $("submit-btn");
  var formMsg = $("form-message");
  var listEl = $("repair-list");
  var listMsg = $("list-message");
  var refreshBtn = $("refresh-btn");
  var filterStatus = $("filter-status");
  var filterCategory = $("filter-category");
  var desc = $("description");
  var descCount = $("desc-count");

  // 和資料庫 CHECK 限制一致
  var CATEGORIES = ["設備", "網路", "環境", "其他"];
  var URGENCIES = ["低", "中", "高"];
  var STATUSES = ["待處理", "處理中", "已完成"];

  var isAdmin = false;
  var listSeq = 0;

  if (!A.ready) {
    A.show(formMsg, "無法載入系統元件或設定，請稍後重新整理頁面。", "error");
    submitBtn.disabled = true;
    refreshBtn.disabled = true;
    A.setupAuth("is_repair_admin", "報修管理人員", function () {});
    return;
  }

  desc.addEventListener("input", function () {
    descCount.textContent = String(desc.value.length);
  });

  // ---------- 新增報修 ----------
  function readForm() {
    var d = new FormData(form);
    return {
      reporter_name: String(d.get("reporter_name") || "").trim(),
      location: String(d.get("location") || "").trim(),
      category: String(d.get("category") || ""),
      description: String(d.get("description") || "").trim(),
      urgency: String(d.get("urgency") || "中"),
    };
  }

  function validate(r) {
    if (!r.reporter_name) return "請填寫報修人。";
    if (r.reporter_name.length > 50) return "報修人最多 50 字。";
    if (!r.location) return "請填寫地點或部門。";
    if (r.location.length > 100) return "地點或部門最多 100 字。";
    if (CATEGORIES.indexOf(r.category) === -1) return "請選擇類別。";
    if (!r.description) return "請填寫問題說明。";
    if (r.description.length > 1000) return "問題說明最多 1000 字。";
    if (URGENCIES.indexOf(r.urgency) === -1) return "請選擇緊急程度。";
    return "";
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    var row = readForm();
    var problem = validate(row);
    if (problem) { A.show(formMsg, problem, "error"); return; }

    submitBtn.disabled = true;
    submitBtn.textContent = "送出中…";
    formMsg.hidden = true;
    try {
      // 不送 status、id、created_at，由資料庫預設值產生
      var res = await A.publicDb.from("repair_requests").insert(row);
      if (res.error) throw res.error;
      A.show(formMsg, "已送出報修，謝謝！可以在下方清單查看處理進度。", "ok");
      form.reset();
      descCount.textContent = "0";
      loadList();
    } catch (err) {
      A.show(formMsg, A.friendlyError(err), "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "送出報修";
    }
  });

  // ---------- 管理人員：更新處理狀態 ----------
  function statusForm(r) {
    var f = A.el("form", "inline-form");
    f.noValidate = true;
    var id = "status-" + r.id;
    var label = A.el("label", null, "更新處理狀態");
    label.htmlFor = id;
    var sel = A.el("select");
    sel.id = id;
    STATUSES.forEach(function (s) {
      var o = A.el("option", null, s);
      o.value = s;
      if (s === r.status) o.selected = true;
      sel.appendChild(o);
    });
    var btn = A.el("button", "secondary", "更新");
    btn.type = "submit";
    var msg = A.el("p", "message");
    msg.hidden = true;
    msg.setAttribute("role", "status");

    f.addEventListener("submit", async function (e) {
      e.preventDefault();
      if (sel.value === r.status) { A.show(msg, "狀態沒有改變。", "info"); return; }
      btn.disabled = true;
      try {
        var res = await A.authDb.from("repair_requests")
          .update({ status: sel.value })
          .eq("id", r.id)
          .select("id");
        if (res.error) throw res.error;
        if (!res.data || res.data.length === 0) throw new Error("permission denied");
        loadList();
      } catch (err) {
        A.show(msg, A.friendlyError(err), "error");
        btn.disabled = false;
      }
    });

    var row = A.el("div", "inline-row");
    row.appendChild(sel);
    row.appendChild(btn);
    f.appendChild(label);
    f.appendChild(row);
    f.appendChild(msg);
    return f;
  }

  // ---------- 清單 ----------
  var STATUS_CLASS = { "待處理": "st-pending", "處理中": "st-doing", "已完成": "st-done" };

  function renderItem(r) {
    var li = A.el("li", "repair-item");
    var top = A.el("div", "item-top");
    top.appendChild(A.el("span", "tag " + (STATUS_CLASS[r.status] || ""), r.status));
    top.appendChild(A.el("span", "tag", r.category));
    top.appendChild(A.el("span", "tag urg-" + r.urgency, "緊急程度：" + r.urgency));
    li.appendChild(top);
    li.appendChild(A.el("p", "item-desc", r.description));
    li.appendChild(A.el("p", "item-meta",
      r.reporter_name + "｜" + r.location + "｜報修於 " + A.fmtTime(r.created_at)));
    if (r.status_updated_at) {
      li.appendChild(A.el("p", "item-meta", "狀態更新於 " + A.fmtTime(r.status_updated_at)));
    }
    if (isAdmin) li.appendChild(statusForm(r));
    return li;
  }

  async function loadList() {
    var seq = ++listSeq;
    refreshBtn.disabled = true;
    A.show(listMsg, "載入中…", "info");
    try {
      // 用 * 讀取，資料庫尚未加上 v1.1 欄位時也能正常顯示
      var q = A.publicDb.from("repair_requests").select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      if (filterStatus.value) q = q.eq("status", filterStatus.value);
      if (filterCategory.value) q = q.eq("category", filterCategory.value);
      var res = await q;
      if (seq !== listSeq) return;
      if (res.error) throw res.error;

      listEl.replaceChildren();
      if (!res.data || res.data.length === 0) {
        var filtered = filterStatus.value || filterCategory.value;
        A.show(listMsg, filtered ? "沒有符合篩選條件的報修。" : "目前還沒有報修紀錄。", "info");
        return;
      }
      listMsg.hidden = true;
      res.data.forEach(function (r) { listEl.appendChild(renderItem(r)); });
    } catch (err) {
      if (seq === listSeq) A.show(listMsg, "清單載入失敗：" + A.friendlyError(err), "error");
    } finally {
      if (seq === listSeq) refreshBtn.disabled = false;
    }
  }

  refreshBtn.addEventListener("click", loadList);
  filterStatus.addEventListener("change", loadList);
  filterCategory.addEventListener("change", loadList);
  $("filter-form").addEventListener("submit", function (e) { e.preventDefault(); });

  A.setupAuth("is_repair_admin", "報修管理人員", function (hasRole) {
    isAdmin = hasRole;
    loadList();
  });
})();
