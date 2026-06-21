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

async function serper(endpoint, query) {
  if (!process.env.SERPER_API_KEY) return [];

  const response = await fetchWithTimeout(`https://google.serper.dev/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': process.env.SERPER_API_KEY
    },
    body: JSON.stringify({ q: query, gl: 'tw', hl: 'zh-tw', num: 10 })
  });

  if (!response.ok) {
    throw new Error(`Serper ${endpoint} 失敗：${response.status}`);
  }

  const data = await response.json();
  const items = endpoint === 'news'
    ? data.news || []
    : endpoint === 'videos'
      ? data.videos || []
      : data.organic || [];

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
      view_count: parseViewCount(item.views ?? item.viewCount ?? item.snippet),
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
      return tagSource(await serper('search', `${sourceQuery(source)} Google 評論`), source);
    case 'ptt':
      return tagSource(await serper('search', sourceQuery(source, 'site:ptt.cc')), source);
    case 'dcard':
      return tagSource(await serper('search', sourceQuery(source, 'site:dcard.tw')), source);
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
    const rowsToWrite = [];

    for (const article of chunk) {
      const existing = existingMap.get(article.url);
      if (!existing) {
        rowsToWrite.push(article);
        inserted += 1;
        continue;
      }

      duplicates += 1;
      if (article.platform === 'youtube') {
        rowsToWrite.push({
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
      }
    }

    if (rowsToWrite.length > 0) {
      const { error } = await supabase
        .from('articles')
        .upsert(rowsToWrite, { onConflict: 'url' });
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

    await mapWithConcurrency(tasks, 6, async (task) => {
      try {
        candidates.push(...await task.run());
      } catch (err) {
        errors.push({ source: task.source, message: err.message });
      }
    });

    const sourceResults = await collectFromSources(sources || []);
    candidates.push(...sourceResults.results);
    errors.push(...sourceResults.errors);

    const { inserted, duplicates } = await insertArticles(supabase, candidates);

    return json(200, {
      ok: true,
      total: candidates.length,
      youtubeCandidates: candidates.filter((item) => item.platform === 'youtube').length,
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
