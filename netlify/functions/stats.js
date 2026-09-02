import { guard, json, supabaseAdmin } from './_utils.js';

const DEFAULT_FACEBOOK_KEYWORDS = [
  '花蓮',
  '花蓮旅遊',
  '花蓮美食',
  '花蓮住宿',
  '花蓮景點',
  '花蓮活動',
  '花蓮交通',
  '花蓮地震',
  '花蓮颱風',
  '花蓮災情',
  '花蓮縣',
  '花蓮市',
  '太魯閣',
  '七星潭',
  '東大門夜市',
  '鯉魚潭',
  '瑞穗',
  '光復',
  '玉里',
  '壽豐',
  '吉安',
  '新城',
  '洄瀾'
];

const HUALIEN_RELEVANCE_TERMS = [
  ...DEFAULT_FACEBOOK_KEYWORDS,
  '花蓮人',
  '花蓮大小事',
  '花蓮爆料',
  '花蓮同鄉會',
  '今日花蓮',
  '洄瀾灣',
  '美崙',
  '豐濱',
  '鳳林',
  '卓溪',
  '萬榮',
  '秀林',
  '富里',
  '豐田',
  '光復糖廠',
  '東華大學',
  '慈濟',
  '門諾',
  '魏嘉賢',
  '游淑貞',
  '張峻',
  '傅崐萁',
  '徐榛蔚'
];

function countBy(items, key, fallback = '其他') {
  const map = new Map();
  for (const item of items) {
    const name = item[key] || fallback;
    map.set(name, (map.get(name) || 0) + 1);
  }
  return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
}

function dateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
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

function effectiveTimestamp(article) {
  return publishedTimestamp(article?.published_at) || Date.parse(article?.created_at || '') || 0;
}

