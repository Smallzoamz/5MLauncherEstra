import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.50.0';

const PAL = ['#2b6bf3', '#0ea5e9', '#6366f1', '#10b981', '#8b5cf6', '#f59e0b', '#ec4899'];
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-refresh-token',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};
type R = Record<string, unknown>;
const j = (s: number, b: R, h: Record<string, string> = {}) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS, ...h } });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const url = Deno.env.get('SUPABASE_URL') || '', sk = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '', ak = Deno.env.get('SUPABASE_ANON_KEY') || '';
  if (!url || !sk || !ak) return j(500, { success: false, error: 'Missing Supabase env' });
  const admin = createClient(url, sk, { auth: { persistSession: false, autoRefreshToken: false } });
  const ac = createClient(url, ak, { auth: { persistSession: false, autoRefreshToken: false } });
  const uo = new URL(req.url), idx = uo.pathname.indexOf('/api/social/'), route = idx >= 0 ? uo.pathname.slice(idx) : uo.pathname;
  const ip = (req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown').trim().slice(0, 64) || 'unknown';

  const checkRl = async (key: string, lim: number, win: number, blk: number) => {
    const { data, error } = await admin.rpc('launcher_check_rate_limit', { p_bucket_key: key, p_limit: lim, p_window_seconds: win, p_block_seconds: blk });
    if (error) return j(500, { success: false, error: 'Rate limit error' });
    const row = Array.isArray(data) ? data[0] : data;
    if (row && row.allowed === false) {
      const ra = Number(row.retry_after) || blk;
      return j(429, { success: false, code: 'RATE_LIMITED', retryAfter: ra, error: 'ส่งคำขอถี่เกินไป กรุณารอ ' + ra + ' วินาที' }, { 'Retry-After': String(ra) });
    }
    return null;
  };

  const readBody = async (): Promise<R> => {
    const t = await req.text();
    if (new TextEncoder().encode(t).length > 65536) throw Object.assign(new Error('ข้อมูลใหญ่เกินกำหนด'), { status: 413 });
    const d = JSON.parse(t || '{}');
    if (!d || Array.isArray(d) || typeof d !== 'object') throw new Error('JSON ไม่ถูกต้อง');
    return d as R;
  };

  try {
    if (route.endsWith('/health') && req.method === 'GET') return j(200, { ok: true, service: 'estra-supabase-social-gateway' });
    const ah = req.headers.get('authorization') || '', tok = ah.startsWith('Bearer ') ? ah.slice(7).trim() : '', rtok = req.headers.get('x-refresh-token')?.trim() || '';
    const auth = async () => {
      if (tok) {
        const { data, error } = await admin.auth.getUser(tok);
        if (!error && data?.user) return { u: data.user, ref: null };
      }
      if (rtok) {
        const { data, error } = await ac.auth.refreshSession({ refresh_token: rtok });
        if (!error && data?.session && data?.user) return { u: data.user, ref: data.session };
      }
      return { u: null, ref: null };
    };

    if (route === '/api/social/me' && req.method === 'GET') {
      const { u, ref } = await auth();
      if (!u) return j(200, { success: true, authenticated: false, mode: 'supabase', user: null, favoriteServers: [] });
      const { data: st } = await admin.rpc('launcher_social_gateway_rpc', { p_uid: u.id, p_action: 'state', p_payload: {} });
      const s = (st || {}) as R;
      return j(200, { success: true, authenticated: true, mode: 'supabase', user: s.user || null, favoriteServers: s.favoriteServers || [], ...(ref ? { token: ref.access_token, refreshToken: ref.refresh_token } : {}) });
    }

    if (route === '/api/social/register' && req.method === 'POST') {
      const blocked = await checkRl('register:ip:' + ip, 5, 600, 600);
      if (blocked) return blocked;
      const b = await readBody(), un = String(b.username || '').trim().toLowerCase(), dn = String(b.displayName || un).trim().slice(0, 32), pw = String(b.password || '');
      if (!/^[a-z0-9_.-]{3,24}$/.test(un)) return j(400, { success: false, error: 'ชื่อผู้ใช้ต้องเป็น a-z, 0-9, _, ., - ยาว 3-24 ตัว' });
      if (!dn) return j(400, { success: false, error: 'กรุณากรอก Display Name' });
      if (pw.length < 6 || pw.length > 128) return j(400, { success: false, error: 'รหัสผ่านต้องมี 6-128 ตัว' });
      const { data: ex } = await admin.from('launcher_profiles').select('id').eq('username', un).maybeSingle();
      if (ex) return j(409, { success: false, error: 'ชื่อผู้ใช้นี้มีคนใช้แล้ว' });
      const email = un + '@users.estralauncher.app';
      const { data: ca, error: ce } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true, app_metadata: { username: un } });
      if (ce || !ca?.user) return j(409, { success: false, error: ce?.message || 'สร้างบัญชีไม่สำเร็จ' });
      const uid = ca.user.id, ch = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let ok = false, sum = 0;
      for (let i = 0; i < un.length; i += 1) sum += un.charCodeAt(i);
      for (let i = 0; i < 6; i += 1) {
        const rb = new Uint8Array(4);
        crypto.getRandomValues(rb);
        const fc = 'ESTRA-' + Array.from(rb, x => ch[x % ch.length]).join('');
        const { error: pe } = await admin.from('launcher_profiles').insert({
          id: uid, auth_user_id: uid, username: un, display_name: dn, friend_code: fc,
          avatar_color: PAL[sum % PAL.length], status_pref: 'online', is_demo: false, last_seen_at: new Date().toISOString(),
        });
        if (!pe) { ok = true; break; }
        if (pe.code !== '23505') break;
      }
      if (!ok) { await admin.auth.admin.deleteUser(uid).catch(() => {}); return j(500, { success: false, error: 'บันทึกโปรไฟล์ไม่สำเร็จ' }); }
      const { data: si, error: se } = await ac.auth.signInWithPassword({ email, password: pw });
      if (se || !si?.session) return j(500, { success: false, error: 'เข้าสู่ระบบอัตโนมัติไม่สำเร็จ' });
      const { data: st } = await admin.rpc('launcher_social_gateway_rpc', { p_uid: uid, p_action: 'state', p_payload: {} });
      const s = (st || {}) as R;
      return j(200, { success: true, authenticated: true, mode: 'supabase', user: s.user || null, favoriteServers: s.favoriteServers || [], token: si.session.access_token, refreshToken: si.session.refresh_token });
    }

    if (route === '/api/social/login' && req.method === 'POST') {
      const b = await readBody(), un = String(b.username || '').trim().toLowerCase(), pw = String(b.password || '');
      if (!/^[a-z0-9_.-]{3,24}$/.test(un) || !pw) return j(400, { success: false, error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' });
      const b1 = await checkRl('login:ip:' + ip, 12, 300, 300);
      if (b1) return b1;
      const b2 = await checkRl('login:user:' + un, 6, 300, 300);
      if (b2) return b2;
      const { data: prof } = await admin.from('launcher_profiles').select('id, auth_user_id, is_demo').eq('username', un).maybeSingle();
      if (!prof || prof.is_demo || !prof.auth_user_id) return j(401, { success: false, error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
      const { data: au } = await admin.auth.admin.getUserById(prof.auth_user_id);
      const { data: si, error: se } = await ac.auth.signInWithPassword({ email: au?.user?.email || '', password: pw });
      if (se || !si?.session) return j(401, { success: false, error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
      await admin.from('launcher_profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', prof.id);
      const { data: st } = await admin.rpc('launcher_social_gateway_rpc', { p_uid: String(prof.id), p_action: 'state', p_payload: {} });
      const s = (st || {}) as R;
      return j(200, { success: true, authenticated: true, mode: 'supabase', user: s.user || null, favoriteServers: s.favoriteServers || [], token: si.session.access_token, refreshToken: si.session.refresh_token });
    }

    if (route === '/api/social/logout' && req.method === 'POST') {
      const { u } = await auth();
      if (u) {
        await admin.from('launcher_profiles').update({ last_seen_at: new Date(0).toISOString(), current_server_id: null, current_server_name: null, current_server_ip: null }).eq('id', u.id);
        await admin.auth.admin.signOut(tok).catch(() => {});
      }
      return j(200, { success: true, authenticated: false, mode: 'supabase', user: null });
    }

    const { u: au, ref } = await auth();
    if (!au) return j(401, { success: false, error: 'กรุณาเข้าสู่ระบบบัญชี Estra ก่อนใช้งาน' });
    const action = route.replace('/api/social/', '');
    const payload = req.method === 'GET' ? { q: uo.searchParams.get('q') || '' } : req.method === 'POST' ? await readBody() : null;
    if (!payload) return j(405, { success: false, error: 'Method not allowed' });

    const { data: out, error: rpcErr } = await admin.rpc('launcher_social_gateway_rpc', { p_uid: au.id, p_action: action, p_payload: payload });
    if (rpcErr) return j(500, { success: false, error: rpcErr.message });
    const res = (out || {}) as R;
    const errSt = Number(res.errorStatus || 0);
    if (errSt) {
      const ra = res.retryAfter ? { 'Retry-After': String(res.retryAfter) } : {};
      return j(errSt, { success: false, error: res.error || 'เกิดข้อผิดพลาด', ...(res.code ? { code: res.code } : {}), ...(res.retryAfter ? { retryAfter: res.retryAfter } : {}) }, ra);
    }
    return j(200, { ...res, ...(ref ? { token: ref.access_token, refreshToken: ref.refresh_token } : {}) });
  } catch (e: unknown) {
    const x = e as { status?: number; message?: string };
    return j(x?.status || 400, { success: false, error: x?.message || 'คำขอไม่ถูกต้อง' });
  }
});
