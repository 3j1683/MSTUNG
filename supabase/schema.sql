-- =====================================================================
-- 報修登記系統：Supabase 建表 SQL
-- 資料表：public.repair_requests
--
-- 這個檔案只是設計稿，請在 Supabase 的 SQL Editor 手動檢查後再執行。
-- 可以重複執行：已存在的資料表不會被覆蓋，權限與政策會重新設定。
--
-- 安全設計分三層：
--   1. GRANT：決定 anon 角色「能不能碰」這張表、哪些欄位。
--   2. RLS  ：決定 anon 角色「能碰哪些列」、新增時要符合什麼條件。
--   3. CHECK：不管是誰寫入，資料本身都必須合法（值域、長度）。
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. 建立資料表與 CHECK 限制（第 3 層）
--    - id、created_at 由資料庫自動產生，前端不需也不能提供。
--    - 類別、緊急程度、處理狀態只允許筆記中列出的選項。
--    - 文字欄位去掉前後空白後不能是空字串，並限制最大長度，
--      避免空白資料或超長內容灌爆資料表。
-- ---------------------------------------------------------------------
create table if not exists public.repair_requests (
  id            uuid        primary key default gen_random_uuid(),
  created_at    timestamptz not null    default now(),

  reporter_name text        not null,
  location      text        not null,
  category      text        not null,
  description   text        not null,
  urgency       text        not null    default '中',
  status        text        not null    default '待處理',

  -- 報修人姓名：1～50 字
  constraint repair_requests_reporter_name_len
    check (char_length(btrim(reporter_name)) between 1 and 50),

  -- 地點或部門：1～100 字
  constraint repair_requests_location_len
    check (char_length(btrim(location)) between 1 and 100),

  -- 問題說明：1～1000 字
  constraint repair_requests_description_len
    check (char_length(btrim(description)) between 1 and 1000),

  -- 類別：只能是 設備／網路／環境／其他
  constraint repair_requests_category_allowed
    check (category in ('設備', '網路', '環境', '其他')),

  -- 緊急程度：只能是 低／中／高（預設 中）
  constraint repair_requests_urgency_allowed
    check (urgency in ('低', '中', '高')),

  -- 處理狀態：只能是 待處理／處理中／已完成（預設 待處理）
  constraint repair_requests_status_allowed
    check (status in ('待處理', '處理中', '已完成'))
);

comment on table  public.repair_requests               is '報修登記（示範用，不放真實姓名與地點）';
comment on column public.repair_requests.reporter_name is '報修人姓名';
comment on column public.repair_requests.location      is '地點或部門';
comment on column public.repair_requests.category      is '類別：設備／網路／環境／其他';
comment on column public.repair_requests.description   is '問題說明';
comment on column public.repair_requests.urgency       is '緊急程度：低／中／高';
comment on column public.repair_requests.status        is '處理狀態：待處理／處理中／已完成';

-- 清單依建立時間由新到舊排序，加索引讓查詢快一點
create index if not exists repair_requests_created_at_idx
  on public.repair_requests (created_at desc);


-- ---------------------------------------------------------------------
-- 1. GRANT：表格與欄位權限（第 1 層）
--    這個專案不會自動開放新資料表，所以要明確授權。
--    - 先收回所有角色的權限，從零開始。
--    - anon 只能：讀取全部欄位、新增「使用者要填的欄位」。
--    - id、created_at、status 不開放新增，一律用預設值。
--    - 不給 UPDATE、DELETE、TRUNCATE，也不授權給 authenticated。
-- ---------------------------------------------------------------------
revoke all on table public.repair_requests from public, anon, authenticated;

-- anon 需要能使用 public schema 才看得到表（通常已有，重複授權無害）
grant usage on schema public to anon;

-- 讀取清單
grant select on table public.repair_requests to anon;

-- 新增：只開放這五個欄位
grant insert (reporter_name, location, category, description, urgency)
  on table public.repair_requests to anon;


-- ---------------------------------------------------------------------
-- 2. RLS：資料列安全（第 2 層）
--    啟用後，沒有政策允許的動作一律拒絕。
--    - 讀取：任何人（anon）可以讀全部清單。
--    - 新增：任何人可以新增，但 status 必須是「待處理」。
--      （GRANT 已不讓 anon 指定 status，這裡是第二道保險。）
--    - 沒有寫 UPDATE、DELETE 政策，所以即使權限被誤開也改不了、刪不掉。
-- ---------------------------------------------------------------------
alter table public.repair_requests enable row level security;

drop policy if exists "任何人可讀取報修清單" on public.repair_requests;
create policy "任何人可讀取報修清單"
  on public.repair_requests
  for select
  to anon
  using (true);

drop policy if exists "任何人可新增待處理的報修" on public.repair_requests;
create policy "任何人可新增待處理的報修"
  on public.repair_requests
  for insert
  to anon
  with check (status = '待處理');
