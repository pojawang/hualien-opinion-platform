import {
  fetchMeta,
  guard,
  json,
  normalizeArticle,
  parseXmlFeed,
  supabaseAdmin,
  upsertDefaultsIfEmpty
} from './_utils.js';

async function serper(endpoint, query) {
  if (!process.env.SERPER_API_KEY) return [];

  const response = await fetch(`https://google.serper.dev/${endpoint}`, {
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

  const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params.toString()}`);
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

async function collectFromSources(sources) {
  const results = [];
  const errors = [];

  for (const source of sources) {
    try {
      const items = await parseXmlFeed(source.url, source.source_type);
      for (const item of items.slice(0, 25)) {
        let enriched = item;
        if (!item.snippet || item.title === item.url) {
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
        results.push({
          ...enriched,
          source: source.name,
          platform: source.platform || source.source_type
        });
      }
    } catch (err) {
      errors.push({ source: source.name || source.url, message: err.message });
    }
  }

  return { results, errors };
}

async function insertArticles(supabase, candidates) {
  let inserted = 0;
  let duplicates = 0;
  const seen = new Set();

  for (const candidate of candidates) {
    if (!candidate.url || seen.has(candidate.url)) {
      duplicates += 1;
      continue;
    }
    seen.add(candidate.url);

    const article = normalizeArticle(candidate);
    const { error } = await supabase.from('articles').insert(article);

    if (!error) {
      inserted += 1;
      continue;
    }

    if (error.code === '23505' || error.message?.includes('duplicate')) {
      duplicates += 1;
      continue;
    }

    throw error;
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

    for (const item of keywords || []) {
      try {
        candidates.push(...await serper('search', item.keyword));
      } catch (err) {
        errors.push({ source: `Serper Search ${item.keyword}`, message: err.message });
      }

      try {
        candidates.push(...await serper('news', `${item.keyword} 新聞`));
      } catch (err) {
        errors.push({ source: `Serper News ${item.keyword}`, message: err.message });
      }
    }

    const youtubeQueries = ['花蓮旅遊', '花蓮美食', '花蓮景點', '花蓮活動', '花蓮Vlog', '花蓮住宿'];
    for (const query of youtubeQueries) {
      try {
        candidates.push(...await youtube(query));
      } catch (err) {
        errors.push({ source: `YouTube ${query}`, message: err.message });
      }
    }

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
