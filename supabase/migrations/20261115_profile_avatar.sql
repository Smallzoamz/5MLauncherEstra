-- Support user profile customization & avatar upload/URL in Estra Social Gateway

alter table public.launcher_profiles
  add column if not exists avatar_url text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'launcher_profiles_avatar_url_chk'
  ) then
    alter table public.launcher_profiles
      add constraint launcher_profiles_avatar_url_chk check (
        avatar_url is null
        or (
          avatar_url ~* '^https://[^\s]{3,492}$'
          and length(avatar_url) <= 500
        )
        or (
          avatar_url ~* '^data:image/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$'
          and length(avatar_url) <= 45000
        )
      );
  end if;
end $$;

create or replace function private.profile_json(p public.launcher_profiles)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_presence text := private.compute_presence(p.status_pref, p.is_demo, p.last_seen_at, p.current_server_name);
  v_show_srv boolean := (v_presence <> 'offline' and p.current_server_name is not null and length(trim(p.current_server_name)) > 0);
begin
  return jsonb_build_object(
    'id', p.id,
    'username', p.username,
    'displayName', p.display_name,
    'friendCode', p.friend_code,
    'avatarColor', p.avatar_color,
    'avatarUrl', coalesce(p.avatar_url, ''),
    'statusPref', p.status_pref,
    'presence', v_presence,
    'isDemo', p.is_demo,
    'lastSeenAt', p.last_seen_at,
    'currentServer', case when v_show_srv then jsonb_build_object(
      'id', coalesce(p.current_server_id, ''),
      'name', p.current_server_name,
      'ip', coalesce(p.current_server_ip, '')
    ) else null end
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
    delete from public.launcher_friendships
    where (user_id = p_uid and friend_id = (p_payload->>'friendId')::uuid)
       or (friend_id = p_uid and user_id = (p_payload->>'friendId')::uuid);
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
