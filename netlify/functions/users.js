import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { guard, json, parseBody, supabaseAdmin } from './_utils.js';

const roles = new Set(['admin', 'user']);

function validateUsername(value) {
  const username = String(value || '').trim();
  if (!/^[A-Za-z0-9._-]{3,50}$/.test(username)) {
    throw new Error('帳號需為 3 至 50 個英文字母、數字、句點、底線或連字號');
  }
  return username;
}

function validatePassword(value, required = false) {
  const password = String(value || '');
  if (!password && !required) return '';
  if (password.length < 8) throw new Error('密碼至少需要 8 個字元');
  return password;
}

async function ensureAnotherAdmin(supabase, userId) {
  const { count, error } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'admin')
    .eq('enabled', true)
    .neq('id', userId);
  if (error) throw error;
  if (!count) throw new Error('系統至少需要保留一位啟用中的管理員');
}

export async function handler(event) {
  try {
    const actor = guard(event);
    const supabase = supabaseAdmin();
    const { data: actorUser, error: actorError } = await supabase
      .from('users').select('id, role, enabled').eq('id', actor.sub).single();
    if (actorError || !actorUser?.enabled || actorUser.role !== 'admin') {
      return json(403, { error: '僅啟用中的管理員可管理帳號' });
    }

    if (event.httpMethod === 'GET') {
      const { data, error } = await supabase
        .from('users')
        .select('id, username, role, enabled, created_at')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return json(200, { users: data || [], currentUserId: actor.sub });
    }

    if (event.httpMethod === 'POST') {
      const body = parseBody(event);
      const username = validateUsername(body.username);
      const password = validatePassword(body.password, true);
      const role = roles.has(body.role) ? body.role : 'user';
      const { data, error } = await supabase.from('users').insert({
        id: crypto.randomUUID(),
        username,
        password_hash: await bcrypt.hash(password, 10),
        role,
        enabled: true
      }).select('id, username, role, enabled, created_at').single();
      if (error) throw error;
      return json(201, { user: data });
    }

    if (event.httpMethod === 'PATCH') {
      const body = parseBody(event);
      if (!body.id) return json(400, { error: '缺少使用者 id' });
      const { data: existing, error: existingError } = await supabase
        .from('users').select('id, role, enabled').eq('id', body.id).single();
      if (existingError || !existing) return json(404, { error: '找不到使用者' });

      const patch = {};
      if (body.username !== undefined) patch.username = validateUsername(body.username);
      if (body.role !== undefined) {
        if (!roles.has(body.role)) return json(400, { error: '角色不正確' });
        patch.role = body.role;
      }
      if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
      const password = validatePassword(body.password);
      if (password) patch.password_hash = await bcrypt.hash(password, 10);

      if (String(body.id) === String(actor.sub) && (patch.role === 'user' || patch.enabled === false)) {
        return json(400, { error: '不可取消自己的管理員權限或停用自己的帳號' });
      }
      if (existing.role === 'admin' && existing.enabled && (patch.role === 'user' || patch.enabled === false)) {
        await ensureAnotherAdmin(supabase, body.id);
      }

      const { data, error } = await supabase.from('users').update(patch).eq('id', body.id)
        .select('id, username, role, enabled, created_at').single();
      if (error) throw error;
      return json(200, { user: data });
    }

    if (event.httpMethod === 'DELETE') {
      const { id } = parseBody(event);
      if (!id) return json(400, { error: '缺少使用者 id' });
      if (String(id) === String(actor.sub)) return json(400, { error: '不可刪除自己的帳號' });
      const { data: existing, error: existingError } = await supabase
        .from('users').select('id, role, enabled').eq('id', id).single();
      if (existingError || !existing) return json(404, { error: '找不到使用者' });
      if (existing.role === 'admin' && existing.enabled) await ensureAnotherAdmin(supabase, id);
      const { error } = await supabase.from('users').delete().eq('id', id);
      if (error) throw error;
      return json(200, { ok: true });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (error) {
    const status = error.message === '尚未登入' ? 401 : 400;
    const duplicate = error.code === '23505';
    return json(duplicate ? 409 : status, { error: duplicate ? '帳號已存在' : error.message });
  }
}
