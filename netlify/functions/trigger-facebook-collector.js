import { guard, json } from './_utils.js';

export async function handler(event) {
  try {
    guard(event);
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

    const token = process.env.GITHUB_ACTIONS_TOKEN;
    const repository = process.env.GITHUB_REPOSITORY || 'pojawang/hualien-opinion-platform';
    if (!token) return json(500, { error: 'GITHUB_ACTIONS_TOKEN 尚未設定' });
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) return json(500, { error: 'GITHUB_REPOSITORY 格式不正確' });

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
      throw new Error(payload.message || `GitHub Actions 啟動失敗（${response.status}）`);
    }

    return json(202, { ok: true, message: 'Facebook 巡查已啟動，約需 1 至 3 分鐘完成。' });
  } catch (error) {
    const status = error.message === '尚未登入' ? 401 : 500;
    return json(status, { error: error.message });
  }
}
