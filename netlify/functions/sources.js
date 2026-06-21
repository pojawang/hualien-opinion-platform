import {
  fetchMeta,
  guard,
  json,
  normalizeSourceType,
  parseBody,
  parseXmlFeed,
  supabaseAdmin
} from './_utils.js';

function validPublicUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
}

async function testSource(body) {
  let sourceType;
  try {
    sourceType = normalizeSourceType(body.source_type);
  } catch (err) {
    return { status: 400, body: { error: err.message } };
  }
  if (!validPublicUrl(body.url)) {
    return { status: 400, body: { error: '請輸入有效的公開 HTTP/HTTPS URL' } };
  }

  if (['rss', 'sitemap'].includes(sourceType)) {
    const items = await parseXmlFeed(body.url, sourceType);
    return {
      status: 200,
      body: { ok: true, count: items.length, sample: items.slice(0, 5), message: `找到 ${items.length} 筆項目` }
    };
  }

  if (sourceType === 'website') {
    const meta = await fetchMeta(body.url);
    if (!meta) return { status: 400, body: { error: '網站目前無法讀取' } };
    return {
      status: 200,
      body: { ok: true, count: 1, sample: [meta], message: '網站可讀取，已取得公開標題與摘要' }
    };
  }

  if (sourceType === 'facebook_page' && process.env.FACEBOOK_PAGE_ACCESS_TOKEN) {
    return {
      status: 200,
      body: { ok: true, count: 0, sample: [], message: 'Facebook Graph API 設定完成' }
    };
  }

  if (sourceType === 'dcard') {
    return {
      status: 200,
      body: { ok: true, count: 0, sample: [], message: 'Dcard 公開搜尋 API 已啟用，Serper 作為備援' }
    };
  }

  if (sourceType === 'ptt') {
    return {
      status: 200,
      body: { ok: true, count: 0, sample: [], message: 'PTT 公開看板蒐集已啟用' }
    };
  }

  if (!process.env.SERPER_API_KEY) {
    const message = sourceType === 'facebook_page'
      ? 'FACEBOOK_PAGE_ACCESS_TOKEN 或 SERPER_API_KEY 尚未設定'
      : 'SERPER_API_KEY 尚未設定';
    return { status: 400, body: { error: message } };
  }

  return {
    status: 200,
    body: {
      ok: true,
      count: 0,
      sample: [],
      message: sourceType === 'youtube' ? 'Serper Videos 設定完成' : 'Serper 公開搜尋設定完成'
    }
  };
}

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
      return json(200, {
        sources: (data || []).map((source) => ({
          ...source,
          source_type: String(source.source_type).toLowerCase()
        }))
      });
    }

    if (event.httpMethod === 'POST') {
      const body = parseBody(event);
      if (!body.name || !body.url) return json(400, { error: '請輸入來源名稱與 URL' });
      if (!validPublicUrl(body.url)) return json(400, { error: '請輸入有效的公開 HTTP/HTTPS URL' });
      let sourceType;
      try {
        sourceType = normalizeSourceType(body.source_type);
      } catch (err) {
        return json(400, { error: err.message });
      }
      const { data, error } = await supabase
        .from('sources')
        .insert({
          name: String(body.name).trim(),
          source_type: sourceType,
          url: String(body.url).trim(),
          platform: sourceType,
          enabled: true
        })
        .select('*')
        .single();
      if (error) throw error;
      return json(201, { source: data });
    }

    if (event.httpMethod === 'PATCH') {
      const body = parseBody(event);
      const { id } = body;
      if (!id) return json(400, { error: '缺少來源 id' });
      const patch = {};
      if (typeof body.name === 'string') patch.name = body.name.trim();
      if (typeof body.url === 'string') {
        if (!validPublicUrl(body.url)) return json(400, { error: '請輸入有效的公開 HTTP/HTTPS URL' });
        patch.url = body.url.trim();
      }
      if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
      if (body.source_type) {
        try {
          patch.source_type = normalizeSourceType(body.source_type);
          patch.platform = patch.source_type;
        } catch (err) {
          return json(400, { error: err.message });
        }
      }
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
      const result = await testSource(parseBody(event));
      return json(result.status, result.body);
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
