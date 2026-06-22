import { collectFacebookPages } from '../../src/lib/collectors/facebook.ts';
import { guard, json, supabaseAdmin } from './_utils.js';

export async function handler(event: any) {
  try {
    const isScheduled = event.httpMethod === undefined || event.headers?.['x-netlify-scheduled'] === 'true';
    if (!isScheduled) guard(event);
    if (!isScheduled && event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

    const supabase = supabaseAdmin();
    const { data: pages, error } = await supabase.from('facebook_pages').select('*').eq('enabled', true);
    if (error) throw error;
    const result = await collectFacebookPages({
      supabase,
      pages: pages || [],
      accessToken: process.env.FACEBOOK_PAGE_ACCESS_TOKEN || '',
      apiVersion: process.env.FACEBOOK_GRAPH_API_VERSION || 'v23.0',
      timeoutMs: Number(process.env.FACEBOOK_REQUEST_TIMEOUT_MS) || 8000
    });
    return json(200, { ok: true, ...result });
  } catch (error: any) {
    const status = error.message === '尚未登入' ? 401 : 500;
    return json(status, { error: error.message });
  }
}

export const config = { schedule: '@daily' };
