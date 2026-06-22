import {
  fetchMeta,
  fetchWithTimeout,
  guard,
  json,
  normalizeArticle,
  parseXmlFeed,
  supabaseAdmin,
  upsertDefaultsIfEmpty
} from './_utils.js';

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function placeCategory(value = '') {
  const text = String(value).toLowerCase();
  if (/(hotel|lodging|hostel|motel|民宿|飯店|旅館|住宿)/i.test(text)) return '住宿';
  if (/(restaurant|food|cafe|bakery|餐廳|小吃|咖啡|美食|夜市)/i.test(text)) return '美食';
  if (/(attraction|tourist|park|museum|景點|公園|步道|遊樂|觀光)/i.test(text)) return '觀光';
  return '其他';
}

function placeReviewText(item) {
  if (item.reviewText || item.snippet || item.description) {
    return item.reviewText || item.snippet || item.description;
  }
  if (!Array.isArray(item.reviews)) return '';
  return item.reviews
    .map((review) => review?.text || review?.snippet || review?.reviewText || '')
    .filter(Boolean)
    .slice(0, 3)
    .join(' ');
}

async function serper(endpoint, query) {
  if (!process.env.SERPER_API_KEY) return [];

  let response;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    response = await fetchWithTimeout(`https://google.serper.dev/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': process.env.SERPER_API_KEY
      },
      body: JSON.stringify({ q: query, gl: 'tw', hl: 'zh-tw', num: 10 })
    });

    if (response.status !== 429 || attempt === 1) break;
    const retryAfter = Number(response.headers?.get('retry-after')) || 1;
    await wait(Math.min(3000, Math.max(1000, retryAfter * 1000)));
  }

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error('Serper 額度或呼叫速率已達上限（429），請稍後再試或檢查 Serper 方案額度');
    }
    throw new Error(`Serper ${endpoint} 失敗：${response.status}`);
  }

  const data = await response.json();
  const items = endpoint === 'news'
    ? data.news || []
    : endpoint === 'videos'
      ? data.videos || []
      : endpoint === 'places'
        ? data.places || []
      : data.organic || [];

  if (endpoint === 'places') {
    return items.map((item) => {
      const placeName = item.title || item.name || 'Google 地點';
      const rating = Number(item.rating);
      const reviewText = placeReviewText(item);
      const placeType = item.category || item.type || item.types?.join(' ') || '';
      const cid = item.cid || item.placeId || item.place_id || '';
      const url = item.link
        || item.mapsUrl
        || (cid ? `https://www.google.com/maps?cid=${encodeURIComponent(cid)}` : '')
        || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${placeName} 花蓮`)}`;
      return {
        title: placeName,
        url,
        source: 'Google 評論',
        platform: 'google_reviews',
        category: placeCategory(`${placeType} ${placeName}`),
        snippet: reviewText || item.address || placeType,
        summary: reviewText || item.address || placeType,
        sentiment: Number.isFinite(rating) ? (rating < 3.5 ? 'negative' : rating >= 4.2 ? 'positive' : 'neutral') : 'neutral',
        importance: 'medium',
        place_name: placeName,
        rating: Number.isFinite(rating) ? rating : null,
        review_count: Number(item.ratingCount ?? item.reviewsCount ?? item.reviewCount ?? item.userRatingCount) || 0,
        review_text: reviewText,
        place_type: placeType,
        published_at: ''
      };
    }).filter((item) => item.url);
  }

  if (endpoint === 'videos') {
    return items.map((item) => ({
      title: item.title,
      url: item.link,
      source: 'YouTube',
      platform: 'youtube',
      category: '觀光',
      sentiment: 'neutral',
      snippet: item.snippet || item.description || '',
      summary: item.snippet || item.description || '',
      published_at: item.date || item.publishedAt || '',
      channel_name: typeof item.channel === 'string'
        ? item.channel
        : item.channel?.name || item.source || '未知頻道',
      view_count: 0,
      thumbnail: item.imageUrl || item.thumbnail || item.image || ''
    })).filter((item) => isYouTubeUrl(item.url));
  }

  return items.map((item) => ({
    title: item.title,
    url: item.link,
    source: item.source || item.domain || 'Google',
    platform: endpoint === 'news' ? 'google_news' : 'google_search',
    snippet: item.snippet || item.description || '',
    summary: item.snippet || item.description || '',
    published_at: item.date || ''
  })).filter((item) => item.url);
}

