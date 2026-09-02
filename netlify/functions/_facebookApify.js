import crypto from 'node:crypto';
import {
  classifyArticle,
  cleanText,
  estimateImportance,
  estimateSentiment,
  supabaseAdmin
} from './_utils.js';

const RECENT_DAYS = 7;
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

function isGroupUrl(value = '') {
  return /facebook\.com\/groups\//i.test(String(value));
}

function actorPath(actorId = '') {
  return String(actorId).trim().replace(/\//g, '~');
}

function numberValue(...values) {
  for (const value of values) {
    if (Number.isFinite(Number(value))) return Math.max(0, Math.trunc(Number(value)));
    const text = String(value || '').replace(/,/g, '').trim();
    const match = text.match(/(\d+(?:\.\d+)?)\s*(萬|億|k|m)?/i);
    if (!match) continue;
    const multipliers = { 萬: 10000, 億: 100000000, k: 1000, m: 1000000 };
    return Math.max(0, Math.round(Number(match[1]) * (multipliers[match[2]?.toLowerCase()] || 1)));
  }
  return 0;
}

function textValue(...values) {
  return cleanText(values.find((value) => cleanText(value)) || '');
}

function dateValue(...values) {
  for (const value of values) {
    if (!value) continue;
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
    if (/^\d{10,13}$/.test(String(value))) {
      const number = Number(value);
      return new Date(String(value).length === 10 ? number * 1000 : number);
    }
  }
  return new Date();
}

function normalizeFacebookUrl(value = '') {
  try {
    const url = new URL(value, 'https://www.facebook.com');
    if (!/(^|\.)facebook\.com$/i.test(url.hostname)) return '';
    url.protocol = 'https:';
    url.hostname = 'www.facebook.com';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

function itemPostId(item, url) {
  const direct = textValue(item.post_id, item.postId, item.id, item.facebookId);
  if (direct) return direct;
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get('story_fbid')
      || parsed.searchParams.get('fbid')
      || parsed.pathname.match(/\/(?:posts|videos|reel)\/([^/?]+)/i)?.[1]
      || crypto.createHash('sha1').update(url).digest('hex');
  } catch {
    return crypto.createHash('sha1').update(url || JSON.stringify(item)).digest('hex');
  }
}

function itemImageUrl(item) {
  const direct = textValue(item.image_url, item.imageUrl, item.image, item.thumbnail, item.picture);
  if (direct) return direct;
  const media = Array.isArray(item.media) ? item.media[0] : null;
  return textValue(media?.url, media?.image, media?.thumbnail);
}

function configuredCategory(source, category) {
  if (source?.category && !['全部', '其他'].includes(source.category)) return source.category;
  return category;
}

function sourceIdentifier(value = '') {
  try {
    const parsed = new URL(value, 'https://www.facebook.com');
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    const groupIndex = pathParts.findIndex((part) => part.toLowerCase() === 'groups');
    if (groupIndex >= 0 && pathParts[groupIndex + 1]) return pathParts[groupIndex + 1].toLowerCase();
    const id = parsed.searchParams.get('id');
    if (id) return id.toLowerCase();
    return (pathParts[0] || '').toLowerCase();
  } catch {
    return '';
  }
}

function itemUrls(item) {
  return [
    item.postUrl,
    item.url,
    item.permalink,
    item.link,
    item.facebookUrl,
    item.pageUrl,
    item.profileUrl,
    item.groupUrl
  ].map((value) => normalizeFacebookUrl(textValue(value))).filter(Boolean);
}

function findSourceForItem(item, sources = []) {
  const urls = itemUrls(item);
  const itemIdentifiers = new Set(urls.map(sourceIdentifier).filter(Boolean));
  const sourceByIdentifier = new Map(
    sources
      .map((source) => [sourceIdentifier(source.page_url), source])
      .filter(([key]) => key)
  );

  for (const identifier of itemIdentifiers) {
    const source = sourceByIdentifier.get(identifier);
    if (source) return source;
  }

  const names = textValue(item.pageName, item.profileName, item.groupName, item.author, item.name);
  return sources.find((source) => source.page_name && names.includes(source.page_name))
    || sources.find((source) => urls.some((url) => preferredFacebookName(url) === source.page_name))
    || sources[0];
}

function matchesFacebookKeywords(title, content, keywords = DEFAULT_FACEBOOK_KEYWORDS) {
  const text = `${title || ''} ${content || ''}`.replace(/\s+/g, '').toLowerCase();
  return keywords.some((keyword) => {
    const normalized = String(keyword || '').replace(/\s+/g, '').toLowerCase();
    return normalized && text.includes(normalized);
  });
}

async function facebookKeywords(supabase) {
  const { data, error } = await supabase
    .from('keywords')
    .select('keyword')
    .eq('enabled', true);
  if (error) return DEFAULT_FACEBOOK_KEYWORDS;
  return [...new Set([...(data || []).map((item) => item.keyword), ...DEFAULT_FACEBOOK_KEYWORDS])]
    .map((keyword) => String(keyword || '').trim())
    .filter(Boolean);
}

export function apifyConfigured() {
  return Boolean(process.env.APIFY_TOKEN && (process.env.APIFY_FACEBOOK_PAGES_ACTOR_ID || process.env.APIFY_FACEBOOK_GROUPS_ACTOR_ID));
}

export function preferredFacebookName(url = '') {
  const text = String(url);
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

function buildActorInput(sources) {
  const maxPosts = Number(process.env.APIFY_FACEBOOK_MAX_POSTS || 10);
  const baseInput = process.env.APIFY_FACEBOOK_INPUT_JSON
    ? JSON.parse(process.env.APIFY_FACEBOOK_INPUT_JSON)
    : {};
  const urls = sources.map((source) => source.page_url);
  return {
    ...baseInput,
    startUrls: urls.map((url) => ({ url })),
    urls,
    maxPosts,
    resultsLimit: maxPosts,
    postsLimit: maxPosts
  };
}

async function runActor(actorId, sources, type) {
  const token = process.env.APIFY_TOKEN;
  const timeout = Number(process.env.APIFY_FACEBOOK_TIMEOUT_SECS || 20);
  const input = buildActorInput(sources);

  const response = await fetch(
    `https://api.apify.com/v2/acts/${actorPath(actorId)}/run-sync-get-dataset-items?timeout=${timeout}&clean=true&format=json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Hualien-Opinion-Platform'
      },
      body: JSON.stringify(input)
    }
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Apify ${type} 執行失敗：${response.status}${detail ? ` ${detail.slice(0, 180)}` : ''}`);
  }

  const payload = await response.json();
  return Array.isArray(payload) ? payload : [];
}

async function startActor(actorId, sources, type) {
  const token = process.env.APIFY_TOKEN;
  const response = await fetch(
    `https://api.apify.com/v2/acts/${actorPath(actorId)}/runs`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Hualien-Opinion-Platform'
      },
      body: JSON.stringify(buildActorInput(sources))
    }
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Apify ${type} 啟動失敗：${response.status}${detail ? ` ${detail.slice(0, 180)}` : ''}`);
  }

  const payload = await response.json();
  return payload.data || payload;
}

async function fetchRun(runId) {
  const response = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${encodeURIComponent(process.env.APIFY_TOKEN)}`, {
    headers: { 'User-Agent': 'Hualien-Opinion-Platform' }
  });
  if (!response.ok) throw new Error(`Apify run 狀態讀取失敗：${response.status}`);
  const payload = await response.json();
  return payload.data || payload;
}

