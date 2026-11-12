-- =====================================================================
-- 交期詢問：Supabase 建表 SQL
-- 資料表：public.delivery_inquiries（交期詢問）
--         public.delivery_responders（可以回覆交期的指定人員）
--
-- 流程：業務在網頁新增詢問 → 指定人員登入後回覆「幾個工作天」。
-- 這個檔案只是設計稿，請在 Supabase 的 SQL Editor 手動檢查後再執行。
-- 可以重複執行：已存在的資料表不會被覆蓋，權限、函式、政策會重新設定。
--
-- 角色說明（Supabase 內建）：
--   anon          ：沒登入的訪客（網頁用 publishable key 時的身分）
--   authenticated ：已登入的使用者
-- 只有列在 delivery_responders 裡的已登入使用者，才能回覆工作天數。
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0-1. 指定回覆人員名單
--      只放 Supabase Auth 使用者的 id。名單由管理員在後台維護，
--      網頁上的任何人（anon、authenticated）都不能讀或改這張表。
-- ---------------------------------------------------------------------
create table if not exists public.delivery_responders (
  user_id    uuid        primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.delivery_responders is '可以回覆交期的指定人員（Supabase Auth 使用者 id）';


-- ---------------------------------------------------------------------
-- 0-2. 交期詢問資料表與 CHECK 限制
--      - 業務填：業務姓名、客戶或案件名稱、品項、數量、希望交期（可空白）。
--      - 回覆欄位（工作天數、回覆人、回覆時間）新增時一律是空的。
--      - 回覆人、回覆時間由下方觸發器自動填入，不能手動指定。
-- ---------------------------------------------------------------------
create table if not exists public.delivery_inquiries (
  id                 uuid        primary key default gen_random_uuid(),
  created_at         timestamptz not null    default now(),

  sales_name         text        not null,
  customer           text        not null,
  item               text        not null,
  quantity           integer     not null,
  desired_date       date,

  reply_working_days integer,
  replied_by         uuid        references auth.users (id) on delete set null,
  replied_at         timestamptz,

  -- 業務姓名：1～50 字
  constraint delivery_inquiries_sales_name_len
    check (char_length(btrim(sales_name)) between 1 and 50),

  -- 客戶或案件名稱：1～100 字
  constraint delivery_inquiries_customer_len
    check (char_length(btrim(customer)) between 1 and 100),

  -- 品項（含規格）：1～200 字
  constraint delivery_inquiries_item_len
    check (char_length(btrim(item)) between 1 and 200),

  -- 數量：1～10,000,000
  constraint delivery_inquiries_quantity_range
    check (quantity between 1 and 10000000),

  -- 回覆的工作天數：0～365
  constraint delivery_inquiries_reply_days_range
    check (reply_working_days is null or reply_working_days between 0 and 365),

  -- 有工作天數就一定有回覆時間，反之亦然
  constraint delivery_inquiries_reply_complete
    check ((reply_working_days is null) = (replied_at is null))
);

comment on table  public.delivery_inquiries                    is '交期詢問：業務詢問，指定人員回覆工作天數';
comment on column public.delivery_inquiries.sales_name         is '業務姓名';
comment on column public.delivery_inquiries.customer           is '客戶或案件名稱';
comment on column public.delivery_inquiries.item               is '品項（含規格）';
comment on column public.delivery_inquiries.quantity           is '數量';
comment on column public.delivery_inquiries.desired_date       is '希望交期（可空白）';
comment on column public.delivery_inquiries.reply_working_days is '回覆：幾個工作天';
comment on column public.delivery_inquiries.replied_by         is '回覆人（自動填入）';
comment on column public.delivery_inquiries.replied_at         is '回覆時間（自動填入）';

create index if not exists delivery_inquiries_created_at_idx
  on public.delivery_inquiries (created_at desc);


-- ---------------------------------------------------------------------
-- 0-3. 輔助函式：目前登入的人是不是指定回覆人員
--      用 security definer 讓 RLS 政策能查名單，
--      但名單本身仍不開放給網頁讀取。
-- ---------------------------------------------------------------------
create or replace function public.is_delivery_responder()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.delivery_responders r where r.user_id = auth.uid()
  );
$$;

revoke all on function public.is_delivery_responder() from public, anon, authenticated;
grant execute on function public.is_delivery_responder() to authenticated;


-- ---------------------------------------------------------------------
-- 0-4. 觸發器：回覆時自動記錄回覆人與回覆時間
--      清空工作天數時，回覆人與時間也一起清空。
-- ---------------------------------------------------------------------
create or replace function public.delivery_inquiries_stamp_reply()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.reply_working_days is distinct from old.reply_working_days then
    if new.reply_working_days is null then
      new.replied_by := null;
      new.replied_at := null;
    else
      new.replied_by := auth.uid();
      new.replied_at := now();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists delivery_inquiries_stamp_reply on public.delivery_inquiries;
create trigger delivery_inquiries_stamp_reply
  before update on public.delivery_inquiries
  for each row execute function public.delivery_inquiries_stamp_reply();


-- ---------------------------------------------------------------------
-- 1. GRANT：表格與欄位權限
--    這個專案不會自動開放新資料表，所以要明確授權。
--    - 名單表：不給任何網頁角色權限。
--    - anon（業務，沒登入）：讀取、新增業務要填的五個欄位。
--    - authenticated（已登入）：讀取；只能修改「工作天數」這一欄。
--      是不是指定人員，由第 2 層 RLS 判斷。
--    - 任何角色都不能刪除。
-- ---------------------------------------------------------------------
revoke all on table public.delivery_responders from public, anon, authenticated;
revoke all on table public.delivery_inquiries  from public, anon, authenticated;

grant usage on schema public to anon, authenticated;

grant select on table public.delivery_inquiries to anon, authenticated;

grant insert (sales_name, customer, item, quantity, desired_date)
  on table public.delivery_inquiries to anon;

grant update (reply_working_days)
  on table public.delivery_inquiries to authenticated;


-- ---------------------------------------------------------------------
-- 2. RLS：資料列安全
--    - 讀取：任何人（anon、authenticated）可以讀全部詢問與回覆。
--    - 新增：anon 可以新增，但回覆欄位必須是空的。
--    - 修改：只有指定回覆人員可以改（填或改工作天數）。
--    - 刪除：沒有政策，一律拒絕。
-- ---------------------------------------------------------------------
alter table public.delivery_responders enable row level security;
alter table public.delivery_inquiries  enable row level security;

drop policy if exists "任何人可讀取交期詢問" on public.delivery_inquiries;
create policy "任何人可讀取交期詢問"
  on public.delivery_inquiries
  for select
  to anon, authenticated
  using (true);

drop policy if exists "任何人可新增未回覆的交期詢問" on public.delivery_inquiries;
create policy "任何人可新增未回覆的交期詢問"
  on public.delivery_inquiries
  for insert
  to anon
  with check (
    reply_working_days is null
    and replied_by is null
    and replied_at is null
  );

drop policy if exists "指定人員可回覆交期" on public.delivery_inquiries;
create policy "指定人員可回覆交期"
  on public.delivery_inquiries
  for update
  to authenticated
  using ((select public.is_delivery_responder()))
  with check ((select public.is_delivery_responder()));


-- ---------------------------------------------------------------------
-- 3. 新增指定回覆人員（範例，請手動改成實際的 email 再執行）
--    先在 Supabase 後台 Authentication → Users 建立帳號，再執行：
--
--    insert into public.delivery_responders (user_id)
--    select id from auth.users where email = '回覆人員的email'
--    on conflict do nothing;
-- ---------------------------------------------------------------------
