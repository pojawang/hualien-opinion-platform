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
  const items = endpoint === 'news' ? data.news || [] : data.organic || [];
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

async function youtube(query) {
  if (!process.env.YOUTUBE_API_KEY) return [];

  const params = new URLSearchParams({
    part: 'snippet',
    q: query,
    type: 'video',
    maxResults: '10',
    regionCode: 'TW',
    relevanceLanguage: 'zh-Hant',
    key: process.env.YOUTUBE_API_KEY
  });

  const response = await fetchWithTimeout(`https://www.googleapis.com/youtube/v3/search?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`YouTube API 失敗：${response.status}`);
  }

  const data = await response.json();
  return (data.items || []).map((item) => ({
    title: item.snippet?.title,
    url: `https://www.youtube.com/watch?v=${item.id?.videoId}`,
    source: item.snippet?.channelTitle || 'YouTube',
    platform: 'youtube',
    snippet: item.snippet?.description || '',
    summary: item.snippet?.description || '',
    published_at: item.snippet?.publishedAt || '',
    thumbnail: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || ''
  })).filter((item) => item.url && !item.url.endsWith('undefined'));
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
      return tagSource(await youtube(sourceQuery(source)), source);
    case 'facebook_page':
      return tagSource(await serper('search', sourceQuery(source, 'site:facebook.com')), source);
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
  const seen = new Set();
  const articles = [];

  for (const candidate of candidates) {
    if (!candidate.url || seen.has(candidate.url)) {
      duplicates += 1;
      continue;
    }
    seen.add(candidate.url);

    articles.push(normalizeArticle(candidate));
  }

  let inserted = 0;
  for (let index = 0; index < articles.length; index += 100) {
    const chunk = articles.slice(index, index + 100);
    const { data, error } = await supabase
      .from('articles')
      .upsert(chunk, { onConflict: 'url', ignoreDuplicates: true })
      .select('url');
    if (error) throw error;
    const insertedCount = data?.length || 0;
    inserted += insertedCount;
    duplicates += chunk.length - insertedCount;
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
        { source: `Serper News ${item.keyword}`, run: () => serper('news', `${item.keyword} 新聞`) }
      );
    }

    const youtubeQueries = ['花蓮旅遊', '花蓮美食', '花蓮景點', '花蓮活動', '花蓮Vlog', '花蓮住宿'];
    for (const query of youtubeQueries) {
      tasks.push({ source: `YouTube ${query}`, run: () => youtube(query) });
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
