// Supabase 連線設定
// publishable key 本來就是公開的，可以放在網頁裡；
// 千萬不要把 secret 金鑰（sb_secret_…）或 service_role 金鑰放在這裡。
// 若更換 Supabase 專案網址，也要一起修改 index.html 裡 Content-Security-Policy 的 connect-src。
window.APP_CONFIG = {
  SUPABASE_URL: "https://frndcsvhzolwtuqvofmg.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_zk0IdwWxGIl-yDfwxf57Iw_XqL5ydzy",
};
