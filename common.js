// 共用：Supabase 連線、訊息顯示、時間格式、錯誤訊息、管理人員登入
window.APP = (function () {
  "use strict";

  var VERSION = "1.7.0";
  var cfg = window.APP_CONFIG || {};
  var ready = !!(window.supabase && cfg.SUPABASE_URL && cfg.SUPABASE_PUBLISHABLE_KEY);

  // 兩個連線：
  //   publicDb：一律以訪客身分讀取與新增，不受登入狀態影響
  //   authDb  ：管理人員登入後用來更新資料，登入狀態存在瀏覽器，各頁共用
  var publicDb = null;
  var authDb = null;

  // 重設密碼：使用者點信裡的連結回到網站時，網址 # 後面會帶 type=recovery，
  // 連結失效時則帶 error_description。要在 Supabase 讀取網址之前先記下來。
  var hashParams = new URLSearchParams(location.hash.replace(/^#/, ""));
  var recoveryMode = hashParams.get("type") === "recovery";
  var linkError = hashParams.get("error_description") || hashParams.get("error") || "";
  var onRecovery = null;

  if (ready) {
    publicDb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY, {
      // 訪客連線不讀網址裡的登入資訊，確保一律以訪客身分讀取與新增
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "mstung-public" },
    });
    authDb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit", storageKey: "mstung-auth" },
    });
    authDb.auth.onAuthStateChange(function (event) {
      // 這裡不能直接呼叫其他 Supabase 函式，交給下一輪事件處理
      if (event === "PASSWORD_RECOVERY") {
        recoveryMode = true;
        if (onRecovery) setTimeout(onRecovery, 0);
      }
    });
  }

  function clearUrlHash() {
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  }

  function $(id) { return document.getElementById(id); }

  function show(node, text, kind) {
    node.textContent = text;
    node.className = "message " + kind;
    node.hidden = false;
  }

  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text; // 一律純文字，避免輸入內容被當成 HTML
    return n;
  }

  var timeFmt = new Intl.DateTimeFormat("zh-TW", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  function fmtTime(iso) { return iso ? timeFmt.format(new Date(iso)) : ""; }

  function friendlyError(err) {
    var msg = (err && err.message) || "";
    if (/Invalid login credentials/i.test(msg)) return "Email 或密碼錯誤。";
    if (/Email not confirmed/i.test(msg)) return "這個帳號的 Email 尚未驗證。";
    if (/rate limit|too many/i.test(msg)) return "寄信或嘗試次數太多，請過一段時間再試。";
    if (/should be different/i.test(msg)) return "新密碼不能和舊密碼相同。";
    if (/Password should be|weak password/i.test(msg)) return "密碼太簡單或太短，請至少 8 個字元並混合英文與數字。";
    if (/session missing|expired|invalid.*(token|link)/i.test(msg)) return "重設連結已失效，請重新按「忘記密碼？」申請。";
    if (/check constraint/i.test(msg)) return "資料格式不符合規定，請檢查各欄位內容。";
    if (/permission denied|row-level security|not allowed/i.test(msg)) return "沒有權限執行這個動作。";
    if (/Failed to fetch|NetworkError|network/i.test(msg)) return "網路連線失敗，請確認網路後再試一次。";
    return "操作失敗，請稍後再試。" + (msg ? "（" + msg + "）" : "");
  }

  // 去掉 PostgREST 模糊搜尋的萬用字元，避免使用者輸入 % 或 _ 時搜出全部
  function likePattern(s) {
    return "%" + s.replace(/[\\%_]/g, function (c) { return "\\" + c; }) + "%";
  }

  // 管理人員登入區塊（頁面需有 login-form、email、password、login-btn、
  // logged-in、who、logout-btn、login-message）
  // 「忘記密碼？」按鈕與「設定新密碼」表單由這裡自動加上
  //   roleRpc ：判斷權限的資料庫函式名稱
  //   roleName：顯示用的角色名稱
  //   onChange(hasRole)：登入狀態改變時呼叫
  function setupAuth(roleRpc, roleName, onChange) {
    var loginForm = $("login-form");
    var loginBtn = $("login-btn");
    var loggedIn = $("logged-in");
    var who = $("who");
    var logoutBtn = $("logout-btn");
    var loginMsg = $("login-message");

    if (!ready) { loginBtn.disabled = true; onChange(false); return; }

    // ---- 忘記密碼：寄重設信 ----
    var forgotBtn = el("button", "link-btn", "忘記密碼？");
    forgotBtn.type = "button";
    loginBtn.insertAdjacentElement("afterend", forgotBtn);

    // ---- 設定新密碼表單（點重設信連結回來時顯示）----
    var resetForm = el("form");
    resetForm.id = "reset-form";
    resetForm.noValidate = true;
    resetForm.hidden = true;
    resetForm.appendChild(el("p", "hint left", "請設定新的密碼（至少 8 個字元）。"));
    function pwField(id, text) {
      var f = el("div", "field");
      var l = el("label", null, text);
      l.htmlFor = id;
      var i = el("input");
      i.id = id;
      i.type = "password";
      i.autocomplete = "new-password";
      i.minLength = 8;
      i.required = true;
      f.appendChild(l);
      f.appendChild(i);
      resetForm.appendChild(f);
      return i;
    }
    var newPw = pwField("new-password", "新密碼");
    var newPw2 = pwField("new-password-2", "再輸入一次新密碼");
    var resetBtn = el("button", null, "設定新密碼");
    resetBtn.type = "submit";
    resetForm.appendChild(resetBtn);
    loginForm.insertAdjacentElement("afterend", resetForm);

    if (linkError) {
      show(loginMsg, "重設連結已失效或已使用過，請重新按「忘記密碼？」申請。", "error");
      clearUrlHash();
    }

    forgotBtn.addEventListener("click", async function () {
      var email = $("email").value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        show(loginMsg, "請先在上方輸入你的 Email，再按「忘記密碼？」。", "error");
        $("email").focus();
        return;
      }
      forgotBtn.disabled = true;
      loginMsg.hidden = true;
      try {
        var res = await authDb.auth.resetPasswordForEmail(email, {
          redirectTo: location.origin + location.pathname,
        });
        if (res.error) throw res.error;
        // 不透露這個 Email 是否有帳號
        show(loginMsg, "如果這個 Email 有帳號，幾分鐘內會收到重設密碼的信。請點信裡的連結回到這個網站設定新密碼。", "ok");
      } catch (err) {
        show(loginMsg, friendlyError(err), "error");
      } finally {
        forgotBtn.disabled = false;
      }
    });

    resetForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      if (newPw.value.length < 8) { show(loginMsg, "新密碼至少要 8 個字元。", "error"); return; }
      if (newPw.value !== newPw2.value) { show(loginMsg, "兩次輸入的新密碼不一樣。", "error"); return; }
      resetBtn.disabled = true;
      loginMsg.hidden = true;
      try {
        var res = await authDb.auth.updateUser({ password: newPw.value });
        if (res.error) throw res.error;
        recoveryMode = false;
        resetForm.reset();
        clearUrlHash();
        show(loginMsg, "密碼已更新，並已自動登入。下次請用新密碼登入。", "ok");
        await refresh();
      } catch (err) {
        show(loginMsg, friendlyError(err), "error");
      } finally {
        resetBtn.disabled = false;
      }
    });

    async function refresh() {
      var s = await authDb.auth.getSession();
      var session = s.data && s.data.session;
      var hasRole = false;
      var note = "";
      if (recoveryMode && session) {
        // 從重設信回來：先設定新密碼
        loginForm.hidden = true;
        loggedIn.hidden = true;
        resetForm.hidden = false;
        who.textContent = "";
        onChange(false);
        newPw.focus();
        return;
      }
      resetForm.hidden = true;
      if (session) {
        var rpc = await authDb.rpc(roleRpc);
        if (rpc.error) {
          // 資料庫還沒有這個函式（尚未執行更新 SQL）
          note = rpc.error.code === "PGRST202" ? "（管理功能尚未啟用）" : "（無法確認權限）";
        } else {
          hasRole = rpc.data === true;
          note = hasRole ? "（" + roleName + "）" : "（不是" + roleName + "，只能查看）";
        }
        who.textContent = "已登入：" + (session.user.email || "") + note;
        loginForm.hidden = true;
        loggedIn.hidden = false;
      } else {
        loginForm.hidden = false;
        loggedIn.hidden = true;
      }
      onChange(hasRole);
    }

    loginForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      var email = $("email").value.trim();
      var password = $("password").value;
      if (!email || !password) { show(loginMsg, "請輸入 Email 和密碼。", "error"); return; }
      loginBtn.disabled = true;
      loginMsg.hidden = true;
      try {
        var res = await authDb.auth.signInWithPassword({ email: email, password: password });
        if (res.error) throw res.error;
        loginForm.reset();
        await refresh();
      } catch (err) {
        show(loginMsg, friendlyError(err), "error");
      } finally {
        loginBtn.disabled = false;
      }
    });

    logoutBtn.addEventListener("click", async function () {
      await authDb.auth.signOut();
      loginMsg.hidden = true;
      await refresh();
    });

    onRecovery = refresh;
    refresh();
  }

  // 頁尾顯示版本
  document.addEventListener("DOMContentLoaded", function () {
    var v = $("app-version");
    if (v) v.textContent = "v" + VERSION;
  });

  return {
    VERSION: VERSION,
    ready: ready,
    publicDb: publicDb,
    authDb: authDb,
    $: $,
    show: show,
    el: el,
    fmtTime: fmtTime,
    friendlyError: friendlyError,
    likePattern: likePattern,
    setupAuth: setupAuth,
  };
})();
