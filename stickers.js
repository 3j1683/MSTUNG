// 客戶貼紙：依客戶查詢貼紙樣式、滾字（字模）與貼法位置圖
(function () {
  "use strict";

  var A = window.APP;
  var $ = A.$;
  var el = A.el;
  var DATA = window.STICKER_DATA || { customers: [], unmatched: [], headers: {} };

  $("source").textContent = "客戶「貼紙」工作表（" + (DATA.title || "") + "）";
  $("die-sizes").textContent = [DATA.headers.dieL, DATA.headers.dieM, DATA.headers.dieS].filter(Boolean).join("、");

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

  function haystack(c) {
    return [c.no, c.name, c.company, c.style, c.position, c.die, c.dieL, c.note]
      .concat(c.stickers.map(function (s) { return s.caption + " " + (s.text || ""); }))
      .concat(c.positions.map(function (s) { return s.caption; }))
      .join(" ").toLowerCase();
  }
  // 比對時忽略空白、連字號、句點，電話寫「0937-234453」或「0937234453」都找得到
  function squash(s) { return s.replace(/[\s\-－–—_.．、，,()（）]/g, ""); }
  DATA.customers.forEach(function (c) { c._hay = haystack(c); });
  // haystack 先算好；noSticker 在下面定義後再補上「沒有貼紙」關鍵字


  // ---------- 放大檢視 ----------
  var viewer = $("viewer");
  function openViewer(img, caption) {
    $("viewer-img").src = img.src;
    $("viewer-img").alt = caption;
    $("viewer-cap").textContent = caption;
    if (typeof viewer.showModal === "function") viewer.showModal();
    else window.open(img.src, "_blank", "noopener");
  }
  viewer.addEventListener("click", function (e) {
    if (e.target === viewer) viewer.close(); // 點背景關閉
  });
  viewer.addEventListener("close", function () { $("viewer-img").removeAttribute("src"); });

  function imageButton(img, label) {
    var fig = el("figure", "s-fig");
    var b = el("button", "s-thumb");
    b.type = "button";
    b.setAttribute("aria-label", "放大：" + label);
    var i = el("img");
    i.src = img.src;
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
      var g = el("div", "s-imgs");
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
    return card;
  }

  // ---------- 清單 ----------
  var cards = DATA.customers.map(function (c) { return { c: c, node: renderCard(c) }; });
  var list = $("list");
  cards.forEach(function (x) { list.appendChild(x.node); });
  var empty = el("p", "card s-empty", "找不到符合的客戶，試試其他關鍵字或篩選。");
  empty.hidden = true;
  list.appendChild(empty);

  DATA.customers.forEach(function (c) { if (noSticker(c)) c._hay += " 沒有貼紙 無貼紙"; });
  var noneCount = DATA.customers.filter(noSticker).length;

  function apply() {
    var tokens = $("q").value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    var kind = $("kind").value;
    var shown = 0;
    cards.forEach(function (x) {
      var c = x.c;
      var flat = c._flat || (c._flat = squash(c._hay));
      var ok = tokens.every(function (t) { return c._hay.indexOf(t) !== -1 || (squash(t) && flat.indexOf(squash(t)) !== -1); });
      if (ok && kind === "roll") ok = hasRoll(c);
      if (ok && kind === "stick") ok = hasStick(c);
      if (ok && kind === "none") ok = noSticker(c);
      if (ok && kind === "img") ok = c.stickers.length > 0;
      if (ok && kind === "pos") ok = c.positions.length > 0;
      x.node.hidden = !ok;
      if (ok) shown++;
    });
    // 未對應客戶的圖片：沒有關鍵字、或關鍵字符合圖片上的字時才顯示
    var un = DATA.unmatched || [];
    var unHay = un.map(function (s) { return (s.caption + " " + (s.text || "")).toLowerCase(); }).join(" ");
    var unOk = un.length > 0 && !kind && tokens.every(function (t) { return unHay.indexOf(t) !== -1 || (squash(t) && squash(unHay).indexOf(squash(t)) !== -1); });
    $("unmatched-card").hidden = !unOk;
    empty.hidden = shown > 0 || unOk;
    $("count").textContent = "共 " + DATA.customers.length + " 家客戶（" + noneCount + " 家沒有貼紙）" +
      (shown !== DATA.customers.length ? "，符合 " + shown + " 家" : "") + "。";
  }
  $("q").addEventListener("input", apply);
  $("kind").addEventListener("change", apply);

  // 未對應客戶的圖片
  if (DATA.unmatched && DATA.unmatched.length) {
    var u = $("unmatched");
    DATA.unmatched.forEach(function (s, i) { u.appendChild(imageButton(s, "未對應圖片 " + (i + 1) + "：" + s.caption)); });
  }

  apply();
})();
