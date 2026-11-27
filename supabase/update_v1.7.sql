-- =====================================================================
-- 報修登記系統 v1.7：客戶貼紙現場拍照更新、修改內容
--
-- 前提：無（和報修、交期資料表互不影響）。
-- 這個檔案只是設計稿，請在 Supabase 的 SQL Editor 手動檢查後再執行。
-- 可以重複執行：已存在的資料表不會被覆蓋，權限、函式、政策會重新設定。
--
-- 新增內容：
--   - public.sticker_edits  ：客戶貼紙的修改紀錄。每按一次「存檔」新增一筆
--                             「這位客戶改完後的完整內容」，舊紀錄不能改也不能刪，
--                             所以改錯了可以從紀錄還原。
--   - public.sticker_current：每位客戶最新的一筆（網頁讀這個，蓋過 stickers-data.js）。
--   - Storage 儲存空間 sticker-photos：現場拍的貼紙照片（公開讀取）。
--
-- 權限（2026-11-27 已確認：任何人都能改，不用登入）：
--   - 任何人（anon、authenticated）可以讀取、新增修改紀錄，可以上傳照片。
--   - 任何人都不能修改或刪除已存的紀錄與照片（沒有 UPDATE、DELETE 權限與政策）。
--   - 內容格式由第 3 層 CHECK 把關：欄位長度、圖片數量、圖片只能是
--     網站裡的 stickers/ 或 sticker-photos 裡的照片。
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0-1. 輔助函式：檢查一張圖片的資料
--      圖片格式和 stickers-data.js 一樣：
--        { "src": "...", "w": 寬, "h": 高, "caption": "說明", "text": "貼紙上的字",
--          "full": { "src": "...", "w": 寬, "h": 高 } }   ← full 是裁切前的原圖，可省略
--      src 只能是：
--        stickers/xxxxxxxxxx.webp      ：網站原本的圖片
--        sb:客戶代號/檔名.webp 或 .jpg  ：上傳到 sticker-photos 的照片
-- ---------------------------------------------------------------------
create or replace function public.sticker_image_ok(img jsonb, is_full boolean)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  k text;
begin
  if jsonb_typeof(img) is distinct from 'object' then
    return false;
  end if;

  -- 只允許這幾個欄位；原圖（full）只能有 src、w、h
  for k in select jsonb_object_keys(img) loop
    if is_full and k not in ('src', 'w', 'h') then
      return false;
    end if;
    if not is_full and k not in ('src', 'w', 'h', 'caption', 'text', 'full') then
      return false;
    end if;
  end loop;

  if jsonb_typeof(img -> 'src') is distinct from 'string'
     or (img ->> 'src') !~ '^(stickers/[0-9a-f]{10}(-s)?\.webp|sb:[A-Za-z0-9_-]{1,40}/[A-Za-z0-9_-]{1,60}\.(webp|jpg))$' then
    return false;
  end if;

  if jsonb_typeof(img -> 'w') is distinct from 'number'
     or jsonb_typeof(img -> 'h') is distinct from 'number' then
    return false;
  end if;
  if (img ->> 'w')::numeric not between 1 and 10000
     or (img ->> 'h')::numeric not between 1 and 10000 then
    return false;
  end if;

  -- 說明 100 字以內、貼紙上的字 200 字以內
  if img ? 'caption' and (jsonb_typeof(img -> 'caption') is distinct from 'string'
                          or char_length(img ->> 'caption') > 100) then
    return false;
  end if;
  if img ? 'text' and (jsonb_typeof(img -> 'text') is distinct from 'string'
                       or char_length(img ->> 'text') > 200) then
    return false;
  end if;

  if img ? 'full' and not public.sticker_image_ok(img -> 'full', true) then
    return false;
  end if;

  return true;
end;
$$;

-- 輔助函式：檢查整組圖片（陣列、最多 max_items 張、每張都合格）
create or replace function public.sticker_images_ok(imgs jsonb, max_items integer)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  img jsonb;
begin
  if jsonb_typeof(imgs) is distinct from 'array' or jsonb_array_length(imgs) > max_items then
    return false;
  end if;
  for img in select jsonb_array_elements(imgs) loop
    if not public.sticker_image_ok(img, false) then
      return false;
    end if;
  end loop;
  return true;
