import { guard, isAdminRequest, json, parseBody, supabaseAdmin, upsertDefaultsIfEmpty } from './_utils.js';

export async function handler(event) {
  try {
    guard(event);
    if (event.httpMethod !== 'GET' && !(await isAdminRequest(event))) {
      return json(403, { error: '一般使用者僅能查看關鍵字' });
    }
    const supabase = supabaseAdmin();
    await upsertDefaultsIfEmpty(supabase);

    if (event.httpMethod === 'GET') {
      const { data, error } = await supabase
        .from('keywords')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return json(200, { keywords: data || [] });
    }

    if (event.httpMethod === 'POST') {
      const { keyword, category } = parseBody(event);
      if (!keyword) return json(400, { error: '請輸入關鍵字' });
      const { data, error } = await supabase
        .from('keywords')
        .insert({ keyword, category: category || '其他', enabled: true })
        .select('*')
        .single();
      if (error) throw error;
      return json(201, { keyword: data });
    }

    if (event.httpMethod === 'PATCH') {
      const { id, ...patch } = parseBody(event);
      if (!id) return json(400, { error: '缺少關鍵字 id' });
      const { data, error } = await supabase
        .from('keywords')
        .update(patch)
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw error;
      return json(200, { keyword: data });
    }

    if (event.httpMethod === 'DELETE') {
      const { id } = parseBody(event);
      if (!id) return json(400, { error: '缺少關鍵字 id' });
      const { error } = await supabase.from('keywords').delete().eq('id', id);
      if (error) throw error;
      return json(200, { ok: true });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    const status = err.message === '尚未登入' ? 401 : 500;
    return json(status, { error: err.message });
  }
}
