import { guard, isAdminRequest, json, parseBody, supabaseAdmin } from './_utils.js';
import { preferredFacebookName } from './_facebookApify.js';

function normalizeFacebookUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    const hostname = url.hostname.replace(/^www\./, '').toLowerCase();
    if (!['facebook.com', 'm.facebook.com'].includes(hostname)) return '';
    url.protocol = 'https:';
    url.hostname = 'www.facebook.com';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function sourceKind(url) {
  return /facebook\.com\/groups\//i.test(url) ? 'public_group' : 'page';
}

function initialName(url) {
  const preferred = preferredFacebookName(url);
  if (preferred) return preferred;
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts[0] === 'groups') return parts[1] || parsed.searchParams.get('id') || 'Facebook 公開社團';
    return parsed.searchParams.get('id') || parts[0] || 'Facebook 粉專';
  } catch {
    return 'Facebook 來源';
  }
}

export async function handler(event) {
  try {
    guard(event);
    if (event.httpMethod !== 'GET' && !(await isAdminRequest(event))) {
      return json(403, { error: '一般使用者僅能查看 Facebook 監測來源' });
    }
    const supabase = supabaseAdmin();

    if (event.httpMethod === 'GET') {
      const { data, error } = await supabase.from('facebook_pages').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return json(200, { pages: data || [] });
    }

    if (event.httpMethod === 'POST') {
      const body = parseBody(event);
      const pageUrl = normalizeFacebookUrl(body.page_url);
      if (!pageUrl) return json(400, { error: '請輸入有效的 Facebook 粉專或公開社團網址' });
      const kind = body.source_kind === 'public_group' || sourceKind(pageUrl) === 'public_group' ? 'public_group' : 'page';
      const { data, error } = await supabase.from('facebook_pages').insert({
        page_name: initialName(pageUrl),
        page_url: pageUrl,
        source_kind: kind,
        category: '其他',
        enabled: true,
        collector: 'apify'
      }).select('*').single();
      if (error) throw error;
      return json(201, { page: data });
    }

    if (event.httpMethod === 'PATCH') {
      const body = parseBody(event);
      if (!body.id) return json(400, { error: '缺少 id' });
      const patch = {};
      if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
      if (typeof body.category === 'string') patch.category = body.category.trim() || '其他';
      if (typeof body.page_name === 'string') patch.page_name = body.page_name.trim();
      if (['page', 'public_group'].includes(body.source_kind)) patch.source_kind = body.source_kind;
      const { data, error } = await supabase.from('facebook_pages').update(patch).eq('id', body.id).select('*').single();
      if (error) throw error;
      return json(200, { page: data });
    }

    if (event.httpMethod === 'DELETE') {
      const { id } = parseBody(event);
      if (!id) return json(400, { error: '缺少 id' });
      const { error } = await supabase.from('facebook_pages').delete().eq('id', id);
      if (error) throw error;
      return json(200, { ok: true });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (error) {
    const status = error.message === '尚未登入' ? 401 : 500;
    return json(status, { error: error.message });
  }
}
