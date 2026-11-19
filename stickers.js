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
    return String(s || "").split(/[-、\/\n]+|\s{1,}(?=[滾貼])/).map(function (x) { return x.trim(); }).filter(Boolean);
  }

  function hasRoll(c) {
    return /滾/.test(c.position) || (c.die && !/^[X×x]$/.test(c.die));
  }
  function hasStick(c) {
    return /貼/.test(c.position) || c.stickers.length > 0;
  }

  function haystack(c) {
    return [c.no, c.name, c.company, c.style, c.position, c.die, c.dieL, c.note]
      .concat(c.stickers.map(function (s) { return s.caption; }))
      .concat(c.positions.map(function (s) { return s.caption; }))
      .join(" ").toLowerCase();
  }
  DATA.customers.forEach(function (c) { c._hay = haystack(c); });

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

    var parts = positionParts(c.position);
    if (parts.length) {
      var tags = el("div", "s-tags");
      parts.forEach(function (p) {
        var cls = /^滾/.test(p) ? "s-tag roll" : /^貼/.test(p) ? "s-tag stick" : "s-tag";
        tags.appendChild(el("span", cls, p));
      });
      card.appendChild(tags);
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
        g.appendChild(imageButton(s, (c.name || c.company) + " 貼紙" + (c.stickers.length > 1 ? " " + (i + 1) : "") + (s.caption ? "（" + s.caption + "）" : "")));
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

  function apply() {
    var tokens = $("q").value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    var kind = $("kind").value;
    var shown = 0;
    cards.forEach(function (x) {
      var c = x.c;
      var ok = tokens.every(function (t) { return c._hay.indexOf(t) !== -1; });
      if (ok && kind === "roll") ok = hasRoll(c);
      if (ok && kind === "stick") ok = hasStick(c);
      if (ok && kind === "img") ok = c.stickers.length > 0;
      if (ok && kind === "pos") ok = c.positions.length > 0;
      x.node.hidden = !ok;
      if (ok) shown++;
    });
    empty.hidden = shown > 0;
    $("count").textContent = "共 " + DATA.customers.length + " 家客戶" + (shown !== DATA.customers.length ? "，符合 " + shown + " 家" : "") + "。";
  }
  $("q").addEventListener("input", apply);
  $("kind").addEventListener("change", apply);

  // 未對應客戶的圖片
  if (DATA.unmatched && DATA.unmatched.length) {
    var u = $("unmatched");
    DATA.unmatched.forEach(function (s, i) { u.appendChild(imageButton(s, "未對應圖片 " + (i + 1) + "：" + s.caption)); });
    $("unmatched-card").hidden = false;
  }

  apply();
})();