async function fetchDatasetItems(datasetId) {
  const response = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${encodeURIComponent(process.env.APIFY_TOKEN)}&clean=true&format=json`, {
    headers: { 'User-Agent': 'Hualien-Opinion-Platform' }
  });
  if (!response.ok) throw new Error(`Apify dataset 讀取失敗：${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload) ? payload : [];
}

function toArticleRow(item, sources, type, keywords = DEFAULT_FACEBOOK_KEYWORDS) {
  const source = findSourceForItem(item, sources);
  const content = textValue(
    item.message,
    item.text,
    item.content,
    item.postText,
    item.caption,
    item.description
  );
  const title = textValue(item.title, content.split('\n')[0], `${source?.page_name || 'Facebook'} 貼文`).slice(0, 120);
  const url = normalizeFacebookUrl(textValue(item.postUrl, item.url, item.permalink, item.link, item.facebookUrl));
  if (!url || !content) return null;
  if (!matchesFacebookKeywords(title, content, keywords)) return null;

  const published = dateValue(item.created_time, item.createdTime, item.time, item.date, item.timestamp, item.published_at);
  const cutoff = Date.now() - RECENT_DAYS * 86400000;
  if (published.getTime() < cutoff || published.getTime() > Date.now() + 3600000) return null;

  const likes = numberValue(item.like_count, item.likeCount, item.likesCount, item.likes, item.reactionsCount, item.reactions);
  const comments = numberValue(item.comment_count, item.commentCount, item.commentsCount, item.comments);
  const shares = numberValue(item.share_count, item.shareCount, item.sharesCount, item.shares);
  const category = classifyArticle(title, content);
  const sentiment = estimateSentiment(title, content);
  const platform = type === 'group' ? 'facebook_group' : 'facebook_page';

  return {
    id: crypto.randomUUID(),
    title,
    url,
    source: source?.page_name || textValue(item.pageName, item.profileName, item.groupName, 'Facebook'),
    platform,
    category: configuredCategory(source, category),
    snippet: content,
    summary: content,
    post_id: itemPostId(item, url),
    image_url: itemImageUrl(item) || null,
    like_count: likes,
    comment_count: comments,
    share_count: shares,
    hotness_score: likes + comments * 2 + shares * 3,
    published_at: published.toISOString(),
    sentiment,
    importance: estimateImportance(category, title, content),
    status: 'pending',
    is_broadcasted: false,
    analysis_keywords: [],
    ai_analyzed: false
  };
}