function isRecentByPublishedAt(article, days) {
  const timestamp = effectiveTimestamp(article);
  if (!timestamp) return false;
  const cutoff = Date.now() - days * 86400000;
  return timestamp >= cutoff && timestamp <= Date.now() + 86400000;
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

function articleRelevanceText(article) {
  return `${article.title || ''} ${article.content || ''} ${article.snippet || ''} ${article.summary || ''}`.replace(/\s+/g, '').toLowerCase();
}

function isUrlLikeTitle(article) {
  const title = String(article.title || '').trim();
  if (!title) return true;
  if (title === '[object Object]') return true;
  if (/^https?:\/\//i.test(title)) return true;
  if (article.url && title === String(article.url).trim()) return true;
  return false;
}

function isHualienRelatedArticle(article) {
  return matchesTextKeyword(article, HUALIEN_RELEVANCE_TERMS);
}

function isNonArticleLandingPage(article) {
  const title = String(article.title || '').trim();
  const text = articleRelevanceText(article);
  const urlText = String(article.url || '').trim().toLowerCase();

  const nonArticleTitlePatterns = [
    /圖書館$/,
    /資料庫$/,
    /搜尋$/,
    /首頁$/,
    /官方網站$/,
    /入口網$/,
    /服務網$/,
    /觀光資訊網$/,
    /國立.*圖書館/,
    /library/i
  ];
  if (nonArticleTitlePatterns.some((pattern) => pattern.test(title))) return true;

  const nonArticleTextWords = [
    '館藏查詢', '電子資源', '資料庫檢索', '讀者服務', '借閱服務',
    '開館時間', '館舍資訊', '館藏系統'
  ];
  if (nonArticleTextWords.some((word) => text.includes(word.replace(/\s+/g, '').toLowerCase()))) return true;

  try {
    const url = new URL(urlText);
    const path = url.pathname.replace(/\/+$/, '').toLowerCase();
    const search = url.search.toLowerCase();
    if (!path || path === '') return true;
    if (/\/(search|tag|tags|category|categories|topics?|list|lists|archive|archives|author|authors)$/.test(path)) return true;
    if (search && /(q=|query=|keyword=|search=|s=)/.test(search)) return true;
  } catch {
    return false;
  }

  return false;
}

function isSocialContentPlatform(platform = '') {
  return ['facebook_page', 'facebook_group', 'dcard', 'ptt', 'youtube'].includes(String(platform || '').toLowerCase());
}

function isNewsContentPlatform(platform = '') {
  return ['news', 'google_news', 'rss', 'sitemap'].includes(String(platform || '').toLowerCase());
}

function isNewsLikeArticle(article) {
  const source = String(article.source || article.source_name || '').trim();
  const title = String(article.title || '').trim();
  const urlText = String(article.url || '').trim();
  const mediaSignals = /(新聞|日報|時報|電視|報導|通訊社|中央社|聯合報|自由時報|中時|三立|民視|TVBS|東森|華視|公視|鏡新聞|更生|Yahoo|Nownews|NOWNEWS|UDN|CNA|ETtoday|PChome|風傳媒|報新聞|886)/i;

  if (mediaSignals.test(`${source} ${title}`)) return true;

  try {
    const url = new URL(urlText);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    const path = url.pathname.toLowerCase();
    const newsDomains = [
      'udn.com', 'nownews.com', 'cna.com.tw', 'ltn.com.tw', 'ettoday.net',
      'chinatimes.com', 'ctee.com.tw', 'setn.com', 'tvbs.com.tw', 'ftvnews.com.tw',
      'storm.mg', 'yahoo.com', 'ebc.net.tw', 'pts.org.tw', 'rti.org.tw',
      'pchome.com.tw', 'mirrormedia.mg', '886.news', 'ksnews.com.tw',
      'hsnews.com.tw', 'hualiennews.com'
    ];
    if (newsDomains.some((domain) => host === domain || host.endsWith(`.${domain}`))) return true;
    return /\/(news|article|story|archives?|posts?)\/|\/\d{4}\/\d{1,2}\/\d{1,2}\/|\/\d{5,}(?:\/|$)/i.test(path);
  } catch {
    return false;
  }
}

function isNewsOrSocialContent(article) {
  const platform = article.platform || '';
  if (isSocialContentPlatform(platform) || isNewsContentPlatform(platform)) return true;
  return isNewsLikeArticle(article);
}

function isDisplayableLatestArticle(article, keywords) {
  if (article.platform === 'google_reviews') return false;
  if (isPromotionalArticle(article)) return false;
  if (!isRecentByPublishedAt(article, 14)) return false;
  if (isUrlLikeTitle(article)) return false;
  if (isNonArticleLandingPage(article)) return false;
  if (!isNewsOrSocialContent(article)) return false;
  if (!isHualienRelatedArticle(article)) return false;
  return matchesTextKeyword(article, keywords);
}

function isTopicRelevantArticle(article, keywords) {
  if (isUrlLikeTitle(article)) return false;
  return matchesTextKeyword(article, keywords);
}

const NEGATIVE_ALERT_SIGNAL_WORDS = [
  '批評', '質疑', '不滿', '抗議', '怒轟', '砲轟', '痛批', '遭轟', '挨轟',
  '爭議', '涉案', '違法', '黑箱', '失言', '弊案', '貪污', '詐騙',
  '反彈', '道歉', '罷免', '停班', '停課', '封路', '停水', '停電',
  '災情', '傷亡', '受傷', '死亡', '事故', '淹水', '崩塌', '延誤',
  '塞車', '問題', '不足', '怠惰', '失職', '不當', '風險最高', '走路風險', '高風險',
  '酒駕', '肇事', '投毒', '命危', '下毒', '中毒', '蓄意',
  '未發放完', '未發放', '沒發放', '尚未發放', '未完成', '未落實'
];

const NEGATIVE_ALERT_STRONG_SIGNAL_WORDS = [
  '風險最高', '走路風險', '高風險', '死亡', '受傷', '傷亡', '事故',
  '酒駕', '肇事', '投毒', '命危', '下毒', '中毒', '違法', '涉案',
  '未發放完', '未發放', '沒發放', '尚未發放', '未完成', '未落實'
];

const NEGATIVE_ALERT_CONTEXT_ONLY_WORDS = [
  '關切', '祈求平安', '強調防災', '防災提升', '提升城市韌性',
  '城市韌性', '複合式防災', '慰問', '救災', '復原', '演練',
  '捐贈', '協助', '說明防災', '防災教育'
];

const NEGATIVE_ALERT_IMPROVEMENT_WORDS = [
  '蛻變', '亮點', '新亮點', '產業基地', '青創', '文化與青創',
  '拚防災', '防災顧問', '當顧問', '提升', '改善', '推動', '轉型',
  '活化', '成為', '應從', '應該從', '規劃', '建議', '願景'
];

const TITLE_STRONG_NEGATIVE_WORDS = [
  '死亡', '受傷', '傷亡', '事故', '酒駕', '肇事', '投毒', '命危', '下毒', '中毒',
  '違法', '涉案', '弊案', '貪污', '詐騙', '黑箱', '失言', '罷免',
  '未發放完', '未發放', '沒發放', '尚未發放', '未完成', '未落實',
  '風險最高', '走路風險', '高風險', '防災包未發放', '避難包未發放',
  '停班', '停課', '封路', '停水', '停電', '淹水', '崩塌', '塞車', '延誤',
  '遭轟', '挨轟', '痛批', '怒轟', '砲轟', '抨擊'
];

const TITLE_WEAK_NEGATIVE_WORDS = [
  '批評', '質疑', '不滿', '抗議', '反彈', '爭議', '問題', '不足', '怠惰', '失職', '不當'
];

const TITLE_POSITIVE_WORDS = [
  '推薦', '好評', '獲獎', '開幕', '啟用', '完工', '改善', '提升', '亮點', '新亮點',
  '活化', '蛻變', '推動', '加碼', '補助', '合作', '成功', '首創', '入選', '滿意',
  '值得', '好吃', '好玩', '漂亮', '平安', '祈福', '祝福'
];

const TITLE_IMPROVEMENT_CONTEXT_WORDS = [
  '關切', '祈求平安', '強調防災', '防災提升', '提升城市韌性', '城市韌性',
  '複合式防災', '慰問', '救災', '復原', '演練', '捐贈', '協助', '說明防災',
  '防災教育', '拚防災', '防災顧問', '當顧問', '閒置空間', '原民產業基地'
];

function hasAnyWord(text, words) {
  return words.some((word) => {
    const normalized = normalizedCompact(word);
    return normalized && text.includes(normalized);
  });
}

function articleTitleSignalText(item) {
  return normalizedCompact(item?.title || '');
}

function articleBodySignalText(item) {
  return normalizedCompact(`${item?.snippet || ''} ${item?.summary || ''} ${item?.content || ''}`);
}

function inferTitleFirstSentiment(item) {
  const title = articleTitleSignalText(item);
  const body = articleBodySignalText(item);
  const allText = `${title}${body}`;

  const strongTitleNegative = hasAnyWord(title, TITLE_STRONG_NEGATIVE_WORDS);
  const weakTitleNegative = hasAnyWord(title, TITLE_WEAK_NEGATIVE_WORDS);
  const titlePositive = hasAnyWord(title, TITLE_POSITIVE_WORDS);
  const improvementContext = hasAnyWord(title, TITLE_IMPROVEMENT_CONTEXT_WORDS)
    || hasAnyWord(title, NEGATIVE_ALERT_IMPROVEMENT_WORDS)
    || hasAnyWord(title, NEGATIVE_ALERT_CONTEXT_ONLY_WORDS);

  if (strongTitleNegative) return 'negative';
  if ((titlePositive || improvementContext) && !weakTitleNegative) return titlePositive ? 'positive' : 'neutral';
  if (weakTitleNegative) return 'negative';
  if (hasAnyWord(allText, TITLE_STRONG_NEGATIVE_WORDS)) return 'negative';
  if (titlePositive) return 'positive';
  return 'neutral';
}

function negativeAlertDedupKey(item) {
  const title = String(item.title || '')
    .replace(/\s+/g, '')
    .replace(/[|｜\-－–—_＿:：].*$/g, '')
    .toLowerCase();
  if (title.length >= 8) return `title:${title}`;

  try {
    const url = new URL(String(item.url || ''));
    url.hash = '';
    url.search = '';
    return `url:${url.toString().toLowerCase()}`;
  } catch {
    return `fallback:${String(item.url || item.external_id || item.id || title)}`;
  }
}

function dedupeNegativeAlerts(items) {
  const map = new Map();
  for (const item of items) {
    const key = negativeAlertDedupKey(item);
    if (!key || map.has(key)) continue;
    map.set(key, item);
  }
  return Array.from(map.values());
}

function isNegativeAlertContent(item) {
  const inferred = inferTitleFirstSentiment(item);
  if (inferred === 'negative') return true;
  if (inferred === 'positive') return false;

  const text = articleRelevanceText(item);
  const hasStrongNegativeSignal = hasAnyWord(text, NEGATIVE_ALERT_STRONG_SIGNAL_WORDS);
  const hasNegativeSignal = hasAnyWord(text, NEGATIVE_ALERT_SIGNAL_WORDS);
  const isContextOnly = hasAnyWord(text, NEGATIVE_ALERT_CONTEXT_ONLY_WORDS);
  const isImprovementContext = hasAnyWord(text, NEGATIVE_ALERT_IMPROVEMENT_WORDS);

  if (hasStrongNegativeSignal) return true;
  if (isImprovementContext || isContextOnly) return false;
  return hasNegativeSignal;
}

function dashboardSentiment(item) {
  const inferred = inferTitleFirstSentiment(item);
  if (inferred !== 'neutral') return inferred;
  if (isNegativeAlertContent(item)) return 'negative';

  const stored = normalizedSentiment(item.sentiment);
  if (stored === 'negative' && !isNegativeAlertContent(item)) return 'neutral';
  return stored;
}

function withDashboardSentiment(item) {
  const sentiment = dashboardSentiment(item);
  return sentiment === item.sentiment ? item : { ...item, sentiment };
}

function matchesTextKeyword(article, keywords = DEFAULT_FACEBOOK_KEYWORDS) {
  const text = articleRelevanceText(article);
  return keywords.some((keyword) => {
    const normalized = String(keyword || '').replace(/\s+/g, '').toLowerCase();
    return normalized && text.includes(normalized);
  });
}

function isPromotionalArticle(article) {
  const text = articleRelevanceText(article);
  const platform = String(article.platform || '');
  const promotionalPatterns = [
    /優惠/,
    /特價/,
    /團購/,
    /代購/,
    /訂購/,
    /預約電話/,
    /買一送一/,
    /抽獎/,
    /贈送/,
    /交友/,
    /徵友/,
    /單身/,
    /加賴/,
    /line[:：]?/,
    /房仲/,
    /租屋/,
    /租房/,
    /出租/,
    /買房/,
    /賣房/,
    /售屋/,
    /出售/,
    /建案/,
    /預售屋/,
    /新成屋/,
    /中古屋/,
    /套房/,
    /雅房/,
    /店面/,
    /透天/,
    /華廈/,
    /公寓/,
    /土地出售/,
    /農地/,
    /建地/,
    /看屋/,
    /賞屋/,
    /開價/,
    /總價/,
    /坪數/,
    /每坪/,
    /車位/,
    /屋主自售/,
    /專任委託/,
    /[0-9]+元/,
    /\$[0-9]+/
  ];
  const publicIssuePatterns = [
    /補助/,
    /公告/,
    /政策/,
    /交通/,
    /災情/,
    /地震/,
    /颱風/,
    /活動/,
    /觀光/
  ];
  const adScore = promotionalPatterns.filter((pattern) => pattern.test(text)).length;
  const hasPublicIssue = publicIssuePatterns.some((pattern) => pattern.test(text));
  const isSocialPost = ['facebook_page', 'facebook_group', 'dcard', 'ptt'].includes(platform);

  if (hasPublicIssue && adScore < 2) return false;
  return adScore >= 2 || (isSocialPost && adScore >= 1);
}

function isFacebookPlatform(platform) {
  return ['facebook_page', 'facebook_group'].includes(platform);
}

function preferredFacebookName(url = '') {
  const text = String(url || '');
  const rules = [
    ['265344726961368', '花蓮人Hualien'],
    ['255935524557211', '花蓮大小事'],
    ['249927231705630', '花蓮同鄉會'],
    ['833233640557210', '花蓮爆料王'],
    ['1718200485104617', '花蓮543 【洄瀾正藍宮】'],
    ['100063596289388', '今日花蓮']
  ];
  return rules.find(([key]) => text.includes(key))?.[1] || '';
}

function facebookDisplaySource(article) {
  return preferredFacebookName(article.url) || article.source || (article.platform === 'facebook_group' ? 'Facebook 公開社團' : 'Facebook 粉專');
}

function isFacebookPostUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (!/(^|\.)facebook\.com$/i.test(url.hostname)) return false;
    if (url.searchParams.has('story_fbid') || url.searchParams.has('fbid') || url.searchParams.has('v')) return true;
    return /\/(?:posts|permalink|videos|reel)\/[^/]+/i.test(url.pathname)
      || /\/share\/(?:p|v)\/[^/]+/i.test(url.pathname);
  } catch {
    return false;
  }
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

function buildDailySummary(todayArticles, keyword, popularKeywords, negativeAlerts) {
  const subject = keyword ? `「${keyword}」` : '整體花蓮輿情';
  if (todayArticles.length === 0) {
    const warning = negativeAlerts.length > 0
      ? `近一週共有 ${negativeAlerts.length} 則負面訊息，建議優先查看負評預警。`
      : '近一週未發現負面訊息。';
    return `今日尚未蒐集到${subject}的相關文章，建議稍後再次執行搜尋。${warning}`;
  }

  const topCategory = countBy(todayArticles, 'category').sort((a, b) => b.value - a.value)[0];
  const negativeCount = negativeAlerts.length;
  const focus = popularKeywords[0]?.name;
  const warning = negativeCount > 0
    ? `近一週共有 ${negativeCount} 則負面訊息，建議優先查看負評預警。`
    : '近一週未發現負面訊息。';
  const focusText = focus ? `熱門焦點為「${focus}」。` : '';

  return `今日共蒐集 ${todayArticles.length} 則${subject}相關文章，主要集中於「${topCategory?.name || '其他'}」分類。${focusText}${warning}`;
}

function buildYouTubeStats(articles) {
  const videos = articles.filter((item) =>
    item.platform === 'youtube'
    && !isUrlLikeTitle(item)
    && isHualienRelatedArticle(item)
  );
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

function buildFacebookStats(articles, days = 7) {
  const posts = articles.filter((item) => (
    ['facebook_page', 'facebook_group'].includes(item.platform)
    && isFacebookPostUrl(item.url)
    && isRecentByPublishedAt(item, days)
  ));
  const trendDays = Array.from({ length: days }, (_, index) => {
    const date = new Date(Date.now() - (days - 1 - index) * 86400000);
    const key = dateKey(date);
    return { key, name: key.slice(5).replace('-', '/'), value: 0 };
  });
  const trendMap = new Map(trendDays.map((day) => [day.key, day]));
  const pageMap = new Map();

  for (const post of posts) {
    const publishedKey = dateKey(post.published_at || post.created_at);
    const day = trendMap.get(publishedKey);
    if (day) day.value += 1;
    const pageName = facebookDisplaySource(post);
    const current = pageMap.get(pageName) || { name: pageName, value: 0, engagement: 0 };
    current.value += 1;
    current.engagement += (Number(post.like_count) || 0) + (Number(post.comment_count) || 0) + (Number(post.share_count) || 0);
    pageMap.set(pageName, current);
  }

  return {
    count: posts.length,
    volumeTrend: trendDays.map(({ name, value }) => ({ name, value })),
    sentimentCounts: countBy(posts, 'sentiment', 'neutral'),
    topPosts: posts
      .slice()
      .sort((a, b) => {
        const scoreA = Number(a.hotness_score) || (Number(a.like_count) || 0) + (Number(a.comment_count) || 0) * 2 + (Number(a.share_count) || 0) * 3;
        const scoreB = Number(b.hotness_score) || (Number(b.like_count) || 0) + (Number(b.comment_count) || 0) * 2 + (Number(b.share_count) || 0) * 3;
        return scoreB - scoreA;
      })
      .slice(0, 10)
      .map((post) => ({ ...post, source: facebookDisplaySource(post) })),
    pageRanking: Array.from(pageMap.values())
      .sort((a, b) => b.value - a.value || b.engagement - a.engagement)
      .slice(0, 10)
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

const ELECTION_KEYWORDS = ['魏嘉賢', '游淑貞', '張峻'];
const ELECTION_RECENT_DAYS = 7;
const ELECTION_POSITIVE_WORDS = ['支持', '肯定', '力挺', '讚賞', '滿意', '看好', '加分', '政績', '完成', '改善'];
const ELECTION_NEUTRAL_WORDS = ['出席', '表示', '指出', '宣布', '拜會', '參選', '登記', '說明'];
const ELECTION_IMPORTANCE_WEIGHT = { urgent: 5, high: 4, medium: 2, low: 1 };
const ELECTION_SUBJECT_ALIASES = {
  '魏嘉賢': ['魏嘉賢', '花蓮市長'],
  '游淑貞': ['游淑貞', '吉安鄉長'],
  '張峻': ['張峻', '花蓮縣議長', '縣議長']
};
const ELECTION_NEGATIVE_SUBJECT_WINDOW = 56;
const ELECTION_ADVERSE_EVENT_WORDS = [
  '爭議', '涉案', '違法', '黑箱', '失言', '弊案', '貪污', '詐騙',
  '酒駕', '肇事', '投毒', '命危', '下毒', '中毒', '蓄意',
  '遭轟', '挨轟', '道歉', '罷免', '失職', '不當'
];
const ELECTION_TARGETED_NEGATIVE_WORDS = [
  '批評', '質疑', '不滿', '抗議', '怒轟', '砲轟', '痛批', '抨擊'
];

function normalizedSentiment(value) {
  return ['positive', 'negative', 'neutral'].includes(value) ? value : 'neutral';
}

function normalizedCompact(value) {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
}

function indexPositions(text, token) {
  const positions = [];
  if (!text || !token) return positions;
  let index = text.indexOf(token);
  while (index >= 0) {
    positions.push(index);
    index = text.indexOf(token, index + Math.max(token.length, 1));
  }
  return positions;
}

function sameTextWindow(text, leftIndex, rightIndex, size = ELECTION_NEGATIVE_SUBJECT_WINDOW) {
  if (leftIndex < 0 || rightIndex < 0) return false;
  return Math.abs(leftIndex - rightIndex) <= size;
}

function hasSubjectAdverseEvent(text, aliases) {
  return aliases.some((alias) =>
    indexPositions(text, alias).some((subjectIndex) =>
      ELECTION_ADVERSE_EVENT_WORDS.map(normalizedCompact)
        .filter(Boolean)
        .some((signal) =>
          indexPositions(text, signal).some((signalIndex) =>
            signalIndex >= subjectIndex && sameTextWindow(text, subjectIndex, signalIndex)
          )
        )
    )
  );
}

function hasCandidateAsNegativeTarget(text, aliases) {
  return aliases.some((alias) =>
    indexPositions(text, alias).some((subjectIndex) =>
      ELECTION_TARGETED_NEGATIVE_WORDS.map(normalizedCompact)
        .filter(Boolean)
        .some((signal) =>
          indexPositions(text, signal).some((signalIndex) =>
            signalIndex <= subjectIndex && sameTextWindow(text, signalIndex, subjectIndex, 36)
          )
        )
    )
  );
}

function isNegativeForElectionSubject(item, keyword) {
  if (!keyword || !isNegativeAlertContent(item)) return false;

  const text = articleRelevanceText(item);
  const aliases = (ELECTION_SUBJECT_ALIASES[keyword] || [keyword])
    .map(normalizedCompact)
    .filter(Boolean);
  if (!aliases.some((alias) => text.includes(alias))) return false;

  return hasSubjectAdverseEvent(text, aliases) || hasCandidateAsNegativeTarget(text, aliases);
}

function electionSentiment(item, keyword = '') {
  const text = articleRelevanceText(item);
  const positive = ELECTION_POSITIVE_WORDS.filter((word) => text.includes(word)).length;
  const neutral = ELECTION_NEUTRAL_WORDS.some((word) => text.includes(word));
  const storedSentiment = normalizedSentiment(item.sentiment);

  if (keyword && isNegativeForElectionSubject(item, keyword)) return 'negative';
  if (!keyword && isNegativeAlertContent(item)) return 'negative';
  if (storedSentiment === 'negative') {
    return 'neutral';
  }
  if (positive > 0) return 'positive';
  if (neutral) return 'neutral';
  return storedSentiment;
}

function percentage(value, total) {
  if (!total) return 0;
  return Math.round((value / total) * 1000) / 10;
}

function favorabilityValue(positive, negative) {
  if (negative === 0) return positive > 0 ? '∞' : '0.00';
  return (positive / negative).toFixed(2);
}

function electionDedupKey(item) {
  const title = String(item.title || '').replace(/\s+/g, '').toLowerCase();
  if (title.length >= 8) return `title:${title}`;

  try {
    const url = new URL(String(item.url || ''));
    url.hash = '';
    url.search = '';
    return `url:${url.toString().toLowerCase()}`;
  } catch {
    return `fallback:${String(item.url || item.id || item.external_id || title)}`;
  }
}

function dedupeElectionItems(items) {
  const map = new Map();
  for (const item of items) {
    const key = electionDedupKey(item);
    if (!key || map.has(key)) continue;
    map.set(key, item);
  }
  return Array.from(map.values());
}

function latestArticleDedupKey(item) {
  const title = String(item.title || '')
    .replace(/\s+/g, '')
    .replace(/(?:\||｜|－|-|—|–).{2,40}$/u, '')
    .toLowerCase();
  if (title.length >= 8) return `title:${title}`;

  try {
    const url = new URL(String(item.url || ''));
    url.hash = '';
    url.search = '';
    return `url:${url.toString().toLowerCase()}`;
  } catch {
    return `fallback:${String(item.url || item.id || item.external_id || title)}`;
  }
}

function dedupeLatestArticles(items) {
  const map = new Map();
  for (const item of items) {
    const key = latestArticleDedupKey(item);
    if (!key || map.has(key)) continue;
    map.set(key, item);
  }
  return Array.from(map.values());
}

function electionEventRow(item, keyword = '') {
  return {
    title: item.title || '未命名事件',
    source: item.source || item.source_name || item.platform || '未知來源',
    sentiment: electionSentiment(item, keyword),
    url: item.url || '',
    published_at: item.published_at || item.created_at || '',
    category: item.category || '其他',
    importance: item.importance || 'medium'
  };
}

function sortElectionEvents(a, b) {
  const weightA = ELECTION_IMPORTANCE_WEIGHT[a.importance] || 0;
  const weightB = ELECTION_IMPORTANCE_WEIGHT[b.importance] || 0;
  const hotA = Number(a.hotness_score || a.like_count || a.comment_count || a.view_count) || 0;
  const hotB = Number(b.hotness_score || b.like_count || b.comment_count || b.view_count) || 0;
  return weightB - weightA || hotB - hotA || effectiveTimestamp(b) - effectiveTimestamp(a);
}

function buildPeakSummary(keyword, items) {
  const dayMap = new Map();
  for (const item of items) {
    const timestamp = effectiveTimestamp(item);
    if (!timestamp) continue;
    const key = dateKey(new Date(timestamp));
    if (!key) continue;
    const current = dayMap.get(key) || [];
    current.push(item);
    dayMap.set(key, current);
  }

  const peak = Array.from(dayMap.entries())
    .map(([date, dayItems]) => ({ date, count: dayItems.length, items: dayItems }))
    .sort((a, b) => b.count - a.count || b.date.localeCompare(a.date))[0];

  if (!peak) {
    return {
      date: '',
      count: 0,
      summary: `${keyword} 目前沒有可辨識的高峰事件。`,
      events: []
    };
  }

  const events = dedupeElectionItems(peak.items)
    .slice()
    .sort(sortElectionEvents)
    .slice(0, 3)
    .map((item) => electionEventRow(item, keyword));

  const eventTitles = events.map((event) => event.title).join('、');
  return {
    date: peak.date,
    count: peak.count,
    summary: `${keyword} 在 ${peak.date} 出現 ${peak.count} 則聲量高峰，主要集中於：${eventTitles || '尚無代表事件'}。`,
    events
  };
}

function buildElectionSummary(articles, socialPosts) {
  const startDate = new Date(Date.now() - ELECTION_RECENT_DAYS * 86400000);
  const normalizedPosts = (socialPosts || []).map((post) => ({
    ...post,
    platform: post.source,
    source: post.source_name || post.source,
    importance: post.importance || 'medium',
    created_at: post.created_at || post.published_at
  }));
  const pool = [...articles, ...normalizedPosts]
    .filter((item) => item.url || item.title)
    .filter((item) => isRecentByPublishedAt(item, ELECTION_RECENT_DAYS))
    .filter((item) => !isPromotionalArticle(item));

  return {
    meta: {
      startDate: dateKey(startDate),
      endDate: dateKey(),
      days: ELECTION_RECENT_DAYS,
      note: '近 7 天，含新聞、一般網站、RSS、YouTube、Facebook、Dcard、PTT；排除廣告文並依標題/網址去重。'
    },
    items: ELECTION_KEYWORDS.map((keyword) => {
    const matched = dedupeElectionItems(pool.filter((item) => matchesKeyword(item, keyword)));
    const relatedArticles = matched
      .slice()
      .sort(sortElectionEvents)
      .slice(0, 20)
      .map((item) => electionEventRow(item, keyword));
    const negativeEvents = matched
      .filter((item) => electionSentiment(item, keyword) === 'negative')
      .slice()
      .sort(sortElectionEvents)
      .slice(0, 3)
      .map((item) => electionEventRow(item, keyword));
    const counts = matched.reduce((acc, item) => {
      acc[electionSentiment(item, keyword)] += 1;
      return acc;
    }, { positive: 0, neutral: 0, negative: 0 });
    const total = matched.length;

    return {
      keyword,
      total,
      positiveCount: counts.positive,
      neutralCount: counts.neutral,
      negativeCount: counts.negative,
      positivePercent: percentage(counts.positive, total),
      neutralPercent: percentage(counts.neutral, total),
      negativePercent: percentage(counts.negative, total),
      favorability: favorabilityValue(counts.positive, counts.negative),
      peak: buildPeakSummary(keyword, matched),
      relatedArticles,
      negativeEvents
    };
    })
  };
}

function buildPopularKeywords(keywords, articles, socialPosts, selectedKeyword = '') {
  const normalizedPosts = (socialPosts || []).map((post) => ({
    ...post,
    platform: post.source,
    source: post.source_name || post.source,
    importance: post.importance || 'medium',
    created_at: post.created_at || post.published_at
  }));
  const pool = dedupeElectionItems([...articles, ...normalizedPosts]
    .filter((item) => item.url || item.title)
    .filter((item) => isRecentByPublishedAt(item, ELECTION_RECENT_DAYS))
    .filter((item) => !isPromotionalArticle(item))
    .filter((item) => !isUrlLikeTitle(item)));
  const scopedPool = selectedKeyword
    ? pool.filter((item) => matchesKeyword(item, selectedKeyword))
    : pool;

  return keywords
    .map((keyword) => ({
      name: keyword,
      value: dedupeElectionItems(scopedPool.filter((article) => matchesKeyword(article, keyword))).length
    }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, 'zh-Hant'))
    .slice(0, 10);
}

export async function handler(event) {
  try {
    guard(event);
    const supabase = supabaseAdmin();
    const params = event.queryStringParameters || {};
    const selectedKeyword = (params.keyword || '').trim();
    const today = dateKey();
    const negativeCutoff = new Date(Date.now() - 7 * 86400000);

    const [articleResult, keywordResult, postResult, negativeResult, facebookResult] = await Promise.all([
      supabase.from('articles').select('*').order('created_at', { ascending: false }).limit(1000),
      supabase.from('keywords').select('keyword').eq('enabled', true).order('keyword'),
      supabase.from('posts').select('*').in('source', ['dcard', 'ptt']).order('published_at', { ascending: false }).limit(1000),
      supabase.from('articles').select('*').eq('sentiment', 'negative').gte('created_at', negativeCutoff.toISOString()).order('created_at', { ascending: false }).limit(500),
      supabase.from('articles').select('*').in('platform', ['facebook_page', 'facebook_group']).order('created_at', { ascending: false }).limit(1500)
    ]);
    if (articleResult.error) throw articleResult.error;
    if (keywordResult.error) throw keywordResult.error;
    if (postResult.error && !['42P01', 'PGRST205'].includes(postResult.error.code)) throw postResult.error;
    if (negativeResult.error) throw negativeResult.error;
    if (facebookResult.error) throw facebookResult.error;

    const keywords = (keywordResult.data || []).map((item) => item.keyword);
    const relevanceKeywords = [...new Set([...keywords, ...DEFAULT_FACEBOOK_KEYWORDS])]
      .map((keyword) => String(keyword || '').trim())
      .filter(Boolean);
    const isRelevantArticle = (item) => !isFacebookPlatform(item.platform) || matchesTextKeyword(item, relevanceKeywords);
    const allArticles = (articleResult.data || [])
      .filter(isRelevantArticle)
      .map(withDashboardSentiment);
    const articles = selectedKeyword
      ? allArticles.filter((item) => matchesKeyword(item, selectedKeyword))
      : allArticles;
    const socialPosts = postResult.error ? [] : postResult.data || [];
    const filteredSocialPosts = selectedKeyword
      ? socialPosts.filter((item) => matchesKeyword(item, selectedKeyword))
      : socialPosts;
    const alertKeywords = selectedKeyword ? [selectedKeyword] : relevanceKeywords;
    const negativeArticles = [
      ...(negativeResult.data || []).map(withDashboardSentiment),
      ...allArticles.filter((item) => item.sentiment === 'negative')
    ].filter((item) => isRelevantArticle(item) && isTopicRelevantArticle(item, alertKeywords));
    const facebookArticles = selectedKeyword
      ? (facebookResult.data || []).filter((item) => isRelevantArticle(item) && matchesKeyword(item, selectedKeyword))
      : (facebookResult.data || []).filter(isRelevantArticle);
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

    const popularKeywords = buildPopularKeywords(keywords, allArticles, socialPosts, selectedKeyword);

    const importanceOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
    const negativeAlerts = dedupeNegativeAlerts([...negativeArticles, ...filteredSocialPosts]
      .map(withDashboardSentiment)
      .filter((item) => {
        if (item.sentiment !== 'negative') return false;
        if (!isTopicRelevantArticle(item, alertKeywords)) return false;
        const timestamp = publishedTimestamp(item.published_at);
        return timestamp !== null
          && timestamp >= negativeCutoff.getTime()
          && timestamp <= Date.now() + 86400000
          && isNegativeAlertContent(item);
      })
    )
      .sort((a, b) => (importanceOrder[a.importance] ?? 9) - (importanceOrder[b.importance] ?? 9))
      .slice(0, 10);
    const youtubeStats = buildYouTubeStats(articles);
    const googleReviewStats = buildGoogleReviewStats(articles);
    const facebookStats = buildFacebookStats(facebookArticles, selectedKeyword ? 30 : 7);
    const dcardStats = buildDcardStats(filteredSocialPosts.filter((item) => item.source === 'dcard'), keywords);
    const pttStats = buildPttStats(filteredSocialPosts.filter((item) => item.source === 'ptt'), keywords);
    const electionSummary = buildElectionSummary(allArticles, socialPosts);

    return json(200, {
      keywords,
      selectedKeyword,
      todayCount: todayArticles.length,
      pendingCount: articles.filter((item) => item.status === 'pending').length,
      approvedCount: articles.filter((item) => item.status === 'approved').length,
      rejectedCount: articles.filter((item) => item.status === 'rejected').length,
      broadcastedCount: articles.filter((item) => item.is_broadcasted).length,
      facebookPostCount: facebookStats.count,
      facebookVolumeTrend: facebookStats.volumeTrend,
      facebookTopPosts: facebookStats.topPosts,
      facebookSentimentCounts: facebookStats.sentimentCounts,
      facebookPageRanking: facebookStats.pageRanking,
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
      dailySummary: buildDailySummary(todayArticles, selectedKeyword, popularKeywords, negativeAlerts),
      electionSummary: electionSummary.items,
      electionSummaryMeta: electionSummary.meta,
      latestArticles: dedupeLatestArticles(
        articles
          .filter((item) => isDisplayableLatestArticle(item, selectedKeyword ? [selectedKeyword] : relevanceKeywords))
          .sort((a, b) => effectiveTimestamp(b) - effectiveTimestamp(a))
      ).slice(0, 10)
    });
  } catch (err) {
    const status = err.message === '尚未登入' ? 401 : 500;
    return json(status, { error: err.message });
  }
}
