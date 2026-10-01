-- OrangeSwim database setup.
-- Paste this whole file into the Supabase dashboard, SQL Editor, New query, then Run.
-- It is safe to run again: tables and indexes use "if not exists", functions use
-- "create or replace" and policies are dropped before being recreated.
--
-- Security model (pragmatic, friends only): everyone can READ swimmers (without the
-- PIN hash) and sessions. All WRITES go through the SECURITY DEFINER functions below,
-- which check the swimmer's 4 digit PIN. The PIN is a friendly guard, not real security.

create extension if not exists pgcrypto with schema extensions;

-- ===========================================================================
-- Tables
-- ===========================================================================

create table if not exists public.swimmers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(btrim(name)) between 2 and 30),
  pin_hash   text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists swimmers_name_lower_idx on public.swimmers (lower(name));

create table if not exists public.sessions (
  id          uuid primary key default gen_random_uuid(),
  swimmer_id  uuid not null references public.swimmers (id) on delete cascade,
  swim_date   date not null,
  meters      int  not null check (meters between 1 and 20000),
  pool        text null check (pool is null or char_length(pool) <= 80),
  photo_path  text null,
  created_at  timestamptz not null default now()
);

create index if not exists sessions_swim_date_idx on public.sessions (swim_date);
create index if not exists sessions_swimmer_id_idx on public.sessions (swimmer_id);

-- ===========================================================================
-- Privileges and row level security
-- ===========================================================================

alter table public.swimmers enable row level security;
alter table public.sessions enable row level security;

-- No direct writes for the API roles. Reads only, and never the PIN hash.
revoke all on table public.swimmers from anon, authenticated;
revoke all on table public.sessions from anon, authenticated;
grant select (id, name, created_at) on table public.swimmers to anon, authenticated;
grant select on table public.sessions to anon, authenticated;

drop policy if exists "swimmers are readable by everyone" on public.swimmers;
create policy "swimmers are readable by everyone"
  on public.swimmers for select to anon, authenticated using (true);

drop policy if exists "sessions are readable by everyone" on public.sessions;
create policy "sessions are readable by everyone"
  on public.sessions for select to anon, authenticated using (true);

-- ===========================================================================
-- Functions (the only way to write data)
-- ===========================================================================

create or replace function public.register_swimmer(p_name text, p_pin text)
returns table (id uuid, name text)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
begin
  if char_length(v_name) < 2 or char_length(v_name) > 30 then
    raise exception 'Name must be 2 to 30 characters.';
  end if;
  if coalesce(p_pin, '') !~ '^[0-9]{4}$' then
    raise exception 'PIN must be exactly 4 digits.';
  end if;
  if exists (select 1 from public.swimmers s where lower(s.name) = lower(v_name)) then
    raise exception 'That name is already taken. Pick another one, or sign in instead.';
  end if;

  return query
    insert into public.swimmers as s (name, pin_hash)
    values (v_name, crypt(p_pin, gen_salt('bf')))
    returning s.id, s.name;
exception
  when unique_violation then
    raise exception 'That name is already taken. Pick another one, or sign in instead.';
end;
$$;

create or replace function public.login_swimmer(p_name text, p_pin text)
returns table (id uuid, name text)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
begin
  return query
    select s.id, s.name
    from public.swimmers s
    where lower(s.name) = lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'))
      and s.pin_hash = crypt(coalesce(p_pin, ''), s.pin_hash);
  if not found then
    raise exception 'Wrong name or PIN.';
  end if;
end;
$$;

create or replace function public.add_session(
  p_swimmer_id uuid,
  p_pin text,
  p_date date,
  p_meters int,
  p_pool text default null,
  p_photo_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id   uuid;
  v_pool text := nullif(regexp_replace(btrim(coalesce(p_pool, '')), '\s+', ' ', 'g'), '');
begin
  if not exists (
    select 1 from public.swimmers s
    where s.id = p_swimmer_id and s.pin_hash = crypt(coalesce(p_pin, ''), s.pin_hash)
  ) then
    raise exception 'Wrong name or PIN.';
  end if;
  if p_date is null then
    raise exception 'Date is required.';
  end if;
  -- One day of slack: the client sends its local date, which can be ahead of UTC.
  if p_date > current_date + 1 then
    raise exception 'Date cannot be in the future.';
  end if;
  if p_meters is null or p_meters < 1 or p_meters > 20000 then
    raise exception 'Distance must be between 1 and 20,000 m.';
  end if;
  if v_pool is not null and char_length(v_pool) > 80 then
    raise exception 'Pool name is too long (80 characters max).';
  end if;
  if p_photo_path is not null and p_photo_path not like (p_swimmer_id::text || '/%') then
    raise exception 'Invalid photo path.';
  end if;

  insert into public.sessions (swimmer_id, swim_date, meters, pool, photo_path)
  values (p_swimmer_id, p_date, p_meters, v_pool, p_photo_path)
  returning sessions.id into v_id;

  return v_id;
end;
$$;

create or replace function public.delete_session(p_session_id uuid, p_swimmer_id uuid, p_pin text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_path text;
begin
  if not exists (
    select 1 from public.swimmers s
    where s.id = p_swimmer_id and s.pin_hash = crypt(coalesce(p_pin, ''), s.pin_hash)
  ) then
    raise exception 'Wrong name or PIN.';
  end if;

  delete from public.sessions t
  where t.id = p_session_id and t.swimmer_id = p_swimmer_id
  returning t.photo_path into v_path;

  if not found then
    raise exception 'Session not found, or it is not yours.';
  end if;

  return v_path;
end;
$$;

revoke all on function public.register_swimmer(text, text) from public;
revoke all on function public.login_swimmer(text, text) from public;
revoke all on function public.add_session(uuid, text, date, int, text, text) from public;
revoke all on function public.delete_session(uuid, uuid, text) from public;

grant execute on function public.register_swimmer(text, text) to anon, authenticated;
grant execute on function public.login_swimmer(text, text) to anon, authenticated;
grant execute on function public.add_session(uuid, text, date, int, text, text) to anon, authenticated;
grant execute on function public.delete_session(uuid, uuid, text) to anon, authenticated;

-- ===========================================================================
-- Storage: public "photos" bucket (5 MB max per file, images only)
-- ===========================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Pragmatic: anyone with the app can upload, read and delete photos in this bucket.
drop policy if exists "orangeswim photos select" on storage.objects;
create policy "orangeswim photos select"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'photos');

drop policy if exists "orangeswim photos insert" on storage.objects;
create policy "orangeswim photos insert"
  on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'photos');

drop policy if exists "orangeswim photos delete" on storage.objects;
create policy "orangeswim photos delete"
  on storage.objects for delete to anon, authenticated
  using (bucket_id = 'photos');

-- Ask the API to pick up the new functions right away.
notify pgrst, 'reload schema';