async function upsertArticles(rows) {
  if (!rows.length) return 0;
  const supabase = supabaseAdmin();
  const urls = rows.map((row) => row.url);
  const { data: existing, error: lookupError } = await supabase
    .from('articles')
    .select('id, url, status, is_broadcasted')
    .in('url', urls);
  if (lookupError) throw lookupError;

  const existingByUrl = new Map((existing || []).map((row) => [row.url, row]));
  let changed = 0;

  for (const row of rows) {
    const previous = existingByUrl.get(row.url);
    if (previous) {
      const { error } = await supabase.from('articles').update({
        ...row,
        id: previous.id,
        status: previous.status,
        is_broadcasted: previous.is_broadcasted
      }).eq('id', previous.id);
      if (error) throw error;
      changed += 1;
    } else {
      const { error } = await supabase.from('articles').insert(row);
      if (error) throw error;
      changed += 1;
    }
  }

  return changed;
}

export async function startFacebookApifyRuns() {
  if (!process.env.APIFY_TOKEN) throw new Error('APIFY_TOKEN 尚未設定');

  const supabase = supabaseAdmin();
  const { data: configuredSources, error } = await supabase
    .from('facebook_pages')
    .select('*')
    .eq('enabled', true);
  if (error) throw error;

  const pages = (configuredSources || []).filter((source) => !isGroupUrl(source.page_url));
  const groups = (configuredSources || []).filter((source) => isGroupUrl(source.page_url));
  const runs = [];
  const errors = [];

  async function startFor(type, actorId, sources) {
    if (sources.length === 0) return;
    if (!actorId) {
      errors.push(type === 'page' ? 'Apify 粉專 Actor 尚未設定' : 'Apify 公開社團 Actor 尚未設定');
      return;
    }
    const run = await startActor(actorId, sources, type === 'page' ? '粉專' : '公開社團');
    const row = {
      actor_run_id: run.id,
      dataset_id: run.defaultDatasetId || null,
      source_kind: type,
      source_ids: sources.map((source) => source.id),
      status: run.status || 'RUNNING'
    };
    const { error: insertError } = await supabase.from('facebook_apify_runs').upsert(row, { onConflict: 'actor_run_id' });
    if (insertError) throw insertError;
    runs.push(row);
  }

  await startFor('page', process.env.APIFY_FACEBOOK_PAGES_ACTOR_ID, pages);
  await startFor('public_group', process.env.APIFY_FACEBOOK_GROUPS_ACTOR_ID, groups);

  return {
    ok: errors.length === 0,
    provider: 'apify',
    started: runs.length,
    runs,
    errors
  };
}

