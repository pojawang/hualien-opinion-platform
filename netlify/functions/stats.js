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

function publishedTimestamp(value, now = new Date()) {
  const text = String(value || '').trim();
  if (!text) return null;

  const relativeMatch = text.match(/(\d+)\s*(分鐘|小時|天|日|週|周|個月|月|年|minutes?|hours?|days?|weeks?|months?|years?)\s*(?:前|ago)/i);
  if (relativeMatch) {
    const amount = Number(relativeMatch[1]);
    const unit = relativeMatch[2].toLowerCase();
    const date = new Date(now);
    if (['個月', '月', 'month', 'months'].includes(unit)) date.setMonth(date.getMonth() - amount);
    else if (['年', 'year', 'years'].includes(unit)) date.setFullYear(date.getFullYear() - amount);
    else {
      const unitMilliseconds = ['週', '周', 'week', 'weeks'].includes(unit)
        ? 7 * 86400000
        : ['天', '日', 'day', 'days'].includes(unit)
          ? 86400000
          : ['小時', 'hour', 'hours'].includes(unit)
            ? 3600000
            : 60000;
      date.setTime(date.getTime() - amount * unitMilliseconds);
    }
    return date.getTime();
  }

  const normalized = text
    .replace(/年/g, '-')
    .replace(/月/g, '-')
    .replace(/日/g, '')
    .replace(/\//g, '-');
  const timestamp = Date.parse(normalized);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function articleText(article) {
  return `${article.title || ''} ${article.content || ''} ${article.snippet || ''} ${article.summary || ''} ${article.source || ''}`.toLowerCase();
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

function buildYouTubeStats(articles) {
  const videos = articles.filter((item) => item.platform === 'youtube');
  const channelMap = new Map();

  for (const video of videos) {
    const name = video.channel_name || '未知頻道';
    const current = channelMap.get(name) || { name, value: 0, viewCount: 0 };
    current.value += 1;
    current.viewCount += Number(video.view_count) || 0;
    channelMap.set(name, current);
  }

  return {
    count: videos.length,
    channels: Array.from(channelMap.values())
      .sort((a, b) => b.value - a.value || b.viewCount - a.viewCount)
      .slice(0, 10),
    topVideos: videos
      .slice()
      .sort((a, b) => (Number(b.view_count) || 0) - (Number(a.view_count) || 0))
      .slice(0, 10)
  };
}

function buildDcardStats(posts, keywords) {
  const discussionKeywords = keywords
    .map((keyword) => ({
      name: keyword,
      value: posts.filter((post) => matchesKeyword(post, keyword)).length
    }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, 'zh-Hant'))
    .slice(0, 10);

  return {
    count: posts.length,
    topPosts: posts
      .slice()
      .sort((a, b) => {
        const engagementA = (Number(a.like_count) || 0) + (Number(a.comment_count) || 0);
        const engagementB = (Number(b.like_count) || 0) + (Number(b.comment_count) || 0);
        return engagementB - engagementA;
      })
      .slice(0, 10),
    discussionKeywords
  };
}

function buildGoogleReviewStats(articles) {
  const positiveWords = ['推薦', '好吃', '好玩', '乾淨', '親切', '舒適', '漂亮', '值得', '方便', '滿意'];
  const negativeWords = ['失望', '很差', '糟', '爛', '髒', '貴', '難吃', '態度差', '不推薦', '踩雷', '問題'];
  const places = articles
    .filter((item) => item.platform === 'google_reviews' && Number(item.rating) > 0)
    .map((item) => {
      const text = String(item.review_text || item.snippet || '');
      const positiveCount = positiveWords.filter((word) => text.includes(word)).length;
      const negativeCount = negativeWords.filter((word) => text.includes(word)).length;
      const signalTotal = positiveCount + negativeCount;
      const contentSignal = signalTotal > 0 ? (positiveCount - negativeCount) / signalTotal : 0;
      const rating = Number(item.rating);
      const reviewCount = Math.max(0, Number(item.review_count) || 0);
      const weightedRating = (rating * reviewCount + 4 * 20) / (reviewCount + 20);
      const reputationScore = Math.max(0, Math.min(5, weightedRating + contentSignal * 0.25));
      return { ...item, reputation_score: Number(reputationScore.toFixed(2)), review_content_signal: contentSignal };
    });
  const byReputation = (items) => items
    .slice()
    .sort((a, b) => Number(b.reputation_score) - Number(a.reputation_score) || Number(b.rating) - Number(a.rating) || (Number(b.review_count) || 0) - (Number(a.review_count) || 0))
    .slice(0, 10);

  return {
    count: places.length,
    ratingRanking: byReputation(places),
    negativeRanking: places
      .slice()
      .sort((a, b) => Number(a.reputation_score) - Number(b.reputation_score) || Number(a.rating) - Number(b.rating) || (Number(b.review_count) || 0) - (Number(a.review_count) || 0))
      .slice(0, 10),
    attractionRanking: byReputation(places.filter((item) => item.category === '觀光')),
    lodgingRanking: byReputation(places.filter((item) => item.category === '住宿')),
    restaurantRanking: byReputation(places.filter((item) => item.category === '美食'))
  };
}

function buildPttStats(posts, keywords) {
  const sortedByPush = posts
    .slice()
    .sort((a, b) => (Number(b.push_count) || 0) - (Number(a.push_count) || 0))
    .slice(0, 10);
  const discussionKeywords = keywords
    .map((keyword) => ({
      name: keyword,
      value: posts.filter((post) => matchesKeyword(post, keyword)).length
    }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, 'zh-Hant'))
    .slice(0, 10);

  return {
    count: posts.length,
    topPosts: sortedByPush,
    discussionKeywords
  };
}

export async function handler(event) {
  try {
    guard(event);
    const supabase = supabaseAdmin();
    const params = event.queryStringParameters || {};
    const selectedKeyword = (params.keyword || '').trim();
    const today = dateKey();
    const negativeCutoff = new Date();
    negativeCutoff.setMonth(negativeCutoff.getMonth() - 1);

    const [articleResult, keywordResult, postResult, negativeResult] = await Promise.all([
      supabase.from('articles').select('*').order('created_at', { ascending: false }).limit(500),
      supabase.from('keywords').select('keyword').eq('enabled', true).order('keyword'),
      supabase.from('posts').select('*').in('source', ['dcard', 'ptt']).order('published_at', { ascending: false }).limit(1000),
      supabase.from('articles').select('*').eq('sentiment', 'negative').gte('created_at', negativeCutoff.toISOString()).order('created_at', { ascending: false }).limit(500)
    ]);
    if (articleResult.error) throw articleResult.error;
    if (keywordResult.error) throw keywordResult.error;
    if (postResult.error && !['42P01', 'PGRST205'].includes(postResult.error.code)) throw postResult.error;
    if (negativeResult.error) throw negativeResult.error;

    const keywords = (keywordResult.data || []).map((item) => item.keyword);
    const allArticles = articleResult.data || [];
    const articles = selectedKeyword
      ? allArticles.filter((item) => matchesKeyword(item, selectedKeyword))
      : allArticles;
    const socialPosts = postResult.error ? [] : postResult.data || [];
    const filteredSocialPosts = selectedKeyword
      ? socialPosts.filter((item) => matchesKeyword(item, selectedKeyword))
      : socialPosts;
    const negativeArticles = selectedKeyword
      ? (negativeResult.data || []).filter((item) => matchesKeyword(item, selectedKeyword))
      : negativeResult.data || [];
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
    const negativeAlerts = [...negativeArticles, ...filteredSocialPosts]
      .filter((item) => {
        if (item.sentiment !== 'negative') return false;
        const timestamp = publishedTimestamp(item.published_at);
        return timestamp !== null
          && timestamp >= negativeCutoff.getTime()
          && timestamp <= Date.now() + 86400000;
      })
      .sort((a, b) => (importanceOrder[a.importance] ?? 9) - (importanceOrder[b.importance] ?? 9))
      .slice(0, 10);
    const youtubeStats = buildYouTubeStats(articles);
    const googleReviewStats = buildGoogleReviewStats(articles);
    const dcardStats = buildDcardStats(filteredSocialPosts.filter((item) => item.source === 'dcard'), keywords);
    const pttStats = buildPttStats(filteredSocialPosts.filter((item) => item.source === 'ptt'), keywords);

    return json(200, {
      keywords,
      selectedKeyword,
      todayCount: todayArticles.length,
      pendingCount: articles.filter((item) => item.status === 'pending').length,
      approvedCount: articles.filter((item) => item.status === 'approved').length,
      rejectedCount: articles.filter((item) => item.status === 'rejected').length,
      broadcastedCount: articles.filter((item) => item.is_broadcasted).length,
      facebookPostCount: articles.filter((item) => item.platform === 'facebook_page' && item.post_id).length,
      youtubeVideoCount: youtubeStats.count,
      youtubeTopChannels: youtubeStats.channels,
      youtubeTopVideos: youtubeStats.topVideos,
      googleReviewPlaceCount: googleReviewStats.count,
      googleReviewRatingRanking: googleReviewStats.ratingRanking,
      googleReviewNegativeRanking: googleReviewStats.negativeRanking,
      googleReviewAttractionRanking: googleReviewStats.attractionRanking,
      googleReviewLodgingRanking: googleReviewStats.lodgingRanking,
      googleReviewRestaurantRanking: googleReviewStats.restaurantRanking,
      dcardCount: dcardStats.count,
      dcardTopPosts: dcardStats.topPosts,
      dcardDiscussionKeywords: dcardStats.discussionKeywords,
      pttCount: pttStats.count,
      pttTopPosts: pttStats.topPosts,
      pttDiscussionKeywords: pttStats.discussionKeywords,
      categoryCounts: countBy(articles, 'category'),
      sourceCounts: countBy(articles, 'platform', 'website')
        .sort((a, b) => b.value - a.value),
      sentimentCounts: countBy(articles, 'sentiment', 'neutral'),
      volumeTrend: buildVolumeTrend(articles),
      popularKeywords,
      negativeAlerts,
      dailySummary: buildDailySummary(todayArticles, selectedKeyword, popularKeywords),
      latestArticles: articles.filter((item) => item.platform !== 'google_reviews').slice(0, 10)
    });
  } catch (err) {
    const status = err.message === '尚未登入' ? 401 : 500;
    return json(status, { error: err.message });
  }
}
