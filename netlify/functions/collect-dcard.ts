import { collectDcardPosts } from '../../src/lib/collectors/dcard.ts';
import { isAdminRequest, json, supabaseAdmin } from './_utils.js';

export async function handler(event: any) {
  try {
    const isScheduled = event.httpMethod === undefined || event.headers?.['x-netlify-scheduled'] === 'true';
    if (!isScheduled) {
      if (!(await isAdminRequest(event))) return json(403, { error: '僅管理員可執行 Dcard 蒐集' });
    }
    if (!isScheduled && event.httpMethod !== 'POST') {
      return json(405, { error: 'Method not allowed' });
    }

    const result = await collectDcardPosts({
      supabase: supabaseAdmin(),
      serperApiKey: process.env.SERPER_API_KEY,
      timeoutMs: Number(process.env.DCARD_REQUEST_TIMEOUT_MS) || 6000,
      delayMs: Number(process.env.DCARD_RATE_LIMIT_MS) || 1500
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
