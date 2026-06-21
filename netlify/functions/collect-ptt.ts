import { collectPttPosts } from '../../src/lib/collectors/ptt.ts';
import { guard, json, supabaseAdmin } from './_utils.js';

export async function handler(event: any) {
  try {
    const isScheduled = event.httpMethod === undefined || event.headers?.['x-netlify-scheduled'] === 'true';
    if (!isScheduled) guard(event);
    if (!isScheduled && event.httpMethod !== 'POST') {
      return json(405, { error: 'Method not allowed' });
    }

    const supabase = supabaseAdmin();
    const [sourceResult, keywordResult] = await Promise.all([
      supabase.from('sources').select('id', { count: 'exact', head: true }).eq('source_type', 'ptt').eq('enabled', true),
      supabase.from('keywords').select('keyword').eq('enabled', true)
    ]);
    if (sourceResult.error) throw sourceResult.error;
    if (keywordResult.error) throw keywordResult.error;
    if (!sourceResult.count) {
      return json(200, { ok: true, skipped: true, message: '尚未啟用 PTT 來源' });
    }

    const result = await collectPttPosts({
      supabase,
      keywords: (keywordResult.data || []).map((item: any) => item.keyword),
      timeoutMs: Number(process.env.PTT_REQUEST_TIMEOUT_MS) || 6000,
      delayMs: Number(process.env.PTT_RATE_LIMIT_MS) || 1500
    });

    return json(200, { ok: true, ...result });
  } catch (error: any) {
    const status = error.message === '尚未登入' ? 401 : 500;
    return json(status, { error: error.message });
  }
}

export const config = {
  schedule: '@daily'
};
