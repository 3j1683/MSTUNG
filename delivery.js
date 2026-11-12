// 交期詢問：業務新增詢問、最近 20 筆清單（可篩選）、回覆人員登入回覆工作天數
(function () {
  "use strict";

  var A = window.APP;
  var $ = A.$;
  var form = $("inquiry-form");
  var submitBtn = $("submit-btn");
  var formMsg = $("form-message");
  var listEl = $("inquiry-list");
  var listMsg = $("list-message");
  var refreshBtn = $("refresh-btn");
  var filterSales = $("filter-sales");
  var filterPending = $("filter-pending");
  var salesInput = $("sales_name");

  var SALES_KEY = "mstung-sales-name";
  var isResponder = false;
  var listSeq = 0;

  if (!A.ready) {
    A.show(formMsg, "無法載入系統元件或設定，請稍後重新整理頁面。", "error");
    submitBtn.disabled = true;
    refreshBtn.disabled = true;
    A.setupAuth("is_delivery_responder", "交期回覆人員", function () {});
    return;
  }

  // 記住業務姓名（只存在這台裝置的瀏覽器）
  try {
    var saved = localStorage.getItem(SALES_KEY);
    if (saved) salesInput.value = saved;
  } catch (e) { /* 瀏覽器不允許儲存時略過 */ }

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
    if (problem) { A.show(formMsg, problem, "error"); return; }

    submitBtn.disabled = true;
    submitBtn.textContent = "送出中…";
    formMsg.hidden = true;
    try {
      // 只送業務填的五個欄位，回覆欄位由回覆人員處理
      var res = await A.publicDb.from("delivery_inquiries").insert(row);
      if (res.error) throw res.error;
      A.show(formMsg, "已送出詢問，回覆後會顯示在下方清單。", "ok");
      try { localStorage.setItem(SALES_KEY, row.sales_name); } catch (e2) { /* 略過 */ }
      form.reset();
      salesInput.value = row.sales_name;
      loadList();
    } catch (err) {
      A.show(formMsg, A.friendlyError(err), "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "送出詢問";
    }
  });

  // ---------- 回覆人員：填工作天數 ----------
  function replyForm(r) {
    var f = A.el("form", "inline-form");
    f.noValidate = true;
    var id = "days-" + r.id;
    var label = A.el("label", null, "回覆：下單後幾個工作天");
    label.htmlFor = id;
    var input = A.el("input");
    input.id = id;
    input.type = "number";
    input.inputMode = "numeric";
    input.min = "0";
    input.max = "365";
    input.step = "1";
    if (r.reply_working_days != null) input.value = String(r.reply_working_days);
    var btn = A.el("button", "secondary", r.reply_working_days == null ? "回覆" : "更新");
    btn.type = "submit";
    var msg = A.el("p", "message");
    msg.hidden = true;
    msg.setAttribute("role", "status");

    f.addEventListener("submit", async function (e) {
      e.preventDefault();
      var t = input.value.trim();
      if (!/^\d+$/.test(t) || Number(t) > 365) { A.show(msg, "請填 0 到 365 的整數。", "error"); return; }
      if (Number(t) === r.reply_working_days) { A.show(msg, "天數沒有改變。", "info"); return; }
      btn.disabled = true;
      try {
        var res = await A.authDb.from("delivery_inquiries")
          .update({ reply_working_days: Number(t) })
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
    row.appendChild(input);
    row.appendChild(btn);
    f.appendChild(label);
    f.appendChild(row);
    f.appendChild(msg);
    return f;
  }

  // ---------- 清單 ----------
  var numFmt = new Intl.NumberFormat("zh-TW");

  function renderItem(r) {
    var li = A.el("li", "repair-item");
    var top = A.el("div", "item-top");
    if (r.reply_working_days == null) {
      top.appendChild(A.el("span", "tag st-pending", "待回覆"));
    } else {
      top.appendChild(A.el("span", "tag st-done", "下單後 " + r.reply_working_days + " 個工作天"));
    }
    top.appendChild(A.el("span", "tag", r.desired_date ? "希望交期 " + r.desired_date : "未填希望交期"));
    li.appendChild(top);

    li.appendChild(A.el("p", "item-desc", r.item + " × " + numFmt.format(r.quantity)));
    li.appendChild(A.el("p", "item-meta",
      r.customer + "｜業務 " + r.sales_name + "｜詢問於 " + A.fmtTime(r.created_at)));
    if (r.replied_at) li.appendChild(A.el("p", "item-meta", "回覆於 " + A.fmtTime(r.replied_at)));
    if (isResponder) li.appendChild(replyForm(r));
    return li;
  }

  async function loadList() {
    var seq = ++listSeq;
    refreshBtn.disabled = true;
    A.show(listMsg, "載入中…", "info");
    try {
      var q = A.publicDb.from("delivery_inquiries")
        .select("id, created_at, sales_name, customer, item, quantity, desired_date, reply_working_days, replied_at")
        .order("created_at", { ascending: false })
        .limit(20);
      var name = filterSales.value.trim();
      if (name) q = q.ilike("sales_name", A.likePattern(name));
      if (filterPending.checked) q = q.is("reply_working_days", null);
      var res = await q;
      if (seq !== listSeq) return;
      if (res.error) throw res.error;

      listEl.replaceChildren();
      if (!res.data || res.data.length === 0) {
        A.show(listMsg, name || filterPending.checked ? "沒有符合篩選條件的詢問。" : "目前還沒有交期詢問。", "info");
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

  var filterTimer = null;
  filterSales.addEventListener("input", function () {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(loadList, 350);
  });
  filterPending.addEventListener("change", loadList);
  $("filter-form").addEventListener("submit", function (e) { e.preventDefault(); loadList(); });
  refreshBtn.addEventListener("click", loadList);

  A.setupAuth("is_delivery_responder", "交期回覆人員", function (hasRole) {
    isResponder = hasRole;
    loadList();
  });
})();
