import { guard, json, supabaseAdmin } from './_utils.js';

function countBy(items, key, fallback = '其他') {
  const map = new Map();
  for (const item of items) {
    const name = item[key] || fallback;
    map.set(name, (map.get(name) || 0) + 1);
  }
  return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
}

function dateKey(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(value));
}

function articleText(article) {
  return `${article.title || ''} ${article.snippet || ''} ${article.summary || ''} ${article.source || ''}`.toLowerCase();
}

function matchesKeyword(article, keyword) {
  const text = articleText(article);
  const normalizedKeyword = keyword.toLowerCase().replace(/\s+/g, '');
  if (text.replace(/\s+/g, '').includes(normalizedKeyword)) return true;

  if (normalizedKeyword.startsWith('花蓮') && normalizedKeyword.length > 2) {
    return text.includes('花蓮') && text.includes(normalizedKeyword.slice(2));
  }

  return false;
}

function buildVolumeTrend(articles) {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(Date.now() - (6 - index) * 86400000);
    const key = dateKey(date);
    return { key, name: key.slice(5).replace('-', '/'), value: 0 };
  });
  const dayMap = new Map(days.map((day) => [day.key, day]));

  for (const article of articles) {
    const day = dayMap.get(dateKey(article.created_at));
    if (day) day.value += 1;
  }

  return days.map(({ name, value }) => ({ name, value }));
}

function buildDailySummary(todayArticles, keyword, popularKeywords) {
  const subject = keyword ? `「${keyword}」` : '整體花蓮輿情';
  if (todayArticles.length === 0) {
    return `今日尚未蒐集到${subject}的相關文章，建議稍後再次執行搜尋。`;
  }

  const topCategory = countBy(todayArticles, 'category').sort((a, b) => b.value - a.value)[0];
  const negativeCount = todayArticles.filter((item) => item.sentiment === 'negative').length;
  const focus = popularKeywords[0]?.name;
  const warning = negativeCount > 0
    ? `其中有 ${negativeCount} 則負面訊息，建議優先查看負評預警。`
    : '目前未發現負面訊息。';
  const focusText = focus ? `熱門焦點為「${focus}」。` : '';

  return `今日共蒐集 ${todayArticles.length} 則${subject}相關文章，主要集中於「${topCategory?.name || '其他'}」分類。${focusText}${warning}`;
}

export async function handler(event) {
  try {
    guard(event);
    const supabase = supabaseAdmin();
    const params = event.queryStringParameters || {};
    const selectedKeyword = (params.keyword || '').trim();
    const today = dateKey();

    const [articleResult, keywordResult] = await Promise.all([
      supabase.from('articles').select('*').order('created_at', { ascending: false }).limit(500),
      supabase.from('keywords').select('keyword').eq('enabled', true).order('keyword')
    ]);
    if (articleResult.error) throw articleResult.error;
    if (keywordResult.error) throw keywordResult.error;

    const keywords = (keywordResult.data || []).map((item) => item.keyword);
    const allArticles = articleResult.data || [];
    const articles = selectedKeyword
      ? allArticles.filter((item) => matchesKeyword(item, selectedKeyword))
      : allArticles;
    const todayArticles = articles.filter((item) => dateKey(item.created_at) === today);

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

    const popularKeywords = keywords
      .map((keyword) => ({
        name: keyword,
        value: articles.filter((article) => matchesKeyword(article, keyword)).length
      }))
      .filter((item) => item.value > 0)
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, 'zh-Hant'))
      .slice(0, 10);

    const importanceOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
    const negativeAlerts = articles
      .filter((item) => item.sentiment === 'negative')
      .sort((a, b) => (importanceOrder[a.importance] ?? 9) - (importanceOrder[b.importance] ?? 9))
      .slice(0, 5);

    return json(200, {
      keywords,
      selectedKeyword,
      todayCount: todayArticles.length,
      pendingCount: articles.filter((item) => item.status === 'pending').length,
      approvedCount: articles.filter((item) => item.status === 'approved').length,
      rejectedCount: articles.filter((item) => item.status === 'rejected').length,
      broadcastedCount: articles.filter((item) => item.is_broadcasted).length,
      categoryCounts: countBy(articles, 'category'),
      sourceCounts: countBy(articles, 'platform', 'website')
        .sort((a, b) => b.value - a.value),
      sentimentCounts: countBy(articles, 'sentiment', 'neutral'),
      volumeTrend: buildVolumeTrend(articles),
      popularKeywords,
      negativeAlerts,
      dailySummary: buildDailySummary(todayArticles, selectedKeyword, popularKeywords),
      latestArticles: articles.slice(0, 10)
    });
  } catch (err) {
    const status = err.message === '尚未登入' ? 401 : 500;
    return json(status, { error: err.message });
  }
}