export async function syncFacebookApifyRuns() {
  if (!process.env.APIFY_TOKEN) throw new Error('APIFY_TOKEN 尚未設定');

  const supabase = supabaseAdmin();
  const { data: runs, error } = await supabase
    .from('facebook_apify_runs')
    .select('*')
    .in('status', ['READY', 'RUNNING'])
    .order('created_at', { ascending: true })
    .limit(10);
  if (error) throw error;

  const { data: configuredSources, error: sourceError } = await supabase
    .from('facebook_pages')
    .select('*')
    .eq('enabled', true);
  if (sourceError) throw sourceError;
  const keywords = await facebookKeywords(supabase);

  let matched = 0;
  let upserted = 0;
  let finished = 0;
  const errors = [];

  for (const storedRun of runs || []) {
    try {
      const run = await fetchRun(storedRun.actor_run_id);
      if (!['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(run.status)) {
        await supabase.from('facebook_apify_runs').update({ status: run.status || 'RUNNING' }).eq('id', storedRun.id);
        continue;
      }

      if (run.status !== 'SUCCEEDED') {
        await supabase.from('facebook_apify_runs').update({
          status: run.status,
          error_message: run.statusMessage || run.exitCode || 'Apify run 未成功'
        }).eq('id', storedRun.id);
        errors.push(`Apify ${storedRun.source_kind}：${run.status}`);
        finished += 1;
        continue;
      }

      const datasetId = run.defaultDatasetId || storedRun.dataset_id;
      const items = datasetId ? await fetchDatasetItems(datasetId) : [];
      const sources = (configuredSources || []).filter((source) => (storedRun.source_ids || []).includes(source.id));
      const type = storedRun.source_kind === 'public_group' ? 'group' : 'page';
      const rows = items.map((item) => toArticleRow(item, sources, type, keywords)).filter(Boolean);
      const changed = await upsertArticles(rows);
      matched += rows.length;
      upserted += changed;
      finished += 1;

      if (sources.length > 0) {
        await supabase.from('facebook_pages').update({
          last_fetch_at: new Date().toISOString(),
          collector: 'apify'
        }).in('id', sources.map((source) => source.id));
      }
      await supabase.from('facebook_apify_runs').update({
        status: 'IMPORTED',
        dataset_id: datasetId,
        imported_at: new Date().toISOString()
      }).eq('id', storedRun.id);
    } catch (err) {
      errors.push(err.message);
      await supabase.from('facebook_apify_runs').update({
        status: 'ERROR',
        error_message: err.message
      }).eq('id', storedRun.id);
    }
  }

  const pending = (runs || []).length - finished;
  return {
    ok: errors.length === 0,
    provider: 'apify',
    checked: runs?.length || 0,
    finished,
    pending: Math.max(0, pending),
    matched,
    upserted,
    errors
  };
}

export async function collectFacebookWithApify() {
  if (!process.env.APIFY_TOKEN) throw new Error('APIFY_TOKEN 尚未設定');

  const supabase = supabaseAdmin();
  const { data: configuredSources, error } = await supabase
    .from('facebook_pages')
    .select('*')
    .eq('enabled', true);
  if (error) throw error;
  const keywords = await facebookKeywords(supabase);

  const pages = (configuredSources || []).filter((source) => !isGroupUrl(source.page_url));
  const groups = (configuredSources || []).filter((source) => isGroupUrl(source.page_url));
  const rows = [];
  const errors = [];

  if (pages.length > 0) {
    if (!process.env.APIFY_FACEBOOK_PAGES_ACTOR_ID) {
      errors.push('Apify 粉專 Actor 尚未設定，粉專改用 Playwright 備援');
    } else {
      try {
        const items = await runActor(process.env.APIFY_FACEBOOK_PAGES_ACTOR_ID, pages, '粉專');
        rows.push(...items.map((item) => toArticleRow(item, pages, 'page', keywords)).filter(Boolean));
      } catch (err) {
        errors.push(err.message);
      }
    }
  }

  if (groups.length > 0) {
    if (!process.env.APIFY_FACEBOOK_GROUPS_ACTOR_ID) {
      errors.push('Apify 公開社團 Actor 尚未設定，公開社團無法使用 Playwright 備援');
    } else {
      try {
        const items = await runActor(process.env.APIFY_FACEBOOK_GROUPS_ACTOR_ID, groups, '公開社團');
        rows.push(...items.map((item) => toArticleRow(item, groups, 'group', keywords)).filter(Boolean));
      } catch (err) {
        errors.push(err.message);
      }
    }
  }

  const upserted = await upsertArticles(rows);
  const touchedIds = [...new Set(rows.map((row) => findSourceForItem(row, configuredSources || [])?.id).filter(Boolean))];
  if (touchedIds.length > 0) {
    await supabase.from('facebook_pages').update({ last_fetch_at: new Date().toISOString(), collector: 'apify' }).in('id', touchedIds);
  }

  return {
    ok: errors.length === 0,
    provider: 'apify',
    sources: configuredSources?.length || 0,
    matched: rows.length,
    upserted,
    errors
  };
}