end;
$$;


-- ---------------------------------------------------------------------
-- 0-2. 修改紀錄資料表與 CHECK 限制
--      customer_key：客戶代號，對應 stickers-data.js 每位客戶的 key；
--                    現場新增的客戶由網頁產生（new- 開頭）。
--      其餘欄位對應 stickers-data.js：
--        no 編號、name 客戶名稱、company 貼紙公司名、style 貼紙樣式、
--        position 滾字／貼紙位置、die 滾字（字模）、qty 字模數量、
--        die_l 廠商（大）、die_m 年（中）、die_s 月（小）、note 備註、
--        stickers 貼紙圖片、positions 貼法位置圖
--      editor：修改人（必填，網頁會記住）；summary：這次改了什麼（網頁自動產生）
-- ---------------------------------------------------------------------
create table if not exists public.sticker_edits (
  id           bigint      generated always as identity primary key,
  created_at   timestamptz not null default now(),

  customer_key text        not null,
  no           text        not null default '',
  name         text        not null default '',
  company      text        not null default '',
  style        text        not null default '',
  position     text        not null default '',
  die          text        not null default '',
  qty          text        not null default '',
  die_l        text        not null default '',
  die_m        text        not null default '',
  die_s        text        not null default '',
  note         text        not null default '',
  stickers     jsonb       not null default '[]'::jsonb,
  positions    jsonb       not null default '[]'::jsonb,
  editor       text        not null,
  summary      text        not null default '',

  -- 客戶代號：英數字、底線、連字號，1～40 字
  constraint sticker_edits_key_format
    check (customer_key ~ '^[A-Za-z0-9_-]{1,40}$'),
  -- 客戶名稱或貼紙公司名至少要有一個
  constraint sticker_edits_name_required
    check (char_length(btrim(name)) > 0 or char_length(btrim(company)) > 0),
  -- 各欄位長度
  constraint sticker_edits_text_len
    check (char_length(no) <= 10
       and char_length(name) <= 50
       and char_length(company) <= 50
       and char_length(style) <= 100
       and char_length(position) <= 100
       and char_length(die) <= 50
       and char_length(qty) <= 10
       and char_length(die_l) <= 50
       and char_length(die_m) <= 50
       and char_length(die_s) <= 50
       and char_length(note) <= 500
       and char_length(summary) <= 200),
  -- 修改人：1～30 字
  constraint sticker_edits_editor_len
    check (char_length(btrim(editor)) between 1 and 30),
  -- 貼紙圖片、貼法位置圖：各最多 10 張，格式見 0-1
  constraint sticker_edits_stickers_ok
    check (public.sticker_images_ok(stickers, 10)),
  constraint sticker_edits_positions_ok
    check (public.sticker_images_ok(positions, 10))
);

comment on table  public.sticker_edits              is '客戶貼紙修改紀錄（每次存檔一筆完整內容，只能新增）';
comment on column public.sticker_edits.customer_key is '客戶代號（stickers-data.js 的 key；現場新增的客戶為 new- 開頭）';
comment on column public.sticker_edits.stickers     is '貼紙圖片（格式同 stickers-data.js）';
comment on column public.sticker_edits.positions    is '貼法位置圖（格式同 stickers-data.js）';
comment on column public.sticker_edits.editor       is '修改人（網頁填寫，未驗證身分）';
comment on column public.sticker_edits.summary      is '這次改了什麼（網頁自動產生）';

create index if not exists sticker_edits_key_id_idx
  on public.sticker_edits (customer_key, id desc);


-- ---------------------------------------------------------------------
-- 0-3. 每位客戶最新的一筆
--      security_invoker：用查詢者自己的權限讀，沿用 sticker_edits 的 RLS。
-- ---------------------------------------------------------------------
create or replace view public.sticker_current
with (security_invoker = true) as
select distinct on (customer_key) *
from public.sticker_edits
order by customer_key, id desc;

comment on view public.sticker_current is '每位客戶最新的貼紙資料（網頁讀這個）';


