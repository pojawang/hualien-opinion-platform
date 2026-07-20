import { syncFacebookApifyRuns } from './_facebookApify.js';
import { isAdminRequest, json } from './_utils.js';

export async function handler(event) {
  try {
    if (!(await isAdminRequest(event))) return json(403, { error: '僅管理員可同步 Facebook 巡查結果' });
    if (!['GET', 'POST'].includes(event.httpMethod)) return json(405, { error: 'Method not allowed' });

    const result = await syncFacebookApifyRuns();
    return json(200, {
      ...result,
      message: result.pending > 0
        ? `Apify 巡查仍在執行，已匯入 ${result.upserted || 0} 則，尚有 ${result.pending} 個任務待完成。`
        : `Apify 巡查結果同步完成，新增或更新 ${result.upserted || 0} 則。`
    });
  } catch (error) {
    const status = error.message === '尚未登入' ? 401 : 500;
    return json(status, { error: error.message });
  }
}
