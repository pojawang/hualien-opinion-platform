import { guard, isAdminRequest, json, parseBody, supabaseAdmin } from './_utils.js';

export async function handler(event) {
  try {
    guard(event);
    if (event.httpMethod !== 'GET' && !(await isAdminRequest(event))) {
      return json(403, { error: '一般使用者僅能查看文章' });
    }
    const supabase = supabaseAdmin();

    if (event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {};
      let query = supabase
        .from('articles')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (params.status) query = query.eq('status', params.status);
      if (params.category) query = query.eq('category', params.category);
      if (params.source) query = query.ilike('source', `%${params.source}%`);
      if (params.q) query = query.ilike('title', `%${params.q}%`);

      const { data, error } = await query;
      if (error) throw error;
      return json(200, { articles: data || [] });
    }

    if (event.httpMethod === 'PATCH') {
      const body = parseBody(event);
      const { id, status, importance, sentiment } = body;
      if (!id) return json(400, { error: '缺少文章 id' });

      const patch = {};
      if (status) patch.status = status;
      if (importance) patch.importance = importance;
      if (sentiment) patch.sentiment = sentiment;

      const { data, error } = await supabase
        .from('articles')
        .update(patch)
        .eq('id', id)
        .select('*')
        .single();

      if (error) throw error;
      return json(200, { article: data });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    const status = err.message === '尚未登入' ? 401 : 500;
    return json(status, { error: err.message });
  }
}
