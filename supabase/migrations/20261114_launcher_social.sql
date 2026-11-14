-- Estra FiveM Launcher — Online Social, Friends, Presence, Favorites & Rate Limit Schema

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- 1. Atomic Sliding-Window / Fixed-Window Rate Limiter (Private Schema)
create table if not exists private.rate_limits (
  bucket_key text primary key,
  hits integer not null default 0,
  window_started_at timestamptz not null default now(),
  blocked_until timestamptz
);

create or replace function public.launcher_check_rate_limit(
  p_bucket_key text,
  p_limit integer,
  p_window_seconds integer,
  p_block_seconds integer default 60
)
returns table (
  allowed boolean,
  remaining integer,
  retry_after integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_row private.rate_limits%rowtype;
  v_retry integer;
begin
  if p_bucket_key is null or length(trim(p_bucket_key)) = 0 then
    return query select false, 0, greatest(p_block_seconds, 1);
    return;
  end if;

  insert into private.rate_limits as rl (bucket_key, hits, window_started_at, blocked_until)
  values (p_bucket_key, 0, v_now, null)
  on conflict (bucket_key) do nothing;

  select * into v_row
  from private.rate_limits
  where bucket_key = p_bucket_key
  for update;

  if v_row.blocked_until is not null and v_row.blocked_until > v_now then
    v_retry := greatest(1, ceil(extract(epoch from (v_row.blocked_until - v_now)))::integer);
    return query select false, 0, v_retry;
    return;
  end if;

  if v_row.window_started_at + make_interval(secs => greatest(p_window_seconds, 1)) <= v_now then
    update private.rate_limits
    set hits = 1,
        window_started_at = v_now,
        blocked_until = null
    where bucket_key = p_bucket_key;

    return query select true, greatest(p_limit - 1, 0), 0;
    return;
  end if;

  if v_row.hits >= p_limit then
    update private.rate_limits
    set blocked_until = v_now + make_interval(secs => greatest(p_block_seconds, 1))
    where bucket_key = p_bucket_key;

    return query select false, 0, greatest(p_block_seconds, 1);
    return;
  end if;

  update private.rate_limits
  set hits = v_row.hits + 1
  where bucket_key = p_bucket_key;

  return query select true, greatest(p_limit - (v_row.hits + 1), 0), 0;
end;
$$;

revoke execute on function public.launcher_check_rate_limit(text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.launcher_check_rate_limit(text, integer, integer, integer) to service_role;

-- 2. User Profiles (never stores email or password)
create table if not exists public.launcher_profiles (
  id uuid primary key,
  auth_user_id uuid unique references auth.users(id) on delete cascade,
  username text unique not null check (username ~ '^[a-z0-9_.-]{3,24}$'),
  display_name text not null check (char_length(trim(display_name)) between 1 and 32),
  friend_code text unique not null check (friend_code ~ '^ESTRA-[A-Z0-9]{4,8}$'),
  avatar_color text not null default '#2b6bf3',
  status_pref text not null default 'online' check (status_pref in ('online', 'away', 'invisible', 'offline')),
  is_demo boolean not null default false,
  last_seen_at timestamptz not null default now(),
  current_server_id text,
  current_server_name text,
  current_server_ip text,
  created_at timestamptz not null default now(),
  constraint launcher_profiles_real_user_chk check (is_demo or (auth_user_id is not null and auth_user_id = id))
);

-- 3. Friendships
create table if not exists public.launcher_friendships (
  user_id uuid not null references public.launcher_profiles(id) on delete cascade,
  friend_id uuid not null references public.launcher_profiles(id) on delete cascade,
  is_favorite boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  constraint launcher_friendships_not_self_chk check (user_id <> friend_id)
);

create index if not exists launcher_friendships_friend_id_idx on public.launcher_friendships (friend_id);

-- 4. Friend Requests
create table if not exists public.launcher_friend_requests (
  id uuid primary key default gen_random_uuid(),
  from_user_id uuid not null references public.launcher_profiles(id) on delete cascade,
  to_user_id uuid not null references public.launcher_profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  unique (from_user_id, to_user_id),
  constraint launcher_friend_requests_not_self_chk check (from_user_id <> to_user_id)
);

create index if not exists launcher_friend_requests_to_user_idx on public.launcher_friend_requests (to_user_id, status);
create index if not exists launcher_friend_requests_from_user_idx on public.launcher_friend_requests (from_user_id, status);

-- 5. Favorite Servers
create table if not exists public.launcher_favorite_servers (
  user_id uuid not null references public.launcher_profiles(id) on delete cascade,
  server_id text not null check (char_length(trim(server_id)) between 1 and 100),
  name text not null check (char_length(trim(name)) between 1 and 100),
  ip text not null check (char_length(trim(ip)) between 1 and 253),
  tag text not null default '',
  created_at timestamptz not null default now(),
  primary key (user_id, server_id)
);

-- 6. Row Level Security (Least Privilege)
alter table public.launcher_profiles enable row level security;
alter table public.launcher_friendships enable row level security;
alter table public.launcher_friend_requests enable row level security;
alter table public.launcher_favorite_servers enable row level security;

drop policy if exists "profiles_select_self_or_friends" on public.launcher_profiles;
create policy "profiles_select_self_or_friends"
  on public.launcher_profiles
  for select
  to authenticated
  using (
    (select auth.uid()) = id
    or exists (
      select 1 from public.launcher_friendships f
      where f.user_id = (select auth.uid()) and f.friend_id = launcher_profiles.id
    )
    or exists (
      select 1 from public.launcher_friend_requests r
      where r.status = 'pending'
        and (
          (r.from_user_id = (select auth.uid()) and r.to_user_id = launcher_profiles.id)
          or (r.to_user_id = (select auth.uid()) and r.from_user_id = launcher_profiles.id)
        )
    )
  );

drop policy if exists "profiles_update_self" on public.launcher_profiles;
create policy "profiles_update_self"
  on public.launcher_profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "friendships_select_own" on public.launcher_friendships;
create policy "friendships_select_own"
  on public.launcher_friendships
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "friendships_update_own" on public.launcher_friendships;
create policy "friendships_update_own"
  on public.launcher_friendships
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "friendships_delete_own" on public.launcher_friendships;
create policy "friendships_delete_own"
  on public.launcher_friendships
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "friend_requests_select_involved" on public.launcher_friend_requests;
create policy "friend_requests_select_involved"
  on public.launcher_friend_requests
  for select
  to authenticated
  using ((select auth.uid()) = from_user_id or (select auth.uid()) = to_user_id);

drop policy if exists "favorite_servers_all_own" on public.launcher_favorite_servers;
create policy "favorite_servers_all_own"
  on public.launcher_favorite_servers
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- 7. Grants & Realtime Publication
grant usage on schema public to anon, authenticated, service_role;
grant select, update on public.launcher_profiles to authenticated;
grant select, update, delete on public.launcher_friendships to authenticated;
grant select on public.launcher_friend_requests to authenticated;
grant select, insert, update, delete on public.launcher_favorite_servers to authenticated;
grant select, insert, update, delete on public.launcher_profiles, public.launcher_friendships, public.launcher_friend_requests, public.launcher_favorite_servers to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.launcher_profiles;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.launcher_friendships;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.launcher_friend_requests;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.launcher_favorite_servers;
    exception when duplicate_object then null;
    end;
  end if;
end $$;