function parseViewCount(value) {
  if (typeof value === 'number') return Math.max(0, Math.trunc(value));
  const text = String(value || '').replace(/,/g, '').toLowerCase();
  if (!/(views?|觀看|次觀看)/i.test(text) && !/^\s*\d+(?:\.\d+)?\s*(k|m|b|萬|億)\s*$/i.test(text)) {
    return 0;
  }
  const match = text.match(/(\d+(?:\.\d+)?)\s*(k|m|b|萬|億)?(?:\s*(?:views?|次觀看|觀看))?/i);
  if (!match) return 0;

  const multipliers = { k: 1e3, m: 1e6, b: 1e9, '萬': 1e4, '億': 1e8 };
  return Math.max(0, Math.trunc(Number(match[1]) * (multipliers[match[2]] || 1)));
}

function isYouTubeUrl(value) {
  try {
    const hostname = new URL(value).hostname.replace(/^www\./, '');
    return hostname === 'youtube.com' || hostname === 'm.youtube.com' || hostname === 'youtu.be';
  } catch {
    return false;
  }
}

function youtubeVideoId(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.replace(/^www\./, '');
    if (hostname === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] || '';
    if (hostname === 'youtube.com' || hostname === 'm.youtube.com') {
      if (url.pathname === '/watch') return url.searchParams.get('v') || '';
      const parts = url.pathname.split('/').filter(Boolean);
      if (['shorts', 'live', 'embed'].includes(parts[0])) return parts[1] || '';
    }
  } catch {
    return '';
  }
  return '';
}

