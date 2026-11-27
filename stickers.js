// 客戶貼紙：依客戶查詢貼紙樣式、滾字（字模）與貼法位置圖
// 先顯示 stickers-data.js 的原始資料，再用 Supabase 的最新修改（sticker_current）蓋過去
(function () {
  "use strict";

  var A = window.APP;
  var $ = A.$;
  var el = A.el;
  var DATA = window.STICKER_DATA || { customers: [], unmatched: [], headers: {} };
  var cfg = window.APP_CONFIG || {};
  var PHOTO_BASE = (cfg.SUPABASE_URL || "") + "/storage/v1/object/public/sticker-photos/";

  $("source").textContent = "客戶「貼紙」工作表（" + (DATA.title || "") + "）";
  $("die-sizes").textContent = [DATA.headers.dieL, DATA.headers.dieM, DATA.headers.dieS].filter(Boolean).join("、");

  // 圖片位置：stickers/… 是網站內建的圖；sb:… 是現場上傳到 Supabase 的照片
  function imgUrl(src) { return /^sb:/.test(src) ? PHOTO_BASE + src.slice(3) : src; }

  // 「滾中間-貼頭邊」→「滾中間」「貼頭邊」
  function positionParts(s) {
    return String(s || "").split(/[-、，,\/\n]+|\s{1,}(?=[滾貼])/).map(function (x) { return x.trim(); })
      .filter(function (x) { return x && !/^[×X無]/.test(x); }); // 「×貼紙」「無」改用「沒有貼紙」提示
  }

  // 沒有貼紙：檔案明確寫「無／X／×貼紙」，或完全沒有寫貼紙（沒有貼紙公司、樣式、圖片，位置也沒有「貼」）
  function isNeg(s) { return /^(無|X|×|x)$/.test(String(s || "").trim()); }
  function noSticker(c) {
    var explicit = isNeg(c.company) || isNeg(c.style) || /^[×X]\s*貼紙/.test(c.position) || (isNeg(c.position) && !c.company);
    var missing = !c.stickers.length && !c.company && !c.style && !/貼/.test(c.position);
    return explicit || missing;
  }

  function hasRoll(c) {
    return /滾/.test(c.position) || (c.die && !/^[X×x]$/.test(c.die));
  }
  function hasStick(c) {
    return !noSticker(c) && (/貼/.test(c.position) || c.stickers.length > 0 || !!c.company);
  }

  // 比對時忽略空白、連字號、句點，電話寫「0937-234453」或「0937234453」都找得到
  function squash(s) { return s.replace(/[\s\-－–—_.．、，,()（）]/g, ""); }
  function prepare(c) {
    c._hay = [c.no, c.name, c.company, c.style, c.position, c.die, c.dieL, c.note]
      .concat(c.stickers.map(function (s) { return (s.caption || "") + " " + (s.text || ""); }))
      .concat(c.positions.map(function (s) { return s.caption || ""; }))
      .join(" ").toLowerCase();
    if (noSticker(c)) c._hay += " 沒有貼紙 無貼紙";
    c._flat = squash(c._hay);
    return c;
  }

  // 目前顯示的客戶：原始資料（加上 _orig 供還原）＋ Supabase 的最新修改
  var base = DATA.customers.map(function (c) {
    var x = JSON.parse(JSON.stringify(c));
    x._orig = c;
    x._edit = null;
    return x;
  });
  var customers = base.slice();

  // ---------- 放大檢視 ----------
  var viewer = $("viewer");
  var vImg = $("viewer-img");
  var vWrap = $("viewer-wrap");
  var zoomBtn = $("zoom-btn");
  var origBtn = $("orig-btn");
  var current = null;   // 目前放大的圖片
  var showingFull = false;

  function setZoom(on) {
    vWrap.classList.toggle("zoomed", on);
    zoomBtn.textContent = on ? "縮小" : "放大";
    zoomBtn.setAttribute("aria-pressed", String(on));
    if (on) {
      // 放大後先捲到中間
      requestAnimationFrame(function () {
        vWrap.scrollLeft = (vWrap.scrollWidth - vWrap.clientWidth) / 2;
        vWrap.scrollTop = (vWrap.scrollHeight - vWrap.clientHeight) / 2;
      });
    }
  }
  function showSrc(full) {
    showingFull = full;
    vImg.src = imgUrl(full ? current.full.src : current.src);
    origBtn.textContent = full ? "看貼紙特寫" : "看原圖";
  }
  function openViewer(img, caption) {
    current = img;
    vImg.alt = caption;
    $("viewer-cap").textContent = caption;
    origBtn.hidden = !img.full;
    showSrc(false);
    setZoom(false);
    if (typeof viewer.showModal === "function") viewer.showModal();
    else window.open(imgUrl(img.src), "_blank", "noopener");
  }
  zoomBtn.addEventListener("click", function () { setZoom(!vWrap.classList.contains("zoomed")); });
  vImg.addEventListener("click", function () { setZoom(!vWrap.classList.contains("zoomed")); }); // 點圖片也能放大／縮小
  origBtn.addEventListener("click", function () { showSrc(!showingFull); setZoom(false); });
  viewer.addEventListener("click", function (e) {
    if (e.target === viewer) viewer.close(); // 點背景關閉
  });
  viewer.addEventListener("close", function () { vImg.removeAttribute("src"); current = null; });

  function imageButton(img, label, extraClass) {
    var fig = el("figure", "s-fig" + (extraClass ? " " + extraClass : ""));
    var b = el("button", "s-thumb");
    b.type = "button";
    b.setAttribute("aria-label", "放大：" + label);
    var i = el("img");
    i.src = imgUrl(img.src);
    i.alt = label;
    i.loading = "lazy";
    i.decoding = "async";
    i.width = img.w;
    i.height = img.h;
    b.appendChild(i);
    b.addEventListener("click", function () { openViewer(img, label); });
    fig.appendChild(b);
    if (img.caption) fig.appendChild(el("figcaption", null, img.caption));
    return fig;
  }

  // ---------- 現場修改 ----------
  // editState：loading 讀取中／on 可以修改／off 未設定 Supabase／notready 尚未執行 SQL／error 讀取失敗
  var editState = A.ready ? "loading" : "off";
  var editor = null;
  function canEdit() { return editState === "on" && !!editor; }

  // ---------- 客戶卡片 ----------
  function row(dl, term, value) {
    if (!value) return;
    dl.appendChild(el("dt", null, term));
    dl.appendChild(el("dd", null, value));
  }

  function renderCard(c) {
    var card = el("article", "card s-card");
    var head = el("div", "s-head");
    if (c.no) head.appendChild(el("span", "s-no", "No." + c.no));
    head.appendChild(el("h3", null, c.name || c.company));
    card.appendChild(head);

    var none = noSticker(c);
    var parts = positionParts(c.position);
    if (parts.length || none) {
      var tags = el("div", "s-tags");
      if (none) tags.appendChild(el("span", "s-tag none", "沒有貼紙"));
      parts.forEach(function (p) {
        var cls = /^滾/.test(p) ? "s-tag roll" : /^貼/.test(p) ? "s-tag stick" : "s-tag";
        tags.appendChild(el("span", cls, p));
      });
      card.appendChild(tags);
    }
    if (none) {
      var warn = el("p", "s-warn", "⚠ 這位客戶沒有貼紙。");
      warn.setAttribute("role", "note");
      warn.appendChild(el("span", null, hasRoll(c) ? "只滾字，不用貼紙。" : "檔案沒有寫貼紙。"));
      card.appendChild(warn);
      card.classList.add("s-nosticker");
    }

    var dl = el("dl", "s-dl");
    if (c.company && c.company !== c.name) row(dl, "貼紙公司名", c.company);
    row(dl, "貼紙樣式", c.style);
    row(dl, "滾字（字模）", c.die);
    row(dl, "字模數量", c.qty);
    var sizes = [];
    if (c.dieL) sizes.push("廠商（大）" + c.dieL);
    if (c.dieM) sizes.push("年（中）" + c.dieM);
    if (c.dieS) sizes.push("月（小）" + c.dieS);
    row(dl, "字模明細", sizes.join("　"));
    row(dl, "備註", c.note);
    if (dl.childNodes.length) card.appendChild(dl);

    if (c.stickers.length) {
      card.appendChild(el("h4", "s-sub", "貼紙樣式"));
      var g = el("div", "s-imgs s-big");
      c.stickers.forEach(function (s, i) {
        g.appendChild(imageButton(s, (c.name || c.company) + " 貼紙" + (c.stickers.length > 1 ? " " + (i + 1) : "") +
          (s.caption ? "（" + s.caption + "）" : "") + (s.text ? "：" + s.text : "")));
      });
      card.appendChild(g);
    }
    if (c.positions.length) {
      card.appendChild(el("h4", "s-sub", "貼法位置圖"));
      var p = el("div", "s-imgs s-pos");
      c.positions.forEach(function (s, i) {
        p.appendChild(imageButton(s, (c.name || c.company) + " 貼法位置圖 " + (i + 1) + "：" + s.caption));
      });
      card.appendChild(p);
    }

    if (c._edit) {
      card.appendChild(el("p", "s-edited", "最後修改：" + A.fmtTime(c._edit.at) + "　" + c._edit.editor));
    }
    if (canEdit()) {
      var acts = el("div", "s-actions");
      var shoot = el("button", null, "拍照更新");
      shoot.type = "button";
      shoot.addEventListener("click", function () { editor.photo(c, true); });
      var edit = el("button", "secondary", "修改");
      edit.type = "button";
      edit.addEventListener("click", function () { editor.edit(c); });
      acts.appendChild(shoot);
      acts.appendChild(edit);
      card.appendChild(acts);
    }
    return card;
  }

  // ---------- 清單 ----------
  var list = $("list");
  var gallery = $("gallery");
  var cards = [];
  var tiles = [];
  var empty = el("p", "card s-empty", "找不到符合的客戶，試試其他關鍵字或篩選。");
  var gEmpty = el("p", "card s-empty", "符合的客戶沒有貼紙圖片。");
  var noneCount = 0;

  function renderAll() {
    customers.forEach(prepare);
    noneCount = customers.filter(noSticker).length;
    cards = customers.map(function (c) { return { c: c, node: renderCard(c) }; });
    list.replaceChildren();
    cards.forEach(function (x) { list.appendChild(x.node); });
    list.appendChild(empty);
    // 「只看貼紙圖」：每張貼紙一格，大圖顯示
    tiles = [];
    gallery.replaceChildren();
    customers.forEach(function (c) {
      c.stickers.forEach(function (s, i) {
        var name = c.name || c.company;
        var fig = imageButton(s, name + " 貼紙" + (c.stickers.length > 1 ? " " + (i + 1) : "") +
          (s.caption ? "（" + s.caption + "）" : "") + (s.text ? "：" + s.text : ""), "s-tile");
        var cap = fig.querySelector("figcaption") || fig.appendChild(el("figcaption"));
        cap.replaceChildren(el("b", null, (c.no ? "No." + c.no + " " : "") + name));
        if (s.caption) cap.appendChild(el("span", null, s.caption));
        gallery.appendChild(fig);
        tiles.push({ c: c, node: fig });
      });
    });
    gallery.appendChild(gEmpty);
    apply();
  }

  var VIEW_KEY = "mstung-sticker-view";
  var view = "cards";
  try { if (localStorage.getItem(VIEW_KEY) === "gallery") view = "gallery"; } catch (e) { /* 略過 */ }
  document.querySelectorAll(".s-view button").forEach(function (b) {
    b.addEventListener("click", function () {
      view = b.dataset.view;
      try { localStorage.setItem(VIEW_KEY, view); } catch (e) { /* 略過 */ }
      apply();
    });
  });

  function apply() {
    var tokens = $("q").value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    var kind = $("kind").value;
    var shown = 0;
    cards.forEach(function (x) {
      var c = x.c;
      var ok = tokens.every(function (t) { return c._hay.indexOf(t) !== -1 || (squash(t) && c._flat.indexOf(squash(t)) !== -1); });
      if (ok && kind === "roll") ok = hasRoll(c);
      if (ok && kind === "stick") ok = hasStick(c);
      if (ok && kind === "none") ok = noSticker(c);
      if (ok && kind === "img") ok = c.stickers.length > 0;
      if (ok && kind === "pos") ok = c.positions.length > 0;
      if (ok && kind === "edited") ok = !!c._edit;
      x.node.hidden = !ok;
      x.ok = ok;
      if (ok) shown++;
    });
    var tilesShown = 0;
    var okSet = new Set(cards.filter(function (x) { return x.ok; }).map(function (x) { return x.c; }));
    tiles.forEach(function (t) { t.node.hidden = !okSet.has(t.c); if (!t.node.hidden) tilesShown++; });
    var g = view === "gallery";
    list.hidden = g;
    gallery.hidden = !g;
    gEmpty.hidden = tilesShown > 0;
    document.querySelectorAll(".s-view button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.view === view)); });
    // 未對應客戶的圖片：沒有關鍵字、或關鍵字符合圖片上的字時才顯示
    var un = DATA.unmatched || [];
    var unHay = un.map(function (s) { return (s.caption + " " + (s.text || "")).toLowerCase(); }).join(" ");
    var unOk = un.length > 0 && !kind && tokens.every(function (t) { return unHay.indexOf(t) !== -1 || (squash(t) && squash(unHay).indexOf(squash(t)) !== -1); });
    $("unmatched-card").hidden = !unOk;
    empty.hidden = shown > 0 || unOk;
    $("count").textContent = "共 " + customers.length + " 家客戶（" + noneCount + " 家沒有貼紙）" +
      (shown !== customers.length ? "，符合 " + shown + " 家" : "") + (g ? "，顯示 " + tilesShown + " 張貼紙圖" : "") + "。";
  }
  $("q").addEventListener("input", apply);
  $("kind").addEventListener("change", apply);

  // 未對應客戶的圖片
  if (DATA.unmatched && DATA.unmatched.length) {
    var u = $("unmatched");
    DATA.unmatched.forEach(function (s, i) { u.appendChild(imageButton(s, "未對應圖片 " + (i + 1) + "：" + s.caption)); });
  }

  // ---------- 讀取最新修改 ----------
  var editBar = $("edit-bar");
  var editStatus = $("edit-status");
  var lastLoad = 0;
  var loadedIds = "";

  function showEditState() {
    var on = editState === "on";
    $("add-btn").hidden = !on;
    editBar.hidden = editState === "off";
    editStatus.className = "hint left" + (on || editState === "loading" ? "" : " s-editoff");
    editStatus.textContent = {
      loading: "讀取最新修改中…",
      on: "現場有變更：在客戶卡片按「拍照更新」或「修改」，存檔後所有人馬上看得到，每次修改都有紀錄可以還原。",
      notready: "現場修改功能尚未啟用（需要系統管理員在 Supabase 執行 supabase/update_v1.7.sql）。",
      error: "無法讀取最新修改，目前顯示原始資料；網路恢復後重新整理頁面才能修改。",
    }[editState] || "";
  }

  function merge(rows) {
    var byKey = {};
    rows.forEach(function (r) { byKey[r.customer_key] = r; });
    var next = base.map(function (b) {
      var r = byKey[b.key];
      if (!r) return b;
      delete byKey[b.key];
      return editor.rowToCustomer(r, b._orig);
    });
    // 現場新增的客戶：依編號排在後面
    var added = Object.keys(byKey).map(function (k) { return editor.rowToCustomer(byKey[k], null); });
    added.sort(function (a, b) { return (parseInt(a.no, 10) || 1e9) - (parseInt(b.no, 10) || 1e9) || a._edit.id - b._edit.id; });
    return next.concat(added);
  }

  function loadEdits(quiet) {
    if (!A.ready || !editor) return Promise.resolve();
    lastLoad = Date.now();
    return A.publicDb.from("sticker_current").select("*").then(function (r) {
      if (r.error) {
        var missing = r.error.code === "PGRST205" || r.error.code === "42P01" || /schema cache|does not exist/i.test(r.error.message || "");
        if (quiet && editState === "on" && !missing) return; // 背景更新失敗：維持目前畫面
        editState = missing ? "notready" : "error";
        showEditState();
        renderAll();
        return;
      }
      var ids = r.data.map(function (x) { return x.id; }).sort().join(",");
      var changed = ids !== loadedIds || editState !== "on";
      loadedIds = ids;
      editState = "on";
      showEditState();
      if (changed) {
        customers = merge(r.data);
        renderAll();
      }
    }).catch(function () {
      if (quiet && editState === "on") return;
      editState = "error";
      showEditState();
      renderAll();
    });
  }

  if (A.ready && window.createStickerEditor) {
    editor = window.createStickerEditor({
      db: A.publicDb,
      imgUrl: imgUrl,
      dieHeaders: DATA.headers,
      sourceTitle: DATA.title,
      canEdit: canEdit,
      onSaved: function (c) {
        var i = customers.findIndex(function (x) { return x.key === c.key; });
        if (i === -1) customers.push(c); else customers[i] = c;
        loadedIds = ""; // 下次背景更新時重新比對
        renderAll();
      },
      onConflict: function () { loadEdits(true); },
    });
    $("add-btn").addEventListener("click", function () { editor.add(); });
    // 回到這個頁面時（例如從相機或其他 App 切回來），超過 1 分鐘就重新讀取別人的修改
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible" && Date.now() - lastLoad > 60000 &&
          !$("editor").open && !$("cropper").open) loadEdits(true);
    });
  } else if (A.ready) {
    editState = "off";
  }

  showEditState();
  renderAll();
  loadEdits(false);
})();
