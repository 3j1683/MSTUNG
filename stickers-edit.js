// 客戶貼紙：現場拍照更新、修改內容、修改紀錄與還原
// 存到 Supabase：sticker_edits（每次存檔一筆完整內容）、Storage sticker-photos（照片）
// 由 stickers.js 呼叫 window.createStickerEditor(opts) 建立
(function () {
  "use strict";

  var A = window.APP;
  var $ = A.$;
  var el = A.el;

  var BUCKET = "sticker-photos";
  var NAME_KEY = "mstung-sticker-editor"; // 記住修改人
  var MAX_IMGS = 10;
  var WORK_MAX = 2000;   // 裁切時的工作圖最長邊
  var OUT_MAX = 1400;    // 存檔的貼紙圖最長邊
  var FULL_MAX = 1600;   // 裁切前原圖最長邊

  // 欄位：[屬性, 資料庫欄位, 標題, 最多字數, 說明]
  var FIELDS = [
    ["no", "no", "編號", 10, ""],
    ["name", "name", "客戶名稱", 50, ""],
    ["company", "company", "貼紙公司名", 50, "貼紙上印的公司名；沒有貼紙寫「無」"],
    ["style", "style", "貼紙樣式", 100, ""],
    ["position", "position", "滾字／貼紙位置", 100, "例：滾中間-貼頭邊；沒有貼紙寫「×貼紙」"],
    ["die", "die", "滾字（字模）", 50, "沒有字模寫 X"],
    ["qty", "qty", "字模數量", 10, ""],
    ["dieL", "die_l", "廠商（大）", 50, "V＝有、X＝沒有，或寫字模上的字"],
    ["dieM", "die_m", "年（中）", 50, ""],
    ["dieS", "die_s", "月（小）", 50, ""],
    ["note", "note", "備註", 500, ""],
  ];

  function getName() { try { return localStorage.getItem(NAME_KEY) || ""; } catch (e) { return ""; } }
  function setName(v) { try { localStorage.setItem(NAME_KEY, v); } catch (e) { /* 略過 */ } }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }
  function randHex(n) {
    var b = new Uint8Array(n);
    crypto.getRandomValues(b);
    return Array.prototype.map.call(b, function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
  }
  function pad(n) { return ("0" + n).slice(-2); }
  function stamp() {
    var d = new Date();
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  }
  function shortTime(iso) {
    var d = new Date(iso);
    return pad(d.getMonth() + 1) + "/" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  // 資料庫一筆 ↔ 頁面上的客戶
  function rowToCustomer(r, orig) {
    var c = { key: r.customer_key, stickers: r.stickers || [], positions: r.positions || [] };
    FIELDS.forEach(function (f) { c[f[0]] = r[f[1]] || ""; });
    c._orig = orig || null;
    c._edit = { id: r.id, at: r.created_at, editor: r.editor, summary: r.summary };
    return c;
  }

  function errorText(err) {
    var msg = (err && (err.message || err.error)) || "";
    if (err && err.conflict) return err.message;
    if (/bucket not found/i.test(msg)) return "照片空間還沒建立，請系統管理員執行 supabase/update_v1.7.sql。";
    if (/mime|content type|invalid.*type/i.test(msg)) return "照片格式不支援，請改用 JPG 或 PNG 照片。";
    if (/maximum allowed size|too large|payload/i.test(msg)) return "照片太大，請重拍或改選其他照片。";
    if (/PGRST205|42P01|sticker_edits|schema cache/i.test(msg) && /find|exist/i.test(msg)) return "修改功能尚未啟用，請系統管理員執行 supabase/update_v1.7.sql。";
    return A.friendlyError(err);
  }

  // ---------- 照片：讀取、轉向、裁切、壓縮 ----------
  function loadImage(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: "from-image" }).catch(function () { return loadByImg(file); });
    }
    return loadByImg(file);
  }
  function loadByImg(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var im = new Image();
      im.onload = function () { URL.revokeObjectURL(url); resolve(im); };
      im.onerror = function () { URL.revokeObjectURL(url); reject(new Error("這個檔案無法讀取，請改用 JPG 或 PNG 照片。")); };
      im.src = url;
    });
  }
  function scaled(src, sx, sy, sw, sh, maxSide) {
    var s = Math.min(1, maxSide / Math.max(sw, sh));
    var c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(sw * s));
    c.height = Math.max(1, Math.round(sh * s));
    var g = c.getContext("2d");
    g.imageSmoothingQuality = "high";
    g.fillStyle = "#ffffff"; // 透明的 PNG 轉成白底
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c;
  }
  function rotated(canvas, dir) {
    var c = document.createElement("canvas");
    c.width = canvas.height;
    c.height = canvas.width;
    var g = c.getContext("2d");
    g.translate(c.width / 2, c.height / 2);
    g.rotate(dir * Math.PI / 2);
    g.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    return c;
  }
  // 優先存成 WebP；瀏覽器不支援時改存 JPEG
  function encode(canvas) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (b) {
        if (b && b.type === "image/webp") { resolve({ blob: b, ext: "webp", w: canvas.width, h: canvas.height }); return; }
        canvas.toBlob(function (j) {
          if (j) resolve({ blob: j, ext: "jpg", w: canvas.width, h: canvas.height });
          else reject(new Error("無法處理這張照片，請重拍。"));
        }, "image/jpeg", 0.85);
      }, "image/webp", 0.82);
    });
  }

  window.createStickerEditor = function (opts) {
    var db = opts.db;
    var imgUrl = opts.imgUrl;
    var dieHeaders = opts.dieHeaders || {};

    // ---------- 選照片 ----------
    var camInput = $("photo-cam");
    var pickInput = $("photo-pick");
    var onPicked = null;
    function pickPhoto(useCamera, cb) {
      onPicked = cb;
      var input = useCamera ? camInput : pickInput;
      // 視窗開著時，視窗外的元素不能操作，所以先把選檔欄位移進最上層的視窗
      var host = $("cropper").open ? $("cropper") : $("editor").open ? $("editor") : document.body;
      if (input.parentNode !== host) host.appendChild(input);
      input.value = "";
      input.click();
    }
    [camInput, pickInput].forEach(function (input) {
      input.addEventListener("change", function () {
        var f = input.files && input.files[0];
        if (f && onPicked) onPicked(f);
      });
    });

    function toast(text) {
      var t = $("s-toast");
      t.textContent = text;
      t.classList.add("show");
      clearTimeout(toast.timer);
      toast.timer = setTimeout(function () { t.classList.remove("show"); }, 2400);
    }

    // ---------- 裁切視窗 ----------
    var cropDlg = $("cropper");
    var stage = $("crop-stage");
    var canvasEl = $("crop-canvas");
    var box = $("crop-box");
    var cropMsg = $("crop-message");
    var cropOk = $("crop-ok");
    var work = null;      // 目前的工作圖（canvas）
    var rect = null;      // 裁切範圍，0～1
    var cropJob = null;   // { camera, onDone(result), quick: {...} }
    var MIN = 0.04;

    function fitStage() {
      if (!work) return;
      var wrap = stage.parentNode;
      var maxW = wrap.clientWidth || 320;
      var maxH = Math.max(200, Math.round(window.innerHeight * 0.5));
      var s = Math.min(maxW / work.width, maxH / work.height);
      stage.style.width = Math.round(work.width * s) + "px";
      stage.style.height = Math.round(work.height * s) + "px";
    }
    function drawWork() {
      canvasEl.width = work.width;
      canvasEl.height = work.height;
      canvasEl.getContext("2d").drawImage(work, 0, 0);
      rect = { x: 0, y: 0, w: 1, h: 1 };
      fitStage();
      drawBox();
    }
    function drawBox() {
      box.style.left = rect.x * 100 + "%";
      box.style.top = rect.y * 100 + "%";
      box.style.width = rect.w * 100 + "%";
      box.style.height = rect.h * 100 + "%";
    }
    window.addEventListener("resize", function () { if (cropDlg.open) fitStage(); });

    var drag = null;
    function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
    function pointAt(e) {
      var r = stage.getBoundingClientRect();
      return { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp((e.clientY - r.top) / r.height, 0, 1) };
    }
    stage.addEventListener("pointerdown", function (e) {
      if (!work) return;
      var p = pointAt(e);
      var h = e.target.getAttribute("data-h");
      var inside = p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h;
      drag = { h: h || (e.target === box && inside ? "move" : "new"), p: p, start: copy(rect) };
      stage.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    stage.addEventListener("pointermove", function (e) {
      if (!drag) return;
      var p = pointAt(e);
      var s = drag.start;
      var L = s.x, T = s.y, R = s.x + s.w, B = s.y + s.h;
      if (drag.h === "move") {
        var dx = clamp(p.x - drag.p.x, -s.x, 1 - R);
        var dy = clamp(p.y - drag.p.y, -s.y, 1 - B);
        rect = { x: s.x + dx, y: s.y + dy, w: s.w, h: s.h };
      } else if (drag.h === "new") {
        rect = { x: Math.min(drag.p.x, p.x), y: Math.min(drag.p.y, p.y), w: Math.abs(p.x - drag.p.x), h: Math.abs(p.y - drag.p.y) };
      } else {
        if (drag.h.indexOf("w") !== -1) L = clamp(p.x, 0, R - MIN);
        if (drag.h.indexOf("e") !== -1) R = clamp(p.x, L + MIN, 1);
        if (drag.h.indexOf("n") !== -1) T = clamp(p.y, 0, B - MIN);
        if (drag.h.indexOf("s") !== -1) B = clamp(p.y, T + MIN, 1);
        rect = { x: L, y: T, w: R - L, h: B - T };
      }
      drawBox();
    });
    function endDrag() {
      if (!drag) return;
      if (rect.w < MIN || rect.h < MIN) rect = drag.start; // 只點一下：維持原來的框
      drag = null;
      drawBox();
    }
    stage.addEventListener("pointerup", endDrag);
    stage.addEventListener("pointercancel", endDrag);

    $("crop-left").addEventListener("click", function () { work = rotated(work, -1); drawWork(); });
    $("crop-right").addEventListener("click", function () { work = rotated(work, 1); drawWork(); });
    $("crop-all").addEventListener("click", function () { rect = { x: 0, y: 0, w: 1, h: 1 }; drawBox(); });
    $("crop-retake").addEventListener("click", function () {
      pickPhoto(cropJob.camera, loadIntoCropper);
    });
    $("crop-cancel").addEventListener("click", function () { cropDlg.close(); });
    cropDlg.addEventListener("close", function () { work = null; cropJob = null; canvasEl.width = 1; canvasEl.height = 1; });

    function loadIntoCropper(file) {
      cropMsg.hidden = true;
      cropOk.disabled = true;
      return loadImage(file).then(function (img) {
        var w = img.naturalWidth || img.width;
        var h = img.naturalHeight || img.height;
        work = scaled(img, 0, 0, w, h, WORK_MAX);
        if (img.close) img.close();
        if (!cropDlg.open) cropDlg.showModal();
        drawWork();
        cropOk.disabled = false;
      }).catch(function (err) {
        if (!cropDlg.open) cropDlg.showModal();
        A.show(cropMsg, err.message || "這張照片無法讀取，請重拍。", "error");
      });
    }

    // 開啟裁切：job = { camera, quick?, onDone(result) }
    function openCropper(job) {
      cropJob = job;
      var quick = !!job.quick;
      $("crop-quick").hidden = !quick;
      if (!quick) $("crop-title").textContent = "裁切照片";
      cropOk.textContent = quick ? "存檔" : "用這張";
      pickPhoto(job.camera, loadIntoCropper);
    }

    // 依裁切範圍產生要上傳的圖（裁切後的圖＋裁切前的原圖）
    function cropResult() {
      var sx = Math.round(rect.x * work.width);
      var sy = Math.round(rect.y * work.height);
      var sw = Math.max(1, Math.round(rect.w * work.width));
      var sh = Math.max(1, Math.round(rect.h * work.height));
      var whole = rect.w > 0.97 && rect.h > 0.97;
      var main = scaled(work, sx, sy, sw, sh, OUT_MAX);
      return encode(main).then(function (m) {
        if (whole) return { main: m, full: null };
        return encode(scaled(work, 0, 0, work.width, work.height, FULL_MAX)).then(function (f) {
          return { main: m, full: f };
        });
      });
    }

    cropOk.addEventListener("click", function () {
      if (!work || !cropJob) return;
      var job = cropJob;
      cropOk.disabled = true;
      cropMsg.hidden = true;
      cropResult().then(function (res) {
        return job.onDone(res);
      }).then(function (keepOpen) {
        if (!keepOpen) cropDlg.close();
      }).catch(function (err) {
        A.show(cropMsg, errorText(err), "error");
        if (err && err.conflict) opts.onConflict();
      }).then(function () {
        cropOk.disabled = false;
      });
    });

    // ---------- 圖片項目 ----------
    // item = { img: {src,w,h,caption,text,full}, orig: 原本的 img 或 null, photo: 新照片 or null, preview }
    function itemFrom(img) { return { img: copy(img), orig: copy(img), photo: null, preview: null }; }
    function applyPhoto(item, res) {
      if (item.preview) URL.revokeObjectURL(item.preview);
      item.photo = res;
      item.preview = URL.createObjectURL(res.main.blob);
      item.img.w = res.main.w;
      item.img.h = res.main.h;
      delete item.img.full;
    }
    function newItem(res, text) {
      var it = { img: { src: "", w: 1, h: 1, caption: "" }, orig: null, photo: null, preview: null };
      if (text) it.img.text = text;
      applyPhoto(it, res);
      return it;
    }
    function itemSrc(it) { return it.preview || imgUrl(it.img.src); }

    // ---------- 存檔 ----------
    function latestId(key) {
      return db.from("sticker_edits").select("id, editor, created_at").eq("customer_key", key)
        .order("id", { ascending: false }).limit(1)
        .then(function (r) {
          if (r.error) throw r.error;
          return r.data.length ? r.data[0] : null;
        });
    }

    function upload(key, res, suffix) {
      var path = key + "/" + res.name + suffix + "." + res.ext;
      return db.storage.from(BUCKET).upload(path, res.blob, {
        contentType: res.blob.type, cacheControl: "31536000", upsert: false,
      }).then(function (r) {
        if (r.error) throw r.error;
        return "sb:" + path;
      });
    }

    // draft = { fields: {...}, stickers: [item], positions: [item] }
    function save(c, draft, editor, summary, progress) {
      var baseId = c._edit ? c._edit.id : null;
      var items = draft.stickers.concat(draft.positions);
      var photos = items.filter(function (it) { return it.photo; });
      return latestId(c.key).then(function (latest) {
        var latestIdV = latest ? latest.id : null;
        if (latestIdV !== baseId) {
          var e = new Error("剛剛有人改過這位客戶" + (latest ? "（" + latest.editor + "，" + shortTime(latest.created_at) + "）" : "") +
            "。請關閉後重新開啟，確認最新內容再修改。");
          e.conflict = true;
          throw e;
        }
        var chain = Promise.resolve();
        photos.forEach(function (it, i) {
          chain = chain.then(function () {
            progress("上傳照片 " + (i + 1) + "／" + photos.length + "…");
            var name = stamp() + "-" + randHex(3);
            it.photo.main.name = name;
            return upload(c.key, it.photo.main, "").then(function (src) {
              it.img.src = src;
              if (!it.photo.full) return;
              it.photo.full.name = name;
              return upload(c.key, it.photo.full, "-full").then(function (fsrc) {
                it.img.full = { src: fsrc, w: it.photo.full.w, h: it.photo.full.h };
              });
            }).then(function () { it.photo = null; }); // 已上傳，重試時不再上傳
          });
        });
        return chain;
      }).then(function () {
        progress("存檔中…");
        function clean(list, withText) {
          return list.map(function (it) {
            var o = { src: it.img.src, w: Math.round(it.img.w), h: Math.round(it.img.h), caption: (it.img.caption || "").trim() };
            var t = (it.img.text || "").trim();
            if (withText && t) o.text = t;
            if (it.img.full) o.full = { src: it.img.full.src, w: it.img.full.w, h: it.img.full.h };
            return o;
          });
        }
        var row = { customer_key: c.key, editor: editor, summary: summary.slice(0, 200), base_id: baseId };
        FIELDS.forEach(function (f) { row[f[1]] = (draft.fields[f[0]] || "").trim(); });
        row.stickers = clean(draft.stickers, true);
        row.positions = clean(draft.positions, true);
        return db.from("sticker_edits").insert(row).select("*").single();
      }).then(function (r) {
        // 資料庫的寫入前檢查：有人比你早一步存檔
        if (r.error && /sticker_conflict/.test(r.error.message || "")) {
          var ce = new Error("剛剛有人改過這位客戶，你的修改沒有存進去。請關閉後重新開啟，確認最新內容再修改（照片已上傳，重新拍即可）。");
          ce.conflict = true;
          throw ce;
        }
        if (r.error) throw r.error;
        return rowToCustomer(r.data, c._orig);
      });
    }

    // 這次改了什麼
    function describe(c, draft) {
      var out = [];
      FIELDS.forEach(function (f) {
        if ((draft.fields[f[0]] || "").trim() !== (c[f[0]] || "")) out.push(f[2]);
      });
      var parts = out.length ? ["改" + out.join("、")] : [];
      [["stickers", "貼紙照片"], ["positions", "貼法位置圖"]].forEach(function (k) {
        var list = draft[k[0]];
        var added = 0, replaced = 0, textEd = 0;
        list.forEach(function (it) {
          if (it.photo && !it.orig) added++;
          else if (it.photo) replaced++;
          else if (it.orig && ((it.img.caption || "") !== (it.orig.caption || "") || (it.img.text || "") !== (it.orig.text || ""))) textEd++;
        });
        var kept = list.filter(function (it) { return it.orig; }).length;
        var removed = (c[k[0]] || []).length - kept;
        if (replaced) parts.push("換" + k[1] + " " + replaced + " 張");
        if (added) parts.push("新增" + k[1] + " " + added + " 張");
        if (removed > 0) parts.push("刪除" + k[1] + " " + removed + " 張");
        if (textEd) parts.push("改" + k[1] + "說明");
      });
      return parts.join("；");
    }

    // ---------- 快速：拍照換貼紙 ----------
    var targetSel = $("crop-target");
    var cropText = $("crop-text");
    var cropEditor = $("crop-editor");

    function quickPhoto(c, camera) {
      if (!opts.canEdit()) return;
      targetSel.replaceChildren();
      function opt(value, text) { var o = el("option", null, text); o.value = value; targetSel.appendChild(o); }
      c.stickers.forEach(function (s, i) {
        opt("s" + i, "換掉 貼紙 " + (i + 1) + (s.text ? "（" + s.text.slice(0, 16) + "）" : s.caption ? "（" + s.caption.slice(0, 16) + "）" : ""));
      });
      if (c.stickers.length < MAX_IMGS) opt("s+", "新增一張貼紙");
      c.positions.forEach(function (s, i) {
        opt("p" + i, "換掉 貼法位置圖 " + (i + 1) + (s.caption ? "（" + s.caption.slice(0, 16) + "）" : ""));
      });
      if (c.positions.length < MAX_IMGS) opt("p+", "新增一張貼法位置圖");
      // 只有一張貼紙時預設換掉它；其他情況預設新增
      targetSel.value = c.stickers.length === 1 ? "s0" : "s+";
      function fillText() {
        var v = targetSel.value;
        var s = v[0] === "s" && v !== "s+" ? c.stickers[+v.slice(1)] : null;
        cropText.value = s && s.text ? s.text : "";
        cropText.closest(".field").hidden = v[0] !== "s";
      }
      targetSel.onchange = fillText;
      fillText();
      cropEditor.value = getName();
      $("crop-title").textContent = "拍照更新：" + (c.name || c.company);

      openCropper({
        camera: camera,
        quick: true,
        onDone: function (res) {
          var editor = cropEditor.value.trim();
          if (!editor) { cropEditor.focus(); throw new Error("請填修改人。"); }
          setName(editor);
          var draft = { fields: {}, stickers: c.stickers.map(itemFrom), positions: c.positions.map(itemFrom) };
          FIELDS.forEach(function (f) { draft.fields[f[0]] = c[f[0]] || ""; });
          var v = targetSel.value;
          var list = v[0] === "s" ? draft.stickers : draft.positions;
          var text = v[0] === "s" ? cropText.value.trim() : "";
          if (v.slice(1) === "+") {
            list.push(newItem(res, text));
          } else {
            var it = list[+v.slice(1)];
            applyPhoto(it, res);
            if (v[0] === "s") { if (text) it.img.text = text; else delete it.img.text; }
          }
          return save(c, draft, editor, describe(c, draft), function (t) { A.show(cropMsg, t, "info"); })
            .then(function (saved) {
              opts.onSaved(saved);
              toast("已存檔：" + (saved.name || saved.company));
            });
        },
      });
    }

    // ---------- 修改視窗 ----------
    var dlg = $("editor");
    var form = $("editor-form");
    var msg = $("e-message");
    var saveBtn = $("e-save");
    var editorInput = $("e-editor");
    var hist = $("e-history");
    var histList = $("e-hist-list");
    var st = null; // { c, isNew, draft, dirty, restored }

    // 欄位
    var inputs = {};
    (function buildFields() {
      var byKey = {};
      FIELDS.forEach(function (f) { byKey[f[0]] = f; });
      // 同一組的欄位並排（窄螢幕自動變一欄）
      var LAYOUT = [["no", "name"], ["company"], ["style"], ["position"], ["die", "qty"], ["dieL", "dieM", "dieS"], ["note"]];
      var box = $("e-fields");
      LAYOUT.forEach(function (group) {
        var parent = group.length > 1 ? box.appendChild(el("div", "field-row")) : box;
        group.forEach(function (k) {
          var f = byKey[k];
          var wrap = el("div", "field");
          var lab = el("label", null, dieHeaders[k] || f[2]);
          lab.htmlFor = "e-" + k;
          var inp = el(k === "note" ? "textarea" : "input");
          inp.id = "e-" + k;
          if (k === "note") inp.rows = 3; else inp.type = "text";
          inp.maxLength = f[3];
          wrap.appendChild(lab);
          wrap.appendChild(inp);
          if (f[4]) wrap.appendChild(el("p", "hint left", f[4]));
          parent.appendChild(wrap);
          inputs[k] = inp;
        });
      });
    })();
    form.addEventListener("input", function () { if (st) st.dirty = true; });

    function renderItems(kind) {
      var listEl = $(kind === "stickers" ? "e-stickers" : "e-positions");
      var list = st.draft[kind];
      listEl.replaceChildren();
      if (!list.length) listEl.appendChild(el("p", "hint left", kind === "stickers" ? "還沒有貼紙圖片。" : "沒有貼法位置圖。"));
      list.forEach(function (it, i) {
        var row = el("div", "s-eitem" + (it.photo ? " is-new" : ""));
        var th = el("div", "s-ethumb");
        var im = el("img");
        im.src = itemSrc(it);
        im.alt = (kind === "stickers" ? "貼紙 " : "貼法位置圖 ") + (i + 1);
        th.appendChild(im);
        if (it.photo) th.appendChild(el("span", "s-badge", it.orig ? "換新照片" : "新照片"));
        row.appendChild(th);

        var body = el("div", "s-ebody");
        body.appendChild(el("b", null, (kind === "stickers" ? "貼紙 " : "貼法位置圖 ") + (i + 1)));
        function textField(label, prop, max) {
          var id = "e-" + kind + "-" + i + "-" + prop;
          var l = el("label", null, label);
          l.htmlFor = id;
          var inp = el("input");
          inp.type = "text";
          inp.id = id;
          inp.maxLength = max;
          inp.value = it.img[prop] || "";
          inp.addEventListener("input", function () { it.img[prop] = inp.value; });
          body.appendChild(l);
          body.appendChild(inp);
        }
        if (kind === "stickers") textField("貼紙上的字（搜尋用）", "text", 200);
        textField("說明", "caption", 100);
        var acts = el("div", "s-eacts");
        var swap = el("button", "secondary", "拍照換掉");
        swap.type = "button";
        swap.addEventListener("click", function () {
          openCropper({ camera: true, onDone: function (res) { applyPhoto(it, res); st.dirty = true; renderItems(kind); } });
        });
        var pick = el("button", "secondary", "選照片換掉");
        pick.type = "button";
        pick.addEventListener("click", function () {
          openCropper({ camera: false, onDone: function (res) { applyPhoto(it, res); st.dirty = true; renderItems(kind); } });
        });
        var del = el("button", "secondary danger", "刪除");
        del.type = "button";
        del.addEventListener("click", function () {
          if (!confirm("確定要刪除" + (kind === "stickers" ? "貼紙 " : "貼法位置圖 ") + (i + 1) + "？（存檔後才生效，可以從修改紀錄還原）")) return;
          if (it.preview) URL.revokeObjectURL(it.preview);
          list.splice(i, 1);
          st.dirty = true;
          renderItems(kind);
        });
        acts.appendChild(swap);
        acts.appendChild(pick);
        acts.appendChild(del);
        body.appendChild(acts);
        row.appendChild(body);
        listEl.appendChild(row);
      });
      document.querySelectorAll('[data-add="' + kind + '"]').forEach(function (b) { b.disabled = list.length >= MAX_IMGS; });
    }

    document.querySelectorAll("[data-add]").forEach(function (b) {
      b.addEventListener("click", function () {
        var kind = b.getAttribute("data-add");
        openCropper({
          camera: b.hasAttribute("data-camera"),
          onDone: function (res) { st.draft[kind].push(newItem(res, "")); st.dirty = true; renderItems(kind); },
        });
      });
    });

    function fillForm(src, stickers, positions) {
      FIELDS.forEach(function (f) { inputs[f[0]].value = src[f[0]] || ""; });
      st.draft.stickers = stickers.map(itemFrom);
      st.draft.positions = positions.map(itemFrom);
      renderItems("stickers");
      renderItems("positions");
    }

    function releasePreviews() {
      if (!st) return;
      st.draft.stickers.concat(st.draft.positions).forEach(function (it) { if (it.preview) URL.revokeObjectURL(it.preview); });
    }

    function open(c, isNew) {
      if (!opts.canEdit()) return;
      releasePreviews();
      st = { c: c, isNew: isNew, draft: { stickers: [], positions: [] }, dirty: false, restored: "" };
      $("editor-title").textContent = isNew ? "新增客戶" : "修改：" + (c.name || c.company);
      fillForm(c, c.stickers, c.positions);
      editorInput.value = getName();
      msg.hidden = true;
      saveBtn.disabled = false;
      hist.hidden = isNew;
      hist.open = false;
      histList.replaceChildren();
      dlg.showModal();
      dlg.scrollTop = 0;
      if (isNew) inputs.name.focus();
    }

    function tryClose() {
      if (st && st.dirty && !confirm("還沒存檔，確定要關閉嗎？")) return;
      dlg.close();
    }
    dlg.querySelectorAll("[data-close]").forEach(function (b) { b.addEventListener("click", tryClose); });
    dlg.addEventListener("cancel", function (e) { e.preventDefault(); tryClose(); }); // 按 Esc
    dlg.addEventListener("close", function () { releasePreviews(); st = null; });

    // 修改紀錄：打開時才讀取
    hist.addEventListener("toggle", function () {
      if (!hist.open || !st || histList.childNodes.length) return;
      var c = st.c;
      histList.appendChild(el("p", "hint left", "讀取中…"));
      db.from("sticker_edits").select("*").eq("customer_key", c.key)
        .order("id", { ascending: false }).limit(30)
        .then(function (r) {
          histList.replaceChildren();
          if (r.error) { histList.appendChild(el("p", "message error", errorText(r.error))); return; }
          var ul = el("ul", "s-hist");
          r.data.forEach(function (row, i) {
            var li = el("li");
            var t = el("div");
            t.appendChild(el("b", null, A.fmtTime(row.created_at) + "　" + row.editor));
            t.appendChild(el("span", null, row.summary || "修改內容"));
            li.appendChild(t);
            if (i === 0) {
              li.appendChild(el("span", "s-tag", "目前版本"));
            } else {
              var b = el("button", "secondary", "還原這一版");
              b.type = "button";
              b.addEventListener("click", function () {
                var v = rowToCustomer(row, null);
                fillForm(v, v.stickers, v.positions);
                st.dirty = true;
                st.restored = "還原成 " + shortTime(row.created_at) + "（" + row.editor + "）的版本";
                A.show(msg, "已帶入 " + A.fmtTime(row.created_at) + " 的內容，按「存檔」才會生效。", "ok");
                dlg.scrollTop = 0;
              });
              li.appendChild(b);
            }
            ul.appendChild(li);
          });
          if (c._orig) {
            var li = el("li");
            var t = el("div");
            t.appendChild(el("b", null, "原始資料"));
            t.appendChild(el("span", null, "網站內建的資料（" + (opts.sourceTitle || "stickers-data.js") + "）"));
            li.appendChild(t);
            if (r.data.length) {
              var b = el("button", "secondary", "還原原始資料");
              b.type = "button";
              b.addEventListener("click", function () {
                fillForm(c._orig, c._orig.stickers, c._orig.positions);
                st.dirty = true;
                st.restored = "還原成原始資料";
                A.show(msg, "已帶入原始資料，按「存檔」才會生效。", "ok");
                dlg.scrollTop = 0;
              });
              li.appendChild(b);
            } else {
              li.appendChild(el("span", "s-tag", "目前版本"));
            }
            ul.appendChild(li);
          }
          if (!ul.childNodes.length) ul.appendChild(el("li", null, "還沒有修改紀錄。"));
          histList.appendChild(ul);
        });
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!st) return;
      var c = st.c;
      var draft = { fields: {}, stickers: st.draft.stickers, positions: st.draft.positions };
      FIELDS.forEach(function (f) { draft.fields[f[0]] = inputs[f[0]].value; });
      if (!draft.fields.name.trim() && !draft.fields.company.trim()) {
        A.show(msg, "客戶名稱和貼紙公司名至少要填一個。", "error");
        inputs.name.focus();
        return;
      }
      var editor = editorInput.value.trim();
      if (!editor) {
        A.show(msg, "請填修改人。", "error");
        editorInput.focus();
        return;
      }
      var summary = st.isNew ? "新增客戶" : st.restored || describe(c, draft);
      if (!summary) { A.show(msg, "沒有修改，不用存檔。", "info"); return; }
      setName(editor);
      saveBtn.disabled = true;
      save(c, draft, editor, summary, function (t) { A.show(msg, t, "info"); })
        .then(function (saved) {
          st.dirty = false;
          dlg.close();
          opts.onSaved(saved);
          toast("已存檔：" + (saved.name || saved.company));
        })
        .catch(function (err) {
          A.show(msg, errorText(err), "error");
          if (err && err.conflict) opts.onConflict();
        })
        .then(function () { saveBtn.disabled = false; });
    });

    return {
      edit: function (c) { open(c, false); },
      photo: quickPhoto,
      add: function () {
        var c = { key: "new-" + randHex(4), stickers: [], positions: [], _orig: null, _edit: null };
        FIELDS.forEach(function (f) { c[f[0]] = ""; });
        open(c, true);
      },
      rowToCustomer: rowToCustomer,
    };
  };
})();
