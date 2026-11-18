-- Estra FiveM Launcher — Per-User Cloud Server List & Server Settings Sync
-- Keeps user-added servers and per-server settings synced across devices while keeping machine-local launcher settings per PC.

alter table public.launcher_profiles
  add column if not exists active_server_id text,
  add column if not exists servers_synced_at timestamptz;

create table if not exists public.launcher_user_servers (
  user_id uuid not null references public.launcher_profiles(id) on delete cascade,
  server_id text not null,
  name text not null default '',
  ip text not null default '',
  tag text not null default '',
  in_game_name text not null default '',
  custom_banner_url text not null default '',
  cl2 boolean not null default false,
  favorite boolean not null default false,
  patch_manifest_url text not null default '',
  directory_slug text not null default '',
  last_fetched_name text not null default '',
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, server_id)
);

create index if not exists launcher_user_servers_user_order_idx
  on public.launcher_user_servers (user_id, sort_order asc, updated_at asc);

alter table public.launcher_user_servers enable row level security;

drop policy if exists "user_servers_all_own" on public.launcher_user_servers;
create policy "user_servers_all_own"
  on public.launcher_user_servers
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.launcher_user_servers from public, anon;
grant select, insert, update, delete on public.launcher_user_servers to authenticated;
grant select, insert, update, delete on public.launcher_user_servers to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.launcher_user_servers;
    exception when duplicate_object then
      null;
    end;
  end if;
end $$;

create or replace function private.sanitize_http_url(p_raw text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_val text;
begin
  v_val := left(trim(coalesce(p_raw, '')), 500);
  if v_val = '' then
    return '';
  end if;
  if v_val ~* '^https?://[^\s]{3,493}$' then
    return v_val;
  end if;
  return '';
end;
$$;

create or replace function private.build_social_state(p_uid uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_me public.launcher_profiles%rowtype;
  v_friends jsonb;
  v_in_reqs jsonb;
  v_out_reqs jsonb;
  v_fav_servers jsonb;
  v_saved_servers jsonb;
  v_in_invites jsonb;
  v_out_invites jsonb;
begin
  select * into v_me from public.launcher_profiles where id = p_uid;
  if not found then
    return jsonb_build_object('errorStatus', 404, 'error', 'ไม่พบโปรไฟล์ผู้ใช้');
  end if;

  select coalesce(jsonb_agg(item order by is_fav desc, pres_rank asc, dname asc), '[]'::jsonb)
  into v_friends
  from (
    select
      f.is_favorite as is_fav,
      fp.display_name as dname,
      case private.compute_presence(fp.status_pref, fp.is_demo, fp.last_seen_at, fp.current_server_name)
        when 'in-game' then 0 when 'online' then 1 when 'away' then 2 else 3
      end as pres_rank,
      private.profile_json(fp) || jsonb_build_object('isFavorite', f.is_favorite) as item
    from public.launcher_friendships f
    join public.launcher_profiles fp on fp.id = f.friend_id
    where f.user_id = p_uid
  ) sub;

  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'createdAt', r.created_at, 'user', private.profile_json(fp)) order by r.created_at desc), '[]'::jsonb)
  into v_in_reqs
  from public.launcher_friend_requests r
  join public.launcher_profiles fp on fp.id = r.from_user_id
  where r.to_user_id = p_uid and r.status = 'pending';

  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'createdAt', r.created_at, 'user', private.profile_json(tp)) order by r.created_at desc), '[]'::jsonb)
  into v_out_reqs
  from public.launcher_friend_requests r
  join public.launcher_profiles tp on tp.id = r.to_user_id
  where r.from_user_id = p_uid and r.status = 'pending';

  select coalesce(jsonb_agg(jsonb_build_object('id', s.server_id, 'name', s.name, 'ip', s.ip, 'tag', s.tag, 'created_at', s.created_at) order by s.created_at desc), '[]'::jsonb)
  into v_fav_servers
  from public.launcher_favorite_servers s
  where s.user_id = p_uid;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', us.server_id,
    'name', us.name,
    'ip', us.ip,
    'tag', us.tag,
    'inGameName', us.in_game_name,
    'customBannerUrl', us.custom_banner_url,
    'cl2', us.cl2,
    'favorite', us.favorite,
    'patchManifestUrl', us.patch_manifest_url,
    'directorySlug', us.directory_slug,
    'lastFetchedName', us.last_fetched_name,
    'updatedAt', us.updated_at
  ) order by us.sort_order asc, us.updated_at asc), '[]'::jsonb)
  into v_saved_servers
  from public.launcher_user_servers us
  where us.user_id = p_uid;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id,
    'createdAt', i.created_at,
    'expiresAt', i.expires_at,
    'server', jsonb_build_object('id', i.server_id, 'name', i.server_name, 'ip', i.server_ip),
    'fromUser', private.profile_json(fp)
  ) order by i.created_at desc), '[]'::jsonb)
  into v_in_invites
  from public.launcher_game_invites i
  join public.launcher_profiles fp on fp.id = i.from_user_id
  where i.to_user_id = p_uid and i.status = 'pending' and i.expires_at > clock_timestamp();

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id,
    'createdAt', i.created_at,
    'expiresAt', i.expires_at,
    'server', jsonb_build_object('id', i.server_id, 'name', i.server_name, 'ip', i.server_ip),
    'toUser', private.profile_json(tp)
  ) order by i.created_at desc), '[]'::jsonb)
  into v_out_invites
  from public.launcher_game_invites i
  join public.launcher_profiles tp on tp.id = i.to_user_id
  where i.from_user_id = p_uid and i.status = 'pending' and i.expires_at > clock_timestamp();

  return jsonb_build_object(
    'success', true,
    'mode', 'supabase',
    'user', private.profile_json(v_me),
    'friends', v_friends,
    'incomingRequests', v_in_reqs,
    'outgoingRequests', v_out_reqs,
    'favoriteServers', v_fav_servers,
    'savedServers', v_saved_servers,
    'activeServerId', coalesce(v_me.active_server_id, ''),
    'hasSyncedServers', (v_me.servers_synced_at is not null),
    'incomingInvites', v_in_invites,
    'outgoingInvites', v_out_invites,
    'unreadMessages', private.build_unread_messages(p_uid)
  );
