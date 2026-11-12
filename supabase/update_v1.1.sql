-- =====================================================================
-- 報修登記系統 v1.1：管理人員更新報修處理狀態
--
-- 前提：已執行 supabase/schema.sql。
-- 這個檔案只是設計稿，請在 Supabase 的 SQL Editor 手動檢查後再執行。
-- 可以重複執行。
--
-- 新增內容：
--   - public.repair_admins：可以更新報修狀態的管理人員名單
--   - repair_requests 新增「狀態更新時間」「狀態更新人」兩個欄位，由觸發器自動填入
--   - 已登入的管理人員可以把狀態改成 待處理／處理中／已完成
--
-- 一般訪客（anon）的權限完全不變：仍然只能讀取與新增，不能修改或刪除。
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0-1. 管理人員名單
--      只放 Supabase Auth 使用者的 id，由管理員在後台維護，
--      網頁上的任何人都不能讀或改這張表。
-- ---------------------------------------------------------------------
create table if not exists public.repair_admins (
  user_id    uuid        primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.repair_admins is '可以更新報修處理狀態的管理人員（Supabase Auth 使用者 id）';


-- ---------------------------------------------------------------------
-- 0-2. 報修單新增欄位：狀態更新時間、狀態更新人
-- ---------------------------------------------------------------------
alter table public.repair_requests
  add column if not exists status_updated_at timestamptz,
  add column if not exists status_updated_by uuid references auth.users (id) on delete set null;

comment on column public.repair_requests.status_updated_at is '處理狀態最後更新時間（自動填入）';
comment on column public.repair_requests.status_updated_by is '處理狀態最後更新人（自動填入）';


-- ---------------------------------------------------------------------
-- 0-3. 輔助函式：目前登入的人是不是報修管理人員
-- ---------------------------------------------------------------------
create or replace function public.is_repair_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.repair_admins a where a.user_id = auth.uid()
  );
$$;

revoke all on function public.is_repair_admin() from public, anon, authenticated;
grant execute on function public.is_repair_admin() to authenticated;


-- ---------------------------------------------------------------------
-- 0-4. 觸發器：狀態改變時自動記錄更新時間與更新人
-- ---------------------------------------------------------------------
create or replace function public.repair_requests_stamp_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    new.status_updated_at := now();
    new.status_updated_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists repair_requests_stamp_status on public.repair_requests;
create trigger repair_requests_stamp_status
  before update on public.repair_requests
  for each row execute function public.repair_requests_stamp_status();


-- ---------------------------------------------------------------------
-- 1. GRANT
--    - 名單表：不給任何網頁角色權限。
--    - authenticated（已登入）：可以讀取報修單；只能修改「處理狀態」這一欄。
--      是不是管理人員，由第 2 層 RLS 判斷。
--    - anon 的權限不變（schema.sql 已設定：讀取＋新增五個欄位）。
-- ---------------------------------------------------------------------
revoke all on table public.repair_admins from public, anon, authenticated;

grant usage on schema public to authenticated;
grant select on table public.repair_requests to authenticated;
grant update (status) on table public.repair_requests to authenticated;


-- ---------------------------------------------------------------------
-- 2. RLS
--    - 讀取：已登入的人也可以讀清單（修改時需要先讀到那一筆）。
--    - 修改：只有管理人員可以改；改完的狀態仍必須是三個選項之一（CHECK 會擋）。
--    - 刪除：仍然沒有政策，一律拒絕。
-- ---------------------------------------------------------------------
alter table public.repair_admins enable row level security;

drop policy if exists "已登入者可讀取報修清單" on public.repair_requests;
create policy "已登入者可讀取報修清單"
  on public.repair_requests
  for select
  to authenticated
  using (true);

drop policy if exists "管理人員可更新處理狀態" on public.repair_requests;
create policy "管理人員可更新處理狀態"
  on public.repair_requests
  for update
  to authenticated
  using ((select public.is_repair_admin()))
  with check ((select public.is_repair_admin()));


-- ---------------------------------------------------------------------
-- 3. 新增管理人員（範例，請把 email 改成實際的再執行）
--    先在 Supabase 後台 Authentication → Users 建立帳號，再執行：
--
--    insert into public.repair_admins (user_id)
--    select id from auth.users where email = '管理人員的email'
--    on conflict do nothing;
--
--    同一個人也要回覆交期的話，再加進交期回覆名單：
--
--    insert into public.delivery_responders (user_id)
--    select id from auth.users where email = '管理人員的email'
--    on conflict do nothing;
-- ---------------------------------------------------------------------
