import { guard, json, supabaseAdmin } from './_utils.js';

function countBy(items, key, fallback = '其他') {
  const map = new Map();
  for (const item of items) {
    const name = item[key] || fallback;
    map.set(name, (map.get(name) || 0) + 1);
  }
  return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
}

function todayStartIso() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.toISOString();
}

export async function handler(event) {
  try {
    guard(event);
    const supabase = supabaseAdmin();
    const params = event.queryStringParameters || {};
    const today = todayStartIso();

    const { data: allArticles, error } = await supabase
      .from('articles')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) throw error;

    const articles = allArticles || [];
    const todayArticles = articles.filter((item) => item.created_at >= today);

    if (params.report === 'daily') {
      const topCategories = countBy(todayArticles, 'category')
        .sort((a, b) => b.value - a.value)
        .slice(0, 5);

      return json(200, {
        topCategories,
        headlines: todayArticles.filter((item) => ['urgent', 'high'].includes(item.importance)).slice(0, 10),
        negative: todayArticles.filter((item) => item.sentiment === 'negative').slice(0, 10),
        tourism: todayArticles.filter((item) => item.category === '觀光').slice(0, 10),
        food: todayArticles.filter((item) => item.category === '美食').slice(0, 10),
        events: todayArticles.filter((item) => item.category === '活動').slice(0, 10)
      });
    }

    return json(200, {
      todayCount: todayArticles.length,
      pendingCount: articles.filter((item) => item.status === 'pending').length,
      approvedCount: articles.filter((item) => item.status === 'approved').length,
      rejectedCount: articles.filter((item) => item.status === 'rejected').length,
      broadcastedCount: articles.filter((item) => item.is_broadcasted).length,
      categoryCounts: countBy(articles, 'category'),
      sentimentCounts: countBy(articles, 'sentiment', 'neutral'),
      latestArticles: articles.slice(0, 10)
    });
  } catch (err) {
    const status = err.message === '尚未登入' ? 401 : 500;
    return json(status, { error: err.message });
  }
}
