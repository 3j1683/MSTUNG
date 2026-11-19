// 重量試算：架材單重 × 數量，計算總重與所需車數
// 資料只存在這台裝置的瀏覽器（localStorage），不會送到資料庫。
(function () {
  "use strict";

  var A = window.APP;
  var $ = A.$;
  var el = A.el;
  var DATA = window.WEIGHT_DATA || { heavy: [], light: [] };

  var KINDS = ["heavy", "light"];
  var LABEL = { heavy: "重型", light: "輕型" };
  var CUSTOM_ROWS = 5;
  var CUSTOM_GROUP = "自訂品項";
  var STORE = "mstung-weight-v1";

  // 車種：[代號, 名稱, 預設每車載重（噸）]；載重可在畫面上調整，依車種分別記住
  var TRUCKS = [["板車", "板車", 22], ["吊車A", "吊車", 7.3], ["吊車B", "吊車", 10.5], ["貨車A", "貨車", 10], ["貨車B", "貨車", 15]];
  var AUTO = "自動";
  var TNAME = {};
  TRUCKS.forEach(function (t) { TNAME[t[0]] = t[1]; });

  // ---------- 狀態（存在瀏覽器） ----------
  var S = { tab: "heavy", qty: {}, uw: {}, f: {}, cust: {}, cap: {}, truck: AUTO };
  try {
    var saved = JSON.parse(localStorage.getItem(STORE) || "null");
    if (saved && typeof saved === "object") {
      ["qty", "uw", "f", "cust", "cap"].forEach(function (k) {
        if (saved[k] && typeof saved[k] === "object") S[k] = saved[k];
      });
      if (saved.tab === "light") S.tab = "light";
      if (typeof saved.truck === "string") S.truck = saved.truck;
    }
  } catch (e) { /* 瀏覽器不允許儲存或資料損壞時，從空白開始 */ }
  TRUCKS.forEach(function (t) { if (!(parseFloat(S.cap[t[0]]) >= 0)) S.cap[t[0]] = t[2]; });
  if (S.truck !== AUTO && !TNAME[S.truck]) S.truck = AUTO;

  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) { /* 略過 */ }
  }

  // ---------- 品項 ----------
  var ITEMS = {};
  KINDS.forEach(function (k) {
    ITEMS[k] = DATA[k].map(function (r, i) {
      return { id: k + ":" + i, kind: k, no: r[0], name: r[1], spec: r[2], w: r[3], code: r[4] || "", custom: false };
    });
    for (var i = 0; i < CUSTOM_ROWS; i++) {
      ITEMS[k].push(customItem(k, i));
    }
  });

  function customItem(k, i) {
    var id = k + ":c" + i;
    function part(f) { return ((S.cust[id] && S.cust[id][f]) || "").trim(); }
    return {
      id: id, kind: k, no: "自" + (i + 1), w: null, custom: true, index: i + 1,
      get name() { return part("name") || "自訂品項 " + (i + 1); },
      get spec() { return part("spec"); },
      get code() { return part("code"); },
    };
  }

  function findItem(id) {
    var k = id.split(":")[0];
    for (var i = 0; i < ITEMS[k].length; i++) if (ITEMS[k][i].id === id) return ITEMS[k][i];
    return null;
  }

  function fmt(n, d) {
    return Number(n).toLocaleString("zh-TW", { minimumFractionDigits: 0, maximumFractionDigits: d == null ? 2 : d });
  }
  function unitW(it) { return it.w != null ? it.w : (parseFloat(S.uw[it.id]) || 0); }
  function qtyOf(it) { return parseFloat(S.qty[it.id]) || 0; }
  function subOf(it) { return Math.round(unitW(it) * qtyOf(it) * 1000) / 1000; }
  function groupOf(it) { return it.custom ? CUSTOM_GROUP : it.name.replace(/^\(輕\)/, "").trim(); }

  function totals(k) {
    var w = 0, c = 0;
    ITEMS[k].forEach(function (it) { w += subOf(it); c += qtyOf(it); });
    return { w: Math.round(w * 1000) / 1000, c: c };
  }

  // 數字＋單位（單位用較小的字）
  function setNum(node, value, unit) {
    node.replaceChildren(document.createTextNode(value), el("i", null, unit));
  }

  // ---------- 搜尋 ----------
  // 中文與數字／英文自動拆開分別比對，例如「橫1.8」= 含「橫」且含「1.8」
  function tokens() {
    return $("q").value.trim().toLowerCase()
      .match(/[㐀-鿿豈-﫿]+|[^\s㐀-鿿豈-﫿]+/g) || [];
  }
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function matches(it, q) {
    var hay = (it.name + " " + it.spec + " " + it.code).toLowerCase();
    return q.every(function (t) {
      // 數字要從數字開頭比對：「3」找得到 3.0m，不會找到 60.3；輸入完整 NO. 也可以
      if (/^[\d.]/.test(t)) return new RegExp("(^|[^\\d.])" + escRe(t)).test(hay) || t === String(it.no).toLowerCase();
      return hay.indexOf(t) !== -1;
    });
  }

  // ---------- 品項清單 ----------
  function input(attrs) {
    var n = el("input");
    Object.keys(attrs).forEach(function (k) { n[k] = attrs[k]; });
    return n;
  }

  function renderList() {
    var list = $("list");
    var q = tokens();
    var only = $("only-filled").checked;
    var items = ITEMS[S.tab].filter(function (it) {
      if (only && !qtyOf(it)) return false;
      return matches(it, q);
    });
    list.setAttribute("aria-labelledby", "tab-" + S.tab);
    list.replaceChildren();

    var head = el("div", "w-row w-head");
    ["NO.", "品名／規格／代號", "單重 kg", "數量", "小計 kg"].forEach(function (t) { head.appendChild(el("div", null, t)); });
    list.appendChild(head);

    var groupSum = {};
    items.forEach(function (it) { var g = groupOf(it); groupSum[g] = (groupSum[g] || 0) + subOf(it); });

    var last = null;
    items.forEach(function (it) {
      var g = groupOf(it);
      if (g !== last) {
        var gr = el("div", "w-grp");
        gr.appendChild(el("span", null, g));
        var gs = el("span", "w-num", groupSum[g] ? fmt(groupSum[g]) + " kg" : "");
        gs.dataset.g = it.kind + "|" + g;
        gr.appendChild(gs);
        list.appendChild(gr);
        last = g;
      }
      list.appendChild(renderRow(it));
    });

    if (!items.length) {
      list.appendChild(el("p", "w-empty", only ? "這一頁還沒有填數量的品項。" : "找不到符合的品項，試試別的關鍵字。"));
    }
  }

  function renderRow(it) {
    var row = el("div", "w-row" + (qtyOf(it) ? " on" : ""));
    row.dataset.row = it.id;
    row.appendChild(el("div", "w-no", it.no));

    // 品名
    var name;
    if (it.custom) {
      name = el("div", "w-name w-edit");
      var c = S.cust[it.id] || {};
      [["name", "品名（自訂品項 " + it.index + "）", ""], ["spec", "規格", "w-small"], ["code", "產品代號", "w-small"]].forEach(function (f) {
        var inp = input({ type: "text", maxLength: 60, placeholder: f[1], value: c[f[0]] || "", className: f[2] });
        inp.setAttribute("aria-label", "自訂品項 " + it.index + " " + f[1].replace(/（.*/, ""));
        inp.dataset.cust = it.id;
        inp.dataset.field = f[0];
        name.appendChild(inp);
      });
    } else {
      name = el("div", "w-name");
      name.appendChild(el("b", null, it.name));
      if (it.code) name.appendChild(el("code", "w-code", it.code));
      name.appendChild(el("span", null, it.spec || "—"));
    }
    row.appendChild(name);

    // 單重
    var unit = el("div", "w-unit");
    if (it.w != null) {
      unit.textContent = fmt(it.w, 3);
    } else {
      var uw = input({ type: "number", step: "any", min: "0", inputMode: "decimal", placeholder: it.custom ? "單重" : "待填", value: S.uw[it.id] != null ? S.uw[it.id] : "" });
      uw.setAttribute("aria-label", it.name + " 單重（kg）");
      uw.dataset.uw = it.id;
      unit.appendChild(uw);
    }
    row.appendChild(unit);

    // 數量
    var qty = el("div", "w-qty");
    var minus = el("button", null, "−");
    minus.type = "button";
    minus.dataset.step = "-1";
    minus.dataset.id = it.id;
    minus.setAttribute("aria-label", "減少 " + it.name);
    var qi = input({ type: "number", min: "0", step: "1", inputMode: "numeric", placeholder: "0", value: S.qty[it.id] != null ? S.qty[it.id] : "" });
    qi.setAttribute("aria-label", it.name + " " + it.spec + " 數量");
    qi.dataset.q = it.id;
    var plus = el("button", null, "+");
    plus.type = "button";
    plus.dataset.step = "1";
    plus.dataset.id = it.id;
    plus.setAttribute("aria-label", "增加 " + it.name);
    qty.appendChild(minus);
    qty.appendChild(qi);
    qty.appendChild(plus);
    row.appendChild(qty);

    var s = subOf(it);
    var sub = el("div", "w-sub" + (s ? "" : " zero"), s ? fmt(s) : "0");
    sub.dataset.sub = it.id;
    row.appendChild(sub);
    return row;
  }

  // 只更新一列與分組小計，避免輸入時整個清單重畫、游標跳掉
  function updateRow(id) {
    var it = findItem(id);
    if (!it) return;
    var row = document.querySelector('[data-row="' + id + '"]');
    if (row) {
      var s = subOf(it);
      row.classList.toggle("on", !!qtyOf(it));
      var c = row.querySelector("[data-sub]");
      c.textContent = s ? fmt(s) : "0";
      c.classList.toggle("zero", !s);
    }
    var g = groupOf(it);
    var key = it.kind + "|" + g;
    var gs = Array.prototype.find.call(document.querySelectorAll("[data-g]"), function (n) { return n.dataset.g === key; });
    if (gs) {
      var t = ITEMS[it.kind].filter(function (x) { return groupOf(x) === g; }).reduce(function (a, x) { return a + subOf(x); }, 0);
      gs.textContent = t ? fmt(t) + " kg" : "";
    }
  }

  // ---------- 合計與明細 ----------
  function renderTotals() {
    var h = totals("heavy"), l = totals("light"), all = Math.round((h.w + l.w) * 1000) / 1000;
    setNum($("t-heavy"), fmt(h.w), "kg");
    setNum($("t-light"), fmt(l.w), "kg");
    setNum($("t-all"), fmt(all), "kg");
    $("t-ton").textContent = "總重 · " + (all / 1000).toFixed(3) + " 噸";
    setNum($("t-count"), fmt(h.c + l.c, 0), "支");
    $("c-heavy").textContent = h.w ? fmt(h.w, 0) + " kg" : "";
    $("c-light").textContent = l.w ? fmt(l.w, 0) + " kg" : "";

    var table = $("summary");
    table.replaceChildren();
    var any = false;
    KINDS.forEach(function (k) {
      ITEMS[k].forEach(function (it) {
        if (!qtyOf(it)) return;
        any = true;
        var tr = el("tr");
        tr.appendChild(el("td", null, LABEL[k] + "｜" + (it.code ? it.code + " " : "") + it.name + " " + it.spec + " × " + fmt(qtyOf(it), 0)));
        tr.appendChild(el("td", null, fmt(subOf(it)) + " kg"));
        table.appendChild(tr);
      });
    });
    if (any) {
      var tr = el("tr", "w-sum-total");
      tr.appendChild(el("td", null, "合計"));
      tr.appendChild(el("td", null, fmt(all) + " kg"));
      table.appendChild(tr);
    } else {
      var empty = el("tr");
      var td = el("td", "w-muted", "在上方輸入數量後，品項會列在這裡。");
      td.colSpan = 2;
      empty.appendChild(td);
      table.appendChild(empty);
    }
    renderFleet(all);
  }

  // ---------- 車輛試算 ----------
  function capKg(k) { return (parseFloat(S.cap[k]) || 0) * 1000; }
  function truckLabel(k) { var c = parseFloat(S.cap[k]); return TNAME[k] + (c > 0 ? " " + fmt(c) + " 噸" : ""); }
  function truckType() { return S.truck === AUTO ? "自動搭配" : truckLabel(S.truck); }

  // 回傳每台車 {k: 車種, load: 裝載 kg, cap: 上限 kg}；error 表示缺少載重設定
  function fleetPlan(totalKg) {
    var list = [];
    if (S.truck !== AUTO) {
      var cap = capKg(S.truck);
      if (!cap) return { error: TNAME[S.truck] };
      var n = totalKg > 0 ? Math.ceil(totalKg / cap - 1e-9) : 0;
      var left = totalKg;
      for (var i = 0; i < n; i++) { var ld = Math.min(cap, left); list.push({ k: S.truck, load: ld, cap: cap }); left -= ld; }
      return { list: list };
    }
    // 自動搭配：先用板車裝滿，剩下的重量優先配裝得下的最小貨車，貨車裝不下才配吊車，都不行再加一台板車
    var big = capKg("板車");
    if (!big) return { error: "板車" };
    if (totalKg <= 0) return { list: [] };
    if (totalKg <= big + 1e-6) return { list: [{ k: "板車", load: totalKg, cap: big }] };
    var full = Math.floor(totalKg / big + 1e-9);
    for (var j = 0; j < full; j++) list.push({ k: "板車", load: big, cap: big });
    var rest = totalKg - full * big;
    if (rest > 1e-6) {
      function fitOf(kind) {
        return TRUCKS.filter(function (t) { return t[1] === kind && capKg(t[0]) >= rest - 1e-6; })
          .sort(function (a, b) { return capKg(a[0]) - capKg(b[0]); })[0];
      }
      var fit = fitOf("貨車") || fitOf("吊車");
      var k = fit ? fit[0] : "板車";
      list.push({ k: k, load: rest, cap: capKg(k) });
    }
    return { list: list };
  }

  function fleetSummary(list) {
    var c = {}, order = [];
    list.forEach(function (x) { var l = truckLabel(x.k); if (!c[l]) { c[l] = 0; order.push(l); } c[l]++; });
    return order.map(function (l) { return l + " × " + c[l]; }).join("＋");
  }

  function renderTruckButtons() {
    var seg = $("truck-seg");
    seg.replaceChildren();
    [AUTO].concat(TRUCKS.map(function (t) { return t[0]; })).forEach(function (k) {
      var b = el("button");
      b.type = "button";
      b.dataset.truck = k;
      b.setAttribute("aria-pressed", String(k === S.truck));
      if (k === AUTO) {
        b.textContent = "自動搭配";
      } else {
        b.textContent = TNAME[k];
        var c = parseFloat(S.cap[k]);
        if (c > 0) b.appendChild(el("small", null, fmt(c) + "t"));
      }
      seg.appendChild(b);
    });
  }

  function renderFleet(all) {
    renderTruckButtons();
    var auto = S.truck === AUTO;
    $("cap-wrap").hidden = auto;
    var capEl = $("f-cap");
    if (!auto && document.activeElement !== capEl) capEl.value = S.cap[S.truck];
    $("t-truck-label").textContent = truckType();

    var verdict = $("verdict");
    var trucks = $("trucks");
    verdict.replaceChildren();
    trucks.replaceChildren();

    var p = fleetPlan(all);
    if (p.error) {
      setNum($("t-trucks"), "—", "");
      verdict.appendChild(el("span", "w-muted", "請先填入" + p.error + "每車載重上限（噸），即可算出需要幾台車。"));
      return;
    }
    var L = p.list, n = L.length;
    setNum($("t-trucks"), String(n), "台");
    if (!n) {
      verdict.appendChild(el("span", "w-muted", "輸入數量後會算出需要的車數。" + (auto ? "超過一台板車時，剩下的重量會自動搭配貨車或吊車。" : "")));
      return;
    }
    var last = L[n - 1];
    var spare = Math.max(0, last.cap - last.load);
    verdict.appendChild(el("b", null, auto ? "需要 " + n + " 台車" : "需要 " + n + " 台" + TNAME[S.truck]));
    verdict.appendChild(el("span", "w-pill " + (n > 1 ? "over" : "ok"),
      auto ? fleetSummary(L) : (n > 1 ? "超過單車 " + fmt(last.cap / 1000) + " 噸" : "未超過 " + fmt(last.cap / 1000) + " 噸")));
    verdict.appendChild(el("span", "w-muted", "最後一台還可裝 " + fmt(spare, 0) + " kg"));

    L.forEach(function (x, i) {
      var pct = Math.min(100, x.load / x.cap * 100);
      var t = el("div", "w-truck" + (pct >= 99.99 ? " full" : ""));
      var lbl = el("span", "w-lbl", "第 " + (i + 1) + " 車 ");
      lbl.appendChild(el("b", null, TNAME[x.k]));
      var meter = el("div", "w-meter");
      meter.setAttribute("role", "img");
      meter.setAttribute("aria-label", "第 " + (i + 1) + " 車 " + TNAME[x.k] + " 裝載 " + pct.toFixed(0) + "%");
      var bar = el("i");
      bar.style.width = pct + "%";
      meter.appendChild(bar);
      t.appendChild(lbl);
      t.appendChild(meter);
      t.appendChild(el("span", "w-val", (x.load / 1000).toFixed(3) + " / " + fmt(x.cap / 1000) + " 噸"));
      trucks.appendChild(t);
    });
  }

  $("truck-seg").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-truck]");
    if (!b) return;
    S.truck = b.dataset.truck;
    save();
    renderTotals();
  });
  $("f-cap").addEventListener("input", function () {
    if (S.truck === AUTO) return;
    S.cap[S.truck] = $("f-cap").value;
    save();
    renderTotals();
  });

  // ---------- 輸入 ----------
  function setQty(id, v) {
    v = String(v).trim();
    var n = Math.floor(Number(v));
    if (v === "" || !(n > 0)) delete S.qty[id];
    else S.qty[id] = Math.min(n, 999999);
    save();
    updateRow(id);
    renderTotals();
  }

  $("list").addEventListener("input", function (e) {
    var t = e.target;
    if (t.dataset.q) setQty(t.dataset.q, t.value);
    if (t.dataset.cust) {
      var id = t.dataset.cust;
      var c = S.cust[id] || (S.cust[id] = {});
      c[t.dataset.field] = t.value;
      if (!c.name && !c.spec && !c.code) delete S.cust[id];
      save();
      renderTotals();
    }
    if (t.dataset.uw) {
      if (t.value === "") delete S.uw[t.dataset.uw];
      else S.uw[t.dataset.uw] = t.value;
      save();
      updateRow(t.dataset.uw);
      renderTotals();
    }
  });

  $("list").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-step]");
    if (!b) return;
    var id = b.dataset.id;
    var n = Math.max(0, (parseFloat(S.qty[id]) || 0) + Number(b.dataset.step));
    var inp = document.querySelector('[data-q="' + id + '"]');
    if (inp) inp.value = n || "";
    setQty(id, n);
  });

  document.querySelectorAll(".w-tabs button").forEach(function (b) {
    b.addEventListener("click", function () {
      S.tab = b.dataset.k;
      save();
      syncTabs();
      renderList();
    });
  });
  function syncTabs() {
    document.querySelectorAll(".w-tabs button").forEach(function (x) {
      x.setAttribute("aria-selected", String(x.dataset.k === S.tab));
    });
  }

  $("q").addEventListener("input", renderList);
  $("only-filled").addEventListener("change", renderList);

  // ---------- 出貨資料 ----------
  var FIELDS = { "f-date": "date", "f-cust": "cust" };
  // v1.3.1 起不再使用合約編號、車次，清掉舊版留下的資料
  if ("contract" in S.f || "trip" in S.f) { delete S.f.contract; delete S.f.trip; save(); }
  Object.keys(FIELDS).forEach(function (id) {
    var k = FIELDS[id];
    var node = $(id);
    node.value = S.f[k] != null ? S.f[k] : (k === "date" ? new Date().toLocaleDateString("sv-SE") : "");
    node.addEventListener("input", function () { S.f[k] = node.value; save(); });
  });

  // ---------- 全部清除（就地確認） ----------
  function renderClear(confirming) {
    var wrap = $("clear-wrap");
    wrap.replaceChildren();
    if (!confirming) {
      var b = el("button", "secondary w-warn", "全部清除");
      b.type = "button";
      b.addEventListener("click", function () { renderClear(true); });
      wrap.appendChild(b);
      return;
    }
    var box = el("span", "w-confirm", "清除所有數量？");
    var yes = el("button", "w-warn-solid", "清除");
    yes.type = "button";
    yes.addEventListener("click", function () {
      S.qty = {};
      save();
      renderList();
      renderTotals();
      renderClear(false);
      toast("已清除所有數量");
    });
    var no = el("button", "secondary", "取消");
    no.type = "button";
    no.addEventListener("click", function () { renderClear(false); });
    box.appendChild(yes);
    box.appendChild(no);
    wrap.appendChild(box);
    no.focus();
  }

  // ---------- 複製清單 ----------
  function toast(m) {
    var t = $("toast");
    t.textContent = m;
    t.classList.add("show");
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.classList.remove("show"); }, 1800);
  }

  function listText() {
    var f = S.f, h = totals("heavy"), l = totals("light");
    var txt = "日期：" + $("f-date").value + "　客戶：" + (f.cust || "") + "　車種：" + truckType() + "\n";
    KINDS.forEach(function (k) {
      var rows = ITEMS[k].filter(qtyOf);
      if (!rows.length) return;
      txt += "\n【" + LABEL[k] + "】\n";
      rows.forEach(function (it) {
        txt += (it.code ? it.code + " " : "") + it.name + " " + it.spec + "　" + fmt(unitW(it), 3) + "kg × " +
          fmt(qtyOf(it), 0) + " = " + fmt(subOf(it)) + " kg\n";
      });
      txt += "小計：" + fmt(totals(k).w) + " kg\n";
    });
    var all = h.w + l.w;
    txt += "\n總數：" + fmt(h.c + l.c, 0) + "　總重：" + fmt(all) + " kg（" + (all / 1000).toFixed(3) + " 噸）";
    var p = fleetPlan(all);
    if (p.list && p.list.length) {
      txt += "\n車輛：共 " + p.list.length + " 台（" + fleetSummary(p.list) + "）\n" + p.list.map(function (x, i) {
        return "　第 " + (i + 1) + " 車 " + TNAME[x.k] + "：" + (x.load / 1000).toFixed(3) + " / " + fmt(x.cap / 1000) + " 噸";
      }).join("\n");
    }
    return txt;
  }

  $("copy-btn").addEventListener("click", function () {
    var txt = listText();
    function fallback() {
      var ta = el("textarea");
      ta.value = txt;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { toast(document.execCommand("copy") ? "清單已複製" : "無法複製，請手動選取"); }
      catch (e) { toast("無法複製，請手動選取"); }
      ta.remove();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(function () { toast("清單已複製"); }, fallback);
    } else {
      fallback();
    }
  });

  // ---------- 開始 ----------
  syncTabs();
  renderClear(false);
  renderList();
  renderTotals();
})();