async function enrichYouTubeMetadata(candidates) {
  const videosById = new Map();
  for (const candidate of candidates) {
    if (candidate.platform !== 'youtube') continue;
    const id = youtubeVideoId(candidate.url);
    if (!id) continue;
    const group = videosById.get(id) || [];
    group.push(candidate);
    videosById.set(id, group);
  }

  const ids = Array.from(videosById.keys());
  if (ids.length === 0) return;

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error('YOUTUBE_API_KEY 尚未設定，無法取得官方觀看數');

  for (let index = 0; index < ids.length; index += 50) {
    const batch = ids.slice(index, index + 50);
    const params = new URLSearchParams({
      part: 'statistics,snippet',
      id: batch.join(','),
      key: apiKey
    });
    const response = await fetchWithTimeout(`https://www.googleapis.com/youtube/v3/videos?${params.toString()}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error?.message || `YouTube Data API 失敗：${response.status}`);
    }

    for (const item of payload.items || []) {
      const snippet = item.snippet || {};
      const thumbnails = snippet.thumbnails || {};
      for (const candidate of videosById.get(item.id) || []) {
        candidate.title = snippet.title || candidate.title;
        candidate.channel_name = snippet.channelTitle || candidate.channel_name;
        candidate.published_at = snippet.publishedAt || candidate.published_at;
        candidate.thumbnail = thumbnails.maxres?.url || thumbnails.high?.url || thumbnails.medium?.url || thumbnails.default?.url || candidate.thumbnail;
        candidate.view_count = Math.max(0, Number.parseInt(item.statistics?.viewCount, 10) || 0);
      }
    }
  }
}

async function youtubeVideos(query) {
  const videos = await serper('videos', query);
  if (videos.length > 0) return videos;

  const fallback = await serper('search', `site:youtube.com/watch ${query}`);
  return fallback.filter((item) => isYouTubeUrl(item.url)).map((item) => ({
    ...item,
    source: 'YouTube',
    platform: 'youtube',
    category: '觀光',
    sentiment: 'neutral',
    channel_name: '未知頻道',
    view_count: 0,
    thumbnail: ''
  }));
}

function facebookPageIdentifier(url) {
  try {
    const parsed = new URL(url);
    const queryId = parsed.searchParams.get('id');
    if (queryId) return queryId;

    const segments = parsed.pathname.split('/').filter(Boolean);
    const numericId = [...segments].reverse().find((segment) => /^\d+$/.test(segment));
    if (numericId) return numericId;
    return segments[0] || '';
  } catch {
    return '';
  }
}

async function facebookGraph(path, params = {}) {
  const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!token) throw new Error('FACEBOOK_PAGE_ACCESS_TOKEN 尚未設定');

  const configuredVersion = process.env.FACEBOOK_GRAPH_API_VERSION || 'v23.0';
  const version = /^v\d+\.\d+$/.test(configuredVersion) ? configuredVersion : 'v23.0';
  const query = new URLSearchParams(params);
  const response = await fetchWithTimeout(
    `https://graph.facebook.com/${version}/${path}?${query.toString()}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    throw new Error(data.error?.message || `HTTP ${response.status}`);
  }
  return data;
}

function facebookPostImage(post) {
  const attachment = post.attachments?.data?.[0];
  const subattachment = attachment?.subattachments?.data?.find((item) => item.media?.image?.src);
  return post.full_picture || attachment?.media?.image?.src || subattachment?.media?.image?.src || '';
}

async function facebookPagePosts(source) {
  const identifier = facebookPageIdentifier(source.url);
  if (!identifier) throw new Error('無法從粉專 URL 辨識 Facebook Page ID');

  const page = await facebookGraph(encodeURIComponent(identifier), { fields: 'id,name' });
  const posts = await facebookGraph(`${encodeURIComponent(page.id)}/posts`, {
    fields: 'id,message,created_time,permalink_url,full_picture,attachments{media,subattachments{media}}',
    limit: '10'
  });

  return (posts.data || []).map((post) => {
    const message = post.message?.trim() || '';
    return {
      title: message ? message.slice(0, 90) : `${page.name || source.name} Facebook 貼文`,
      url: post.permalink_url || `https://www.facebook.com/${post.id}`,
      snippet: message,
      summary: message,
      published_at: post.created_time || '',
      post_id: post.id,
      image_url: facebookPostImage(post)
    };
  }).filter((post) => post.url);
}

async function collectFacebookPageSource(source) {
  if (process.env.FACEBOOK_PAGE_ACCESS_TOKEN) {
    try {
      const posts = await facebookPagePosts(source);
      if (posts.length > 0) return tagSource(posts, source);
    } catch (err) {
      const fallback = await serper('search', sourceQuery(source, 'site:facebook.com'));
      if (fallback.length > 0) return tagSource(fallback, source);
      throw new Error(`Facebook Graph API 失敗：${err.message}`);
    }
  }

  return tagSource(await serper('search', sourceQuery(source, 'site:facebook.com')), source);
}

function sourceDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function sourceQuery(source, prefix = '') {
  return [prefix, '花蓮', source.name].filter(Boolean).join(' ');
}

function tagSource(items, source) {
  return items.map((item) => ({
    ...item,
    source: source.name,
    platform: source.source_type
  }));
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function collectXmlSource(source) {
  const items = await parseXmlFeed(source.url, source.source_type);
  const selectedItems = items.slice(0, 25);
  const enrichedItems = await mapWithConcurrency(selectedItems, 4, async (item, index) => {
    let enriched = item;
    if (index < 8 && (!item.snippet || item.title === item.url)) {
      const meta = await fetchMeta(item.url).catch(() => null);
      if (meta) {
        enriched = {
          ...item,
          title: meta.title || item.title,
          snippet: meta.description || item.snippet,
          summary: meta.description || item.summary
        };
      }
    }
    return enriched;
  });

  return tagSource(enrichedItems, source);
}

async function collectWebsiteSource(source) {
  const results = [];
  const domain = sourceDomain(source.url);
  if (domain) {
    results.push(...await serper('search', `site:${domain} 花蓮`));
  }

  const meta = await fetchMeta(source.url).catch(() => null);
  if (meta?.title) {
    results.push({
      title: meta.title,
      url: source.url,
      snippet: meta.description,
      summary: meta.description,
      published_at: ''
    });
  }

  return tagSource(results, source);
}

async function collectApiSource(source) {
  switch (source.source_type) {
    case 'google_news':
      return tagSource(await serper('news', sourceQuery(source)), source);
    case 'youtube':
      return youtubeVideos(sourceQuery(source));
    case 'facebook_page':
      return collectFacebookPageSource(source);
    case 'facebook_group':
      return tagSource(await serper('search', sourceQuery(source, 'site:facebook.com/groups')), source);
    case 'google_reviews':
      {
        const results = [];
        for (const query of ['花蓮 景點', '花蓮 住宿', '花蓮 餐廳']) {
          results.push(...await serper('places', query));
        }
        return tagSource(results, source);
      }
    case 'ptt':
    case 'dcard':
      return [];
    default:
      throw new Error(`不支援的來源類型：${source.source_type}`);
  }
}

async function collectFromSources(sources) {
  const results = [];
  const errors = [];

  await mapWithConcurrency(sources, 4, async (source) => {
    try {
      if (['rss', 'sitemap'].includes(source.source_type)) {
        results.push(...await collectXmlSource(source));
      } else if (source.source_type === 'website') {
        results.push(...await collectWebsiteSource(source));
      } else {
        results.push(...await collectApiSource(source));
      }
    } catch (err) {
      errors.push({ source: source.name || source.url, message: err.message });
    }
  });

  return { results, errors };
}

async function insertArticles(supabase, candidates) {
  let duplicates = 0;
  const candidateMap = new Map();

  for (const candidate of candidates) {
    if (!candidate.url) {
      duplicates += 1;
      continue;
    }

    const existing = candidateMap.get(candidate.url);
    if (existing) {
      duplicates += 1;
      const candidatePriority = candidate.platform === 'youtube' || candidate.post_id ? 2 : 1;
      const existingPriority = existing.platform === 'youtube' || existing.post_id ? 2 : 1;
      if (candidatePriority > existingPriority) candidateMap.set(candidate.url, candidate);
    } else {
      candidateMap.set(candidate.url, candidate);
    }
  }

  const articles = Array.from(candidateMap.values()).map(normalizeArticle);
  let inserted = 0;
  for (let index = 0; index < articles.length; index += 50) {
    const chunk = articles.slice(index, index + 50);
    const urls = chunk.map((article) => article.url);
    const { data: existingRows, error: lookupError } = await supabase
      .from('articles')
      .select('*')
      .in('url', urls);
    if (lookupError) throw lookupError;

    const existingMap = new Map((existingRows || []).map((row) => [row.url, row]));
    const rowsToInsert = [];
    const rowsToUpdate = [];

    for (const article of chunk) {
      const existing = existingMap.get(article.url);
      if (!existing) {
        rowsToInsert.push(article);
        continue;
      }

      duplicates += 1;
      if (article.platform === 'youtube') {
        rowsToUpdate.push({
          ...existing,
          title: article.title || existing.title,
          source: 'YouTube',
          platform: 'youtube',
          category: '觀光',
          snippet: article.snippet || existing.snippet,
          summary: article.summary || existing.summary,
          published_at: article.published_at || existing.published_at,
          sentiment: 'neutral',
          channel_name: article.channel_name || existing.channel_name,
          view_count: article.view_count || existing.view_count || 0,
          thumbnail: article.thumbnail || existing.thumbnail
        });
      } else if (article.platform === 'google_reviews') {
        rowsToUpdate.push({
          ...existing,
          title: article.title || existing.title,
          source: article.source || existing.source,
          platform: 'google_reviews',
          category: article.category || existing.category,
          snippet: article.snippet || existing.snippet,
          summary: article.summary || existing.summary,
          sentiment: article.sentiment || existing.sentiment,
          place_name: article.place_name || existing.place_name,
          rating: article.rating ?? existing.rating,
          review_count: article.review_count ?? existing.review_count ?? 0,
          review_text: article.review_text || existing.review_text,
          place_type: article.place_type || existing.place_type
        });
      }
    }

    if (rowsToInsert.length > 0) {
      const { data, error } = await supabase
        .from('articles')
        .upsert(rowsToInsert, { onConflict: 'url', ignoreDuplicates: true })
        .select('url');
      if (error) throw error;
      const insertedCount = data?.length || 0;
      inserted += insertedCount;
      duplicates += rowsToInsert.length - insertedCount;
    }

    if (rowsToUpdate.length > 0) {
      const { error } = await supabase
        .from('articles')
        .upsert(rowsToUpdate, { onConflict: 'url' });
      if (error) throw error;
    }
  }

  return { inserted, duplicates };
}

export async function handler(event) {
  try {
    const isScheduled = event.httpMethod === undefined || event.headers?.['x-netlify-scheduled'] === 'true';
    if (!isScheduled) {
      guard(event);
    }

    if (!isScheduled && event.httpMethod !== 'POST') {
      return json(405, { error: 'Method not allowed' });
    }

    const supabase = supabaseAdmin();
    await upsertDefaultsIfEmpty(supabase);

    const { data: keywords, error: keywordError } = await supabase
      .from('keywords')
      .select('*')
      .eq('enabled', true);
    if (keywordError) throw keywordError;

    const { data: sources, error: sourceError } = await supabase
      .from('sources')
      .select('*')
      .eq('enabled', true);
    if (sourceError) throw sourceError;

    const candidates = [];
    const errors = [];
    const tasks = [];

    for (const item of keywords || []) {
      tasks.push(
        { source: `Serper Search ${item.keyword}`, run: () => serper('search', item.keyword) },
        { source: `Serper News ${item.keyword}`, run: () => serper('news', `${item.keyword} 新聞`) },
        { source: `Serper Videos ${item.keyword}`, run: () => youtubeVideos(item.keyword) }
      );
    }

    let serperBlocked = false;
    await mapWithConcurrency(tasks, 2, async (task) => {
      if (serperBlocked) return;
      try {
        candidates.push(...await task.run());
      } catch (err) {
        if (err.message.includes('429')) {
          serperBlocked = true;
          if (!errors.some((item) => item.source === 'Serper API')) {
            errors.push({ source: 'Serper API', message: err.message });
          }
          return;
        }
        errors.push({ source: task.source, message: err.message });
      }
    });

    const sourcesToCollect = serperBlocked
      ? (sources || []).filter((source) => ['rss', 'sitemap', 'website', 'dcard', 'ptt'].includes(source.source_type))
      : sources || [];
    const sourceResults = await collectFromSources(sourcesToCollect);
    candidates.push(...sourceResults.results);
    errors.push(...sourceResults.errors);

    try {
      await enrichYouTubeMetadata(candidates);
    } catch (err) {
      errors.push({ source: 'YouTube Data API', message: err.message });
    }

    const { inserted, duplicates } = await insertArticles(supabase, candidates);

    return json(200, {
      ok: true,
      total: candidates.length,
      youtubeCandidates: candidates.filter((item) => item.platform === 'youtube').length,
      googleReviewCandidates: candidates.filter((item) => item.platform === 'google_reviews').length,
      inserted,
      duplicates,
      errors
    });
  } catch (err) {
    const status = err.message === '尚未登入' ? 401 : 500;
    return json(status, { error: err.message });
  }
}

export const config = {
  schedule: '@daily'
};
