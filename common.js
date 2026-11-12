// 共用：Supabase 連線、訊息顯示、時間格式、錯誤訊息、管理人員登入
window.APP = (function () {
  "use strict";

  var VERSION = "1.1.0";
  var cfg = window.APP_CONFIG || {};
  var ready = !!(window.supabase && cfg.SUPABASE_URL && cfg.SUPABASE_PUBLISHABLE_KEY);

  // 兩個連線：
  //   publicDb：一律以訪客身分讀取與新增，不受登入狀態影響
  //   authDb  ：管理人員登入後用來更新資料，登入狀態存在瀏覽器，各頁共用
  var publicDb = null;
  var authDb = null;
  if (ready) {
    publicDb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: "mstung-public" },
    });
    authDb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: "mstung-auth" },
    });
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

    async function refresh() {
      var s = await authDb.auth.getSession();
      var session = s.data && s.data.session;
      var hasRole = false;
      var note = "";
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