end;
$$;

create or replace function public.launcher_social_gateway_rpc(p_uid uuid, p_action text, p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rl record;
  v_q text;
  v_users jsonb;
  v_me public.launcher_profiles%rowtype;
  v_tgt public.launcher_profiles%rowtype;
  v_req public.launcher_friend_requests%rowtype;
  v_inv public.launcher_game_invites%rowtype;
  v_msg public.launcher_direct_messages%rowtype;
  v_pref text;
  v_has_srv boolean;
  v_srv jsonb;
  v_sid text;
  v_sname text;
  v_sip text;
  v_want boolean;
  v_favs jsonb;
  v_samples jsonb;
  v_item jsonb;
  v_fid uuid;
  v_dname text;
  v_acolor text;
  v_aurl text;
  v_pair text;
  v_body text;
  v_cutoff_id bigint;
  v_msgs jsonb;
  v_sync_servers jsonb;
  v_active_sid text;
  v_idx integer;
  v_url text;
  v_man_url text;
  v_stag text;
  v_ign text;
  v_slug text;
  v_lfname text;
  v_cl2 boolean;
  v_fav boolean;
begin
  if p_uid is null then
    return jsonb_build_object('errorStatus', 401, 'error', 'กรุณาเข้าสู่ระบบบัญชี Estra ก่อนใช้งาน');
  end if;

  if p_action = 'state' then
    return private.build_social_state(p_uid);
  end if;

  if p_action = 'search' then
    select * into v_rl from public.launcher_check_rate_limit('search:user:' || p_uid::text, 30, 60, 60);
    if not v_rl.allowed then
      return jsonb_build_object('errorStatus', 429, 'code', 'RATE_LIMITED', 'retryAfter', v_rl.retry_after, 'error', 'ค้นหาถี่เกินไป กรุณารอ ' || v_rl.retry_after || ' วินาที');
    end if;
    v_q := replace(replace(replace(lower(trim(coalesce(p_payload->>'q', ''))), '\', '\\'), '%', '\%'), '_', '\_');
    if length(v_q) < 2 then
      return jsonb_build_object('success', true, 'users', '[]'::jsonb);
    end if;
    select coalesce(jsonb_agg(row_json), '[]'::jsonb) into v_users
    from (
      select
        private.profile_json(p) || jsonb_build_object(
          'relation', case
            when exists (select 1 from public.launcher_friendships f where f.user_id = p_uid and f.friend_id = p.id) then 'friend'
            when exists (select 1 from public.launcher_friend_requests r where r.status = 'pending' and r.from_user_id = p_uid and r.to_user_id = p.id) then 'pending_out'
            when exists (select 1 from public.launcher_friend_requests r where r.status = 'pending' and r.to_user_id = p_uid and r.from_user_id = p.id) then 'pending_in'
            else 'none'
          end,
          'incomingRequestId', (select r.id from public.launcher_friend_requests r where r.status = 'pending' and r.to_user_id = p_uid and r.from_user_id = p.id limit 1)
        ) as row_json
      from public.launcher_profiles p
      where p.is_demo = false and p.id <> p_uid
        and (p.username ilike '%' || v_q || '%' escape '\' or p.friend_code ilike '%' || v_q || '%' escape '\' or p.display_name ilike '%' || v_q || '%' escape '\')
      order by p.username asc
      limit 8
    ) s;
    return jsonb_build_object('success', true, 'users', v_users);
  end if;

  if p_action = 'heartbeat' then
    select * into v_rl from public.launcher_check_rate_limit('heartbeat:user:' || p_uid::text, 30, 60, 60);
    if not v_rl.allowed then
      return jsonb_build_object('errorStatus', 429, 'code', 'RATE_LIMITED', 'retryAfter', v_rl.retry_after, 'error', 'ส่งสถานะถี่เกินไป กรุณารอ ' || v_rl.retry_after || ' วินาที');
    end if;
    select * into v_me from public.launcher_profiles where id = p_uid;
    if not found then return jsonb_build_object('errorStatus', 404, 'error', 'ไม่พบผู้ใช้'); end if;
    v_pref := coalesce(nullif(p_payload->>'statusPref', ''), v_me.status_pref);
    if v_pref not in ('online', 'away', 'invisible', 'offline') then v_pref := v_me.status_pref; end if;
    v_has_srv := (p_payload ? 'activeServer');
    v_srv := case when jsonb_typeof(p_payload->'activeServer') = 'object' then p_payload->'activeServer' else null end;
    update public.launcher_profiles
    set status_pref = v_pref,
        last_seen_at = clock_timestamp(),
        current_server_id = case when v_has_srv then left(nullif(v_srv->>'id', ''), 100) else current_server_id end,
        current_server_name = case when v_has_srv then left(nullif(v_srv->>'name', ''), 100) else current_server_name end,
        current_server_ip = case when v_has_srv then left(nullif(v_srv->>'ip', ''), 253) else current_server_ip end
    where id = p_uid
    returning * into v_me;
    return jsonb_build_object('success', true, 'user', private.profile_json(v_me));
  end if;

  if p_action = 'servers-sync' then
    select * into v_rl from public.launcher_check_rate_limit('servers-sync:user:' || p_uid::text, 60, 60, 30);
    if not v_rl.allowed then
      return jsonb_build_object('errorStatus', 429, 'code', 'RATE_LIMITED', 'retryAfter', v_rl.retry_after, 'error', 'บันทึกข้อมูลเซิร์ฟเวอร์ถี่เกินไป กรุณารอ ' || v_rl.retry_after || ' วินาที');
    end if;
    select * into v_me from public.launcher_profiles where id = p_uid;
    if not found then return jsonb_build_object('errorStatus', 404, 'error', 'ไม่พบผู้ใช้'); end if;

    v_sync_servers := coalesce(p_payload->'servers', '[]'::jsonb);
    if jsonb_typeof(v_sync_servers) <> 'array' then
      return jsonb_build_object('errorStatus', 400, 'error', 'รูปแบบข้อมูลเซิร์ฟเวอร์ไม่ถูกต้อง');
    end if;
    if jsonb_array_length(v_sync_servers) > 200 then
      return jsonb_build_object('errorStatus', 400, 'error', 'จำนวนเซิร์ฟเวอร์ต้องไม่เกิน 200 รายการ');
    end if;

    v_active_sid := left(trim(coalesce(p_payload->>'activeServerId', '')), 100);

    delete from public.launcher_user_servers where user_id = p_uid;
    delete from public.launcher_favorite_servers where user_id = p_uid;

    v_idx := 0;
    for v_item in select * from jsonb_array_elements(v_sync_servers) loop
      continue when jsonb_typeof(v_item) <> 'object';
      v_sid := left(trim(coalesce(v_item->>'id', '')), 100);
      if v_sid = '' then
        continue;
      end if;

      v_sname := left(trim(coalesce(v_item->>'name', '')), 100);
      if v_sname = '' then
        v_sname := v_sid;
      end if;
      v_sip := left(trim(coalesce(v_item->>'ip', '')), 253);
      v_stag := left(trim(coalesce(v_item->>'tag', '')), 40);
      v_ign := left(trim(coalesce(v_item->>'inGameName', '')), 80);
      v_url := private.sanitize_http_url(v_item->>'customBannerUrl');
      v_cl2 := case when jsonb_typeof(v_item->'cl2') = 'boolean' then (v_item->>'cl2')::boolean else false end;
      v_fav := case when jsonb_typeof(v_item->'favorite') = 'boolean' then (v_item->>'favorite')::boolean else false end;
      v_man_url := private.sanitize_http_url(v_item->>'patchManifestUrl');
      v_slug := left(trim(coalesce(v_item->>'directorySlug', '')), 100);
      v_lfname := left(trim(coalesce(v_item->>'lastFetchedName', '')), 100);

      insert into public.launcher_user_servers (
        user_id, server_id, name, ip, tag, in_game_name,
        custom_banner_url, cl2, favorite, patch_manifest_url,
        directory_slug, last_fetched_name, sort_order, updated_at
      )
      values (
        p_uid, v_sid, v_sname, v_sip, v_stag, v_ign,
        v_url, v_cl2, v_fav, v_man_url,
        v_slug, v_lfname, v_idx, clock_timestamp()
      )
      on conflict (user_id, server_id) do update set
        name = excluded.name,
        ip = excluded.ip,
        tag = excluded.tag,
        in_game_name = excluded.in_game_name,
        custom_banner_url = excluded.custom_banner_url,
        cl2 = excluded.cl2,
        favorite = excluded.favorite,
        patch_manifest_url = excluded.patch_manifest_url,
        directory_slug = excluded.directory_slug,
        last_fetched_name = excluded.last_fetched_name,
        sort_order = excluded.sort_order,
        updated_at = excluded.updated_at;

      if v_fav then
        insert into public.launcher_favorite_servers (user_id, server_id, name, ip, tag)
        values (p_uid, v_sid, v_sname, case when v_sip = '' then v_sid else v_sip end, v_stag)
        on conflict (user_id, server_id) do update set
          name = excluded.name,
          ip = excluded.ip,
          tag = excluded.tag;
      end if;

      v_idx := v_idx + 1;
    end loop;

    update public.launcher_profiles
    set active_server_id = nullif(v_active_sid, ''),
        servers_synced_at = clock_timestamp()
    where id = p_uid;

    return private.build_social_state(p_uid);
  end if;

  if p_action = 'profile-update' then
    select * into v_rl from public.launcher_check_rate_limit('profile-update:user:' || p_uid::text, 20, 600, 120);
    if not v_rl.allowed then
      return jsonb_build_object('errorStatus', 429, 'code', 'RATE_LIMITED', 'retryAfter', v_rl.retry_after, 'error', 'แก้ไขโปรไฟล์ถี่เกินไป กรุณารอ ' || v_rl.retry_after || ' วินาที');
    end if;
    select * into v_me from public.launcher_profiles where id = p_uid;
    if not found then return jsonb_build_object('errorStatus', 404, 'error', 'ไม่พบผู้ใช้'); end if;

    v_dname := v_me.display_name;
    if p_payload ? 'displayName' then
      v_dname := trim(coalesce(p_payload->>'displayName', ''));
      if length(v_dname) < 1 or length(v_dname) > 40 then
        return jsonb_build_object('errorStatus', 400, 'error', 'ชื่อที่แสดงต้องยาว 1-40 ตัวอักษร');
      end if;
    end if;

    v_acolor := v_me.avatar_color;
    if p_payload ? 'avatarColor' then
      v_acolor := lower(trim(coalesce(p_payload->>'avatarColor', '')));
      if v_acolor not in ('#2b6bf3', '#0ea5e9', '#6366f1', '#10b981', '#8b5cf6', '#f59e0b', '#ec4899') then
        return jsonb_build_object('errorStatus', 400, 'error', 'สีโปรไฟล์ไม่ถูกต้อง');
      end if;
    end if;

    v_aurl := v_me.avatar_url;
    if p_payload ? 'avatarUrl' then
      v_aurl := trim(coalesce(p_payload->>'avatarUrl', ''));
      if v_aurl = '' then
        v_aurl := null;
      elsif v_aurl ~* '^data:image/svg\+xml' then
        return jsonb_build_object('errorStatus', 400, 'error', 'ไม่รองรับไฟล์ SVG สำหรับรูปโปรไฟล์');
      elsif not (
        (v_aurl ~* '^https://[^\s]{3,492}$' and length(v_aurl) <= 500)
        or (v_aurl ~* '^data:image/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$' and length(v_aurl) <= 45000)
      ) then
        return jsonb_build_object('errorStatus', 400, 'error', 'รูปโปรไฟล์ไม่ถูกต้องหรือใหญ่เกินกำหนด (รองรับ PNG, JPG, WebP หรือลิงก์ HTTPS)');
      end if;
    end if;

    update public.launcher_profiles
    set display_name = v_dname,
        avatar_color = v_acolor,
        avatar_url = v_aurl
    where id = p_uid
    returning * into v_me;

    return jsonb_build_object('success', true, 'user', private.profile_json(v_me), 'message', 'บันทึกข้อมูลโปรไฟล์แล้ว');
  end if;

  if p_action = 'chat-history' then
    select * into v_rl from public.launcher_check_rate_limit('chat-read:user:' || p_uid::text, 60, 60, 30);
    if not v_rl.allowed then
      return jsonb_build_object('errorStatus', 429, 'code', 'RATE_LIMITED', 'retryAfter', v_rl.retry_after, 'error', 'โหลดแชทถี่เกินไป กรุณารอ ' || v_rl.retry_after || ' วินาที');
    end if;
    if coalesce(p_payload->>'friendId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return jsonb_build_object('errorStatus', 400, 'error', 'ไม่พบเพื่อนที่ต้องการสนทนา');
    end if;
    v_fid := (p_payload->>'friendId')::uuid;
    if v_fid = p_uid or not exists (select 1 from public.launcher_friendships where user_id = p_uid and friend_id = v_fid) then
      return jsonb_build_object('errorStatus', 403, 'error', 'สามารถแชทได้เฉพาะผู้ที่เป็นเพื่อนกันเท่านั้น');
    end if;
    v_pair := private.chat_pair_key(p_uid, v_fid);

    delete from public.launcher_direct_messages
    where id in (
      select id from public.launcher_direct_messages
      where expires_at <= clock_timestamp()
      limit 100
    );

    update public.launcher_direct_messages
    set read_at = clock_timestamp()
    where pair_key = v_pair
      and recipient_id = p_uid
      and sender_id = v_fid
      and read_at is null;

    select coalesce(jsonb_agg(msg_json order by msg_id asc), '[]'::jsonb)
    into v_msgs
    from (
      select
        m.id as msg_id,
        jsonb_build_object(
          'id', m.id,
          'senderId', m.sender_id,
          'recipientId', m.recipient_id,
          'body', m.body,
          'readAt', m.read_at,
          'createdAt', m.created_at,
          'expiresAt', m.expires_at
        ) as msg_json
      from public.launcher_direct_messages m
      where m.pair_key = v_pair
        and m.expires_at > clock_timestamp()
      order by m.id desc
      limit 50
    ) sub;

    return jsonb_build_object(
      'success', true,
      'friendId', v_fid,
      'messages', v_msgs,
      'unreadMessages', private.build_unread_messages(p_uid)
    );
  end if;

  if p_action = 'chat-send' then
    select * into v_rl from public.launcher_check_rate_limit('chat-send:user:' || p_uid::text, 15, 30, 30);
    if not v_rl.allowed then
      return jsonb_build_object('errorStatus', 429, 'code', 'RATE_LIMITED', 'retryAfter', v_rl.retry_after, 'error', 'ส่งข้อความถี่เกินไป กรุณารอ ' || v_rl.retry_after || ' วินาที');
    end if;
    if coalesce(p_payload->>'friendId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return jsonb_build_object('errorStatus', 400, 'error', 'ไม่พบเพื่อนที่ต้องการส่งข้อความ');
    end if;
    v_fid := (p_payload->>'friendId')::uuid;
    if v_fid = p_uid or not exists (select 1 from public.launcher_friendships where user_id = p_uid and friend_id = v_fid) then
      return jsonb_build_object('errorStatus', 403, 'error', 'สามารถส่งข้อความได้เฉพาะผู้ที่เป็นเพื่อนกันเท่านั้น');
    end if;
    select * into v_tgt from public.launcher_profiles where id = v_fid;
    if not found or v_tgt.is_demo then
      return jsonb_build_object('errorStatus', 400, 'error', 'ไม่สามารถส่งข้อความถึงบัญชีตัวอย่างได้');
    end if;

    v_body := regexp_replace(coalesce(p_payload->>'body', ''), '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g');
    v_body := trim(v_body);
    if char_length(v_body) < 1 then
      return jsonb_build_object('errorStatus', 400, 'error', 'กรุณาพิมพ์ข้อความก่อนส่ง');
    end if;
    if char_length(v_body) > 500 then
      return jsonb_build_object('errorStatus', 400, 'error', 'ข้อความต้องยาวไม่เกิน 500 ตัวอักษร');
    end if;

    v_pair := private.chat_pair_key(p_uid, v_fid);

    insert into public.launcher_direct_messages (pair_key, sender_id, recipient_id, body, expires_at)
    values (v_pair, p_uid, v_fid, v_body, clock_timestamp() + interval '7 days')
    returning * into v_msg;

    select id into v_cutoff_id
    from public.launcher_direct_messages
    where pair_key = v_pair
    order by id desc
    offset 49
    limit 1;

    if v_cutoff_id is not null then
      delete from public.launcher_direct_messages
      where pair_key = v_pair and id < v_cutoff_id;
    end if;

    delete from public.launcher_direct_messages
    where id in (
      select id from public.launcher_direct_messages
      where expires_at <= clock_timestamp()
      limit 100
    );

    return jsonb_build_object(
      'success', true,
      'friendId', v_fid,
      'message', jsonb_build_object(
        'id', v_msg.id,
        'senderId', v_msg.sender_id,
        'recipientId', v_msg.recipient_id,
        'body', v_msg.body,
        'readAt', v_msg.read_at,
        'createdAt', v_msg.created_at,
        'expiresAt', v_msg.expires_at
      ),
      'unreadMessages', private.build_unread_messages(p_uid)
    );
  end if;

  if p_action = 'chat-read' then
    if coalesce(p_payload->>'friendId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return jsonb_build_object('errorStatus', 400, 'error', 'ข้อมูลเพื่อนไม่ถูกต้อง');
    end if;
    v_fid := (p_payload->>'friendId')::uuid;
    v_pair := private.chat_pair_key(p_uid, v_fid);

    update public.launcher_direct_messages
    set read_at = clock_timestamp()
    where pair_key = v_pair
      and recipient_id = p_uid
      and sender_id = v_fid
      and read_at is null;

    return jsonb_build_object(
      'success', true,
      'friendId', v_fid,
      'unreadMessages', private.build_unread_messages(p_uid)
    );
  end if;

  if p_action = 'friend-request' then
    select * into v_rl from public.launcher_check_rate_limit('friend-request:user:' || p_uid::text, 20, 3600, 300);
    if not v_rl.allowed then
      return jsonb_build_object('errorStatus', 429, 'code', 'RATE_LIMITED', 'retryAfter', v_rl.retry_after, 'error', 'ส่งคำขอเพื่อนถี่เกินไป กรุณารอ ' || v_rl.retry_after || ' วินาที');
    end if;
    v_q := trim(coalesce(p_payload->>'target', ''));
    if v_q = '' then return jsonb_build_object('errorStatus', 400, 'error', 'กรุณากรอกชื่อผู้ใช้หรือ Friend Code'); end if;
    select * into v_tgt from public.launcher_profiles where username = lower(v_q) or friend_code = upper(v_q) limit 1;
    if not found then return jsonb_build_object('errorStatus', 404, 'error', 'ไม่พบผู้เล่นที่ตรงกับชื่อผู้ใช้หรือรหัสนี้'); end if;
    if v_tgt.id = p_uid then return jsonb_build_object('errorStatus', 400, 'error', 'ไม่สามารถเพิ่มตัวเองเป็นเพื่อนได้'); end if;
    if exists (select 1 from public.launcher_friendships where user_id = p_uid and friend_id = v_tgt.id) then
      return jsonb_build_object('errorStatus', 409, 'error', 'เป็นเพื่อนกันอยู่แล้ว');
    end if;
    select * into v_req from public.launcher_friend_requests where from_user_id = v_tgt.id and to_user_id = p_uid and status = 'pending';
    if found then
      update public.launcher_friend_requests set status = 'accepted' where id = v_req.id;
      insert into public.launcher_friendships (user_id, friend_id, is_favorite) values (p_uid, v_tgt.id, false), (v_tgt.id, p_uid, false) on conflict do nothing;
      return private.build_social_state(p_uid) || jsonb_build_object('status', 'accepted', 'message', 'เป็นเพื่อนกับ ' || v_tgt.display_name || ' แล้ว');
    end if;
    select * into v_req from public.launcher_friend_requests where from_user_id = p_uid and to_user_id = v_tgt.id;
    if found and v_req.status = 'pending' then
      return jsonb_build_object('errorStatus', 409, 'error', 'ส่งคำขอไปแล้ว กรุณารอการตอบรับ');
    elsif found then
      update public.launcher_friend_requests set status = 'pending', created_at = clock_timestamp() where id = v_req.id;
    else
      insert into public.launcher_friend_requests (from_user_id, to_user_id, status) values (p_uid, v_tgt.id, 'pending');
    end if;
    return private.build_social_state(p_uid) || jsonb_build_object('status', 'pending', 'message', 'ส่งคำขอเป็นเพื่อนไปยัง ' || v_tgt.display_name || ' แล้ว');
  end if;

  if p_action = 'game-invite' then
    select * into v_rl from public.launcher_check_rate_limit('invite:user:' || p_uid::text, 20, 600, 120);
    if not v_rl.allowed then
      return jsonb_build_object('errorStatus', 429, 'code', 'RATE_LIMITED', 'retryAfter', v_rl.retry_after, 'error', 'ส่งคำชวนเล่นถี่เกินไป กรุณารอ ' || v_rl.retry_after || ' วินาที');
    end if;
    if coalesce(p_payload->>'friendId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return jsonb_build_object('errorStatus', 400, 'error', 'ไม่พบเพื่อนที่ต้องการชวน');
    end if;
    v_fid := (p_payload->>'friendId')::uuid;
    if v_fid = p_uid then
      return jsonb_build_object('errorStatus', 400, 'error', 'ไม่สามารถชวนตัวเองได้');
    end if;
    if not exists (select 1 from public.launcher_friendships where user_id = p_uid and friend_id = v_fid) then
      return jsonb_build_object('errorStatus', 403, 'error', 'สามารถชวนได้เฉพาะผู้ที่เป็นเพื่อนกันเท่านั้น');
    end if;
    select * into v_tgt from public.launcher_profiles where id = v_fid;
    if not found or v_tgt.is_demo then
      return jsonb_build_object('errorStatus', 400, 'error', 'ไม่สามารถส่งคำชวนให้บัญชีตัวอย่างได้');
    end if;
    v_srv := p_payload->'server';
    v_sid := left(trim(coalesce(v_srv->>'id', '')), 100);
    v_sname := left(trim(coalesce(v_srv->>'name', '')), 100);
    v_sip := left(trim(coalesce(v_srv->>'ip', '')), 253);
    if v_sid = '' or v_sname = '' or v_sip = '' then
      return jsonb_build_object('errorStatus', 400, 'error', 'กรุณาเลือกเมืองก่อนชวนเพื่อน');
    end if;
    update public.launcher_game_invites
      set status = 'cancelled'
      where from_user_id = p_uid and to_user_id = v_fid and status = 'pending';
    insert into public.launcher_game_invites (from_user_id, to_user_id, server_id, server_name, server_ip, status, expires_at)
    values (p_uid, v_fid, v_sid, v_sname, v_sip, 'pending', clock_timestamp() + interval '5 minutes');
    return private.build_social_state(p_uid) || jsonb_build_object('message', 'ส่งคำชวนเข้าเล่น ' || v_sname || ' ไปยัง ' || v_tgt.display_name || ' แล้ว');
  end if;

  if p_action = 'game-invite-respond' then
    select * into v_rl from public.launcher_check_rate_limit('social-mut:user:' || p_uid::text, 60, 60, 60);
    if not v_rl.allowed then
      return jsonb_build_object('errorStatus', 429, 'code', 'RATE_LIMITED', 'retryAfter', v_rl.retry_after, 'error', 'ทำรายการถี่เกินไป กรุณารอ ' || v_rl.retry_after || ' วินาที');
    end if;
    if coalesce(p_payload->>'inviteId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return jsonb_build_object('errorStatus', 404, 'error', 'ไม่พบคำชวนเล่นเกมนี้');
    end if;
    select * into v_inv from public.launcher_game_invites where id = (p_payload->>'inviteId')::uuid and status = 'pending';
    if not found then
      return jsonb_build_object('errorStatus', 404, 'error', 'คำชวนหมดอายุหรือถูกจัดการแล้ว');
    end if;
    if v_inv.expires_at <= clock_timestamp() then
      update public.launcher_game_invites set status = 'expired' where id = v_inv.id;
      return jsonb_build_object('errorStatus', 410, 'error', 'คำชวนหมดอายุแล้ว');
    end if;
    if (p_payload->>'action') = 'cancel' then
      if v_inv.from_user_id <> p_uid then return jsonb_build_object('errorStatus', 403, 'error', 'ไม่มีสิทธิ์ยกเลิกคำชวนนี้'); end if;
      update public.launcher_game_invites set status = 'cancelled' where id = v_inv.id;
    elsif (p_payload->>'action') = 'accept' then
      if v_inv.to_user_id <> p_uid then return jsonb_build_object('errorStatus', 403, 'error', 'ไม่มีสิทธิ์จัดการคำชวนนี้'); end if;
      update public.launcher_game_invites set status = 'accepted' where id = v_inv.id;
    elsif (p_payload->>'action') = 'decline' then
      if v_inv.to_user_id <> p_uid then return jsonb_build_object('errorStatus', 403, 'error', 'ไม่มีสิทธิ์จัดการคำชวนนี้'); end if;
      update public.launcher_game_invites set status = 'declined' where id = v_inv.id;
    else
      return jsonb_build_object('errorStatus', 400, 'error', 'คำสั่งไม่ถูกต้อง');
    end if;
    return private.build_social_state(p_uid) || jsonb_build_object(
      'inviteServer', jsonb_build_object('id', v_inv.server_id, 'name', v_inv.server_name, 'ip', v_inv.server_ip)
    );
  end if;

  select * into v_rl from public.launcher_check_rate_limit('social-mut:user:' || p_uid::text, 60, 60, 60);
  if not v_rl.allowed then
    return jsonb_build_object('errorStatus', 429, 'code', 'RATE_LIMITED', 'retryAfter', v_rl.retry_after, 'error', 'ทำรายการถี่เกินไป กรุณารอ ' || v_rl.retry_after || ' วินาที');
  end if;

  if p_action = 'friend-respond' then
    if coalesce(p_payload->>'requestId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return jsonb_build_object('errorStatus', 404, 'error', 'ไม่พบคำขอเป็นเพื่อน');
    end if;
    select * into v_req from public.launcher_friend_requests where id = (p_payload->>'requestId')::uuid and status = 'pending';
    if not found then return jsonb_build_object('errorStatus', 404, 'error', 'ไม่พบคำขอเป็นเพื่อน'); end if;
    if (p_payload->>'action') = 'cancel' then
      if v_req.from_user_id <> p_uid then return jsonb_build_object('errorStatus', 403, 'error', 'ไม่มีสิทธิ์ยกเลิกคำขอนี้'); end if;
      delete from public.launcher_friend_requests where id = v_req.id;
    elsif (p_payload->>'action') = 'accept' then
      if v_req.to_user_id <> p_uid then return jsonb_build_object('errorStatus', 403, 'error', 'ไม่มีสิทธิ์จัดการคำขอนี้'); end if;
      update public.launcher_friend_requests set status = 'accepted' where id = v_req.id;
      insert into public.launcher_friendships (user_id, friend_id, is_favorite) values (v_req.from_user_id, v_req.to_user_id, false), (v_req.to_user_id, v_req.from_user_id, false) on conflict do nothing;
    elsif (p_payload->>'action') = 'decline' then
      if v_req.to_user_id <> p_uid then return jsonb_build_object('errorStatus', 403, 'error', 'ไม่มีสิทธิ์จัดการคำขอนี้'); end if;
      update public.launcher_friend_requests set status = 'declined' where id = v_req.id;
    else
      return jsonb_build_object('errorStatus', 400, 'error', 'คำสั่งไม่ถูกต้อง');
    end if;
    return private.build_social_state(p_uid);
  end if;

  if p_action = 'friend-favorite' then
    if coalesce(p_payload->>'friendId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return jsonb_build_object('errorStatus', 404, 'error', 'ไม่พบรายชื่อเพื่อนนี้');
    end if;
    update public.launcher_friendships
    set is_favorite = coalesce((p_payload->>'favorite')::boolean, not is_favorite)
    where user_id = p_uid and friend_id = (p_payload->>'friendId')::uuid;
    if not found then return jsonb_build_object('errorStatus', 404, 'error', 'ไม่พบรายชื่อเพื่อนนี้'); end if;
    return private.build_social_state(p_uid);
  end if;

  if p_action = 'friend-remove' then
    if coalesce(p_payload->>'friendId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return private.build_social_state(p_uid);
    end if;
    v_fid := (p_payload->>'friendId')::uuid;
    delete from public.launcher_friendships
    where (user_id = p_uid and friend_id = v_fid)
       or (friend_id = p_uid and user_id = v_fid);
    delete from public.launcher_direct_messages
    where pair_key = private.chat_pair_key(p_uid, v_fid);
    return private.build_social_state(p_uid);
  end if;

  if p_action = 'server-favorite' then
    v_srv := p_payload->'server';
    v_sid := left(trim(coalesce(v_srv->>'id', '')), 100);
    if v_sid = '' then return jsonb_build_object('errorStatus', 400, 'error', 'ข้อมูลเซิร์ฟเวอร์ไม่ถูกต้อง'); end if;
    v_want := coalesce((p_payload->>'favorite')::boolean, not exists(select 1 from public.launcher_favorite_servers where user_id = p_uid and server_id = v_sid));
    if v_want then
      insert into public.launcher_favorite_servers (user_id, server_id, name, ip, tag)
      values (p_uid, v_sid, left(coalesce(nullif(trim(v_srv->>'name'), ''), v_sid), 100), left(coalesce(nullif(trim(v_srv->>'ip'), ''), v_sid), 253), left(trim(coalesce(v_srv->>'tag', '')), 40))
      on conflict (user_id, server_id) do update set name = excluded.name, ip = excluded.ip, tag = excluded.tag;
    else
      delete from public.launcher_favorite_servers where user_id = p_uid and server_id = v_sid;
    end if;
    update public.launcher_user_servers
    set favorite = v_want,
        updated_at = clock_timestamp()
    where user_id = p_uid and server_id = v_sid;
    select coalesce(jsonb_agg(jsonb_build_object('id', s.server_id, 'name', s.name, 'ip', s.ip, 'tag', s.tag, 'created_at', s.created_at) order by s.created_at desc), '[]'::jsonb)
    into v_favs from public.launcher_favorite_servers s where s.user_id = p_uid;
    return jsonb_build_object('success', true, 'favoriteServers', v_favs);
  end if;

  if p_action = 'demo-seed' then
    v_samples := '[
      {"id":"11111111-1111-4111-8111-111111111101","u":"sacrig_demo","d":"Sacrig","c":"ESTRA-DM01","col":"#2b6bf3","pref":"online","sid":"noxtis-legacy","sn":"Noxtis Legacy","sip":"89.38.101.136:30120","fav":true},
      {"id":"11111111-1111-4111-8111-111111111102","u":"octalise_demo","d":"Octalise","c":"ESTRA-DM02","col":"#10b981","pref":"online","sid":"noxtis-legacy","sn":"Noxtis Legacy","sip":"89.38.101.136:30120","fav":true},
      {"id":"11111111-1111-4111-8111-111111111103","u":"aquanova_demo","d":"AquaNova","c":"ESTRA-DM03","col":"#0ea5e9","pref":"away","sid":null,"sn":null,"sip":null,"fav":false},
      {"id":"11111111-1111-4111-8111-111111111104","u":"crimson_demo","d":"CrimsonWhisper","c":"ESTRA-DM04","col":"#8b5cf6","pref":"offline","sid":null,"sn":null,"sip":null,"fav":false}
    ]'::jsonb;
    for v_item in select * from jsonb_array_elements(v_samples) loop
      insert into public.launcher_profiles (id, username, display_name, friend_code, avatar_color, status_pref, is_demo, last_seen_at, current_server_id, current_server_name, current_server_ip)
      values ((v_item->>'id')::uuid, v_item->>'u', v_item->>'d', v_item->>'c', v_item->>'col', v_item->>'pref', true, clock_timestamp(), v_item->>'sid', v_item->>'sn', v_item->>'sip')
      on conflict (id) do update set last_seen_at = clock_timestamp();
      insert into public.launcher_friendships (user_id, friend_id, is_favorite)
      values (p_uid, (v_item->>'id')::uuid, (v_item->>'fav')::boolean)
      on conflict (user_id, friend_id) do nothing;
    end loop;
    return private.build_social_state(p_uid);
  end if;

  return jsonb_build_object('errorStatus', 404, 'error', 'Social API action not found');
end;
$$;

revoke execute on function public.launcher_social_gateway_rpc(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.launcher_social_gateway_rpc(uuid, text, jsonb) to service_role;
