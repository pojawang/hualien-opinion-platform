import { handler as collectDcard } from './collect-dcard.ts';
import { handler as collectPtt } from './collect-ptt.ts';
import { handler as runSearch } from './search.js';
import { handler as syncFacebook } from './sync-facebook-apify-runs.js';
import { handler as triggerFacebook } from './trigger-facebook-collector.js';

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function scheduledEvent(scheduledBody = undefined) {
  return {
    headers: { 'x-netlify-scheduled': 'true' },
    ...(scheduledBody ? { scheduledBody } : {})
  };
}

function responsePayload(response) {
  try {
    return JSON.parse(response?.body || '{}');
  } catch {
    return {};
  }
}

async function runSearchBatch(mode, offset = 0) {
  const response = await runSearch(scheduledEvent({ mode, offset, limit: 3 }));
  const payload = responsePayload(response);
  if (Number(response?.statusCode || 500) >= 400) {
    throw new Error(payload.error || `${mode} 搜尋蒐集失敗`);
  }
  return payload;
}

async function collectSearchData() {
  const totals = { inserted: 0, duplicates: 0, candidates: 0, errors: [] };

  for (const mode of ['web', 'videos']) {
    let offset = 0;
    while (true) {
      const result = await runSearchBatch(mode, offset);
      totals.inserted += result.inserted || 0;
      totals.duplicates += result.duplicates || 0;
      totals.candidates += result.total || 0;
      totals.errors.push(...(result.errors || []));
      if (!result.hasMore || result.serperBlocked || !result.processedKeywords) break;
      offset += result.processedKeywords;
    }
  }

  const sources = await runSearchBatch('sources');
  totals.inserted += sources.inserted || 0;
  totals.duplicates += sources.duplicates || 0;
  totals.candidates += sources.total || 0;
  totals.errors.push(...(sources.errors || []));

  const [dcard, ptt] = await Promise.allSettled([
    collectDcard(scheduledEvent()),
    collectPtt(scheduledEvent())
  ]);
  if (dcard.status === 'rejected') totals.errors.push({ source: 'Dcard', message: dcard.reason?.message || '蒐集失敗' });
  if (ptt.status === 'rejected') totals.errors.push({ source: 'PTT', message: ptt.reason?.message || '蒐集失敗' });

  console.log('每日搜尋蒐集完成', JSON.stringify(totals));
  return totals;
}

async function collectFacebookData() {
  const triggerResponse = await triggerFacebook(scheduledEvent());
  const triggerResult = responsePayload(triggerResponse);
  if (Number(triggerResponse?.statusCode || 500) >= 400) {
    throw new Error(triggerResult.error || 'Facebook 監測啟動失敗');
  }
  console.log('每日 Facebook 監測已啟動', JSON.stringify(triggerResult));

  if (triggerResult.provider !== 'apify' || !triggerResult.started) return triggerResult;

  let syncResult = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await sleep(30000);
    const syncResponse = await syncFacebook(scheduledEvent());
    syncResult = responsePayload(syncResponse);
    if (Number(syncResponse?.statusCode || 500) >= 400) {
      throw new Error(syncResult.error || 'Facebook Apify 結果同步失敗');
    }
    console.log(`Facebook Apify 第 ${attempt + 1} 次同步`, JSON.stringify(syncResult));
    if (!syncResult.pending) break;
  }

  return { ...triggerResult, sync: syncResult };
}

export async function handler(event) {
  const expectedKey = process.env.SUPABASE_SERVICE_KEY;
  const suppliedKey = event.headers?.['x-internal-schedule-key'] || event.headers?.['X-Internal-Schedule-Key'];
  if (!expectedKey || suppliedKey !== expectedKey) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  const results = await Promise.allSettled([collectSearchData(), collectFacebookData()]);
  const failures = results
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason?.message || String(result.reason));

  if (failures.length > 0) console.error('每日自動蒐集部分失敗', JSON.stringify(failures));
  else console.log('每日自動蒐集全部完成');

  return {
    statusCode: failures.length > 0 ? 500 : 200,
    body: JSON.stringify({ ok: failures.length === 0, failures })
  };
}
