import { apifyConfigured, startFacebookApifyRuns } from './_facebookApify.js';
import { isAdminRequest, json } from './_utils.js';

async function triggerPlaywrightFallback() {
  const token = process.env.GITHUB_ACTIONS_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY || 'pojawang/hualien-opinion-platform';
  if (!token) throw new Error('GITHUB_ACTIONS_TOKEN 尚未設定，無法啟動 Playwright 備援');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('GITHUB_REPOSITORY 格式不正確');

  const response = await fetch(
    `https://api.github.com/repos/${repository}/actions/workflows/collect-facebook-playwright.yml/dispatches`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Hualien-Opinion-Platform',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: JSON.stringify({ ref: 'main' })
    }
  );

  if (response.status !== 204) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || `GitHub Actions 啟動失敗：${response.status}`);
  }

  return {
    ok: true,
    provider: 'playwright',
    message: 'Apify 尚未完整設定，已改用 Playwright 備援巡查，約需 1 至 3 分鐘完成。'
  };
}

export async function handler(event) {
  try {
    if (!(await isAdminRequest(event))) return json(403, { error: '僅管理員可啟動 Facebook 巡查' });
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

    if (apifyConfigured()) {
      const result = await startFacebookApifyRuns();
      if (result.started > 0) {
        return json(202, {
          ...result,
          message: `Apify Facebook 巡查已啟動 ${result.started} 個任務，系統會自動檢查並匯入結果。`
        });
      }
      const fallback = await triggerPlaywrightFallback();
      return json(202, {
        ...result,
        fallback,
        message: fallback.message
      });
    }

    const fallback = await triggerPlaywrightFallback();
    return json(202, fallback);
  } catch (error) {
    const status = error.message === '尚未登入' ? 401 : 500;
    return json(status, { error: error.message });
  }
}
