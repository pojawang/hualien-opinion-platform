const FALLBACK_SITE_URL = 'https://hualien-opinion-platform.netlify.app';

export async function handler() {
  const baseUrl = String(process.env.URL || process.env.DEPLOY_PRIME_URL || FALLBACK_SITE_URL).replace(/\/$/, '');
  const internalKey = process.env.SUPABASE_SERVICE_KEY;
  if (!internalKey) throw new Error('SUPABASE_SERVICE_KEY 尚未設定，無法啟動每日背景蒐集');

  const response = await fetch(`${baseUrl}/.netlify/functions/daily-collection-background`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Schedule-Key': internalKey
    },
    body: JSON.stringify({ triggeredAt: new Date().toISOString() })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`每日背景蒐集啟動失敗：${response.status}${detail ? ` ${detail.slice(0, 180)}` : ''}`);
  }

  console.log('每日 08:00 搜尋蒐集與 Facebook 監測背景工作已啟動');
  return { statusCode: 202 };
}
