import { guard, json, parseBody, parseXmlFeed, supabaseAdmin } from './_utils.js';

export async function handler(event) {
  try {
    guard(event);
    const supabase = supabaseAdmin();

    if (event.httpMethod === 'GET') {
      const { data, error } = await supabase
        .from('sources')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return json(200, { sources: data || [] });
    }

    if (event.httpMethod === 'POST') {
      const body = parseBody(event);
      if (!body.name || !body.url) return json(400, { error: '請輸入來源名稱與 URL' });
      const { data, error } = await supabase
        .from('sources')
        .insert({
          name: body.name,
          source_type: body.source_type || 'rss',
          url: body.url,
          platform: body.platform || 'web',
          enabled: true
        })
        .select('*')
        .single();
      if (error) throw error;
      return json(201, { source: data });
    }

    if (event.httpMethod === 'PATCH') {
      const { id, ...patch } = parseBody(event);
      if (!id) return json(400, { error: '缺少來源 id' });
      const { data, error } = await supabase
        .from('sources')
        .update(patch)
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw error;
      return json(200, { source: data });
    }

    if (event.httpMethod === 'PUT') {
      const { url, source_type } = parseBody(event);
      const items = await parseXmlFeed(url, source_type);
      return json(200, { ok: true, count: items.length, sample: items.slice(0, 5) });
    }

    if (event.httpMethod === 'DELETE') {
      const { id } = parseBody(event);
      if (!id) return json(400, { error: '缺少來源 id' });
      const { error } = await supabase.from('sources').delete().eq('id', id);
      if (error) throw error;
      return json(200, { ok: true });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    const status = err.message === '尚未登入' ? 401 : 500;
    return json(status, { error: err.message });
  }
}