-- ---------------------------------------------------------------------
-- 1. GRANT
--    - anon、authenticated：可以讀取；只能新增下列欄位，
--      id、created_at 一律由資料庫產生，不能指定。
--    - 沒有 UPDATE、DELETE：舊紀錄不能改也不能刪。
--    - 檢查函式：CHECK 會用新增者的身分呼叫，所以 anon、authenticated
--      要有執行權限。函式只檢查傳進來的內容，不讀也不寫任何資料表。
-- ---------------------------------------------------------------------
revoke all on table public.sticker_edits   from public, anon, authenticated;
revoke all on table public.sticker_current from public, anon, authenticated;

grant usage on schema public to anon, authenticated;
grant select on table public.sticker_edits   to anon, authenticated;
grant select on table public.sticker_current to anon, authenticated;
grant insert (customer_key, no, name, company, style, position, die, qty,
              die_l, die_m, die_s, note, stickers, positions, editor, summary)
  on table public.sticker_edits to anon, authenticated;

revoke all on function public.sticker_image_ok(jsonb, boolean)  from public, anon, authenticated;
revoke all on function public.sticker_images_ok(jsonb, integer) from public, anon, authenticated;
grant execute on function public.sticker_image_ok(jsonb, boolean)  to anon, authenticated;
grant execute on function public.sticker_images_ok(jsonb, integer) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 2. RLS
--    - 讀取：任何人。
--    - 新增：任何人；內容是否合格由第 3 層 CHECK（0-2 的 constraint）判斷。
--    - 修改、刪除：沒有政策，一律拒絕。
-- ---------------------------------------------------------------------
alter table public.sticker_edits enable row level security;

drop policy if exists "任何人可讀取貼紙修改紀錄" on public.sticker_edits;
create policy "任何人可讀取貼紙修改紀錄"
  on public.sticker_edits
  for select
  to anon, authenticated
  using (true);

drop policy if exists "任何人可新增貼紙修改紀錄" on public.sticker_edits;
create policy "任何人可新增貼紙修改紀錄"
  on public.sticker_edits
  for insert
  to anon, authenticated
  with check (true);


-- ---------------------------------------------------------------------
-- 3. Storage：貼紙照片儲存空間 sticker-photos
--    - 公開讀取（照片網址任何人都能看，和網站上的貼紙圖一樣公開）。
--    - 每張最多 3 MB，只收 WebP、JPEG（網頁會先縮小、壓縮成 WebP 再上傳）。
--    - 任何人可以上傳，檔名必須是「客戶代號/檔名.webp 或 .jpg」。
--    - 沒有 UPDATE、DELETE 政策：上傳後不能覆蓋或刪除，舊照片留著供還原。
--    如果這一段執行失敗（權限不足），請改到 Supabase → Storage → New bucket
--    手動建立：名稱 sticker-photos、勾選 Public、檔案上限 3 MB、
--    允許類型 image/webp, image/jpeg，再重新執行這個檔案。
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sticker-photos', 'sticker-photos', true, 3145728, array['image/webp', 'image/jpeg'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "任何人可上傳貼紙照片" on storage.objects;
create policy "任何人可上傳貼紙照片"
  on storage.objects
  for insert
  to anon, authenticated
  with check (
    bucket_id = 'sticker-photos'
    and name ~ '^[A-Za-z0-9_-]{1,40}/[A-Za-z0-9_-]{1,60}\.(webp|jpg)$'
  );

-- 上傳時 Storage 會讀回剛新增的那一筆，所以也要能讀取
drop policy if exists "任何人可讀取貼紙照片" on storage.objects;
create policy "任何人可讀取貼紙照片"
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'sticker-photos');


-- ---------------------------------------------------------------------
-- 4. 查詢範例（需要時在 SQL Editor 執行）
--
--    最近 50 次修改：
--      select id, created_at, customer_key, name, editor, summary
--      from public.sticker_edits order by id desc limit 50;
--
--    某位客戶的全部紀錄（例：No.1 鑫永富，代號 1）：
--      select * from public.sticker_edits where customer_key = '1' order by id desc;
--
--    被亂改時：在網頁「修改」→「修改紀錄」按「還原這一版」即可，
--    不需要在資料庫刪除任何資料。
-- ---------------------------------------------------------------------
