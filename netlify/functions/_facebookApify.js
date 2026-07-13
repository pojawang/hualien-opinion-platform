import crypto from 'node:crypto';
import {
  classifyArticle,
  cleanText,
  estimateImportance,
  estimateSentiment,
  supabaseAdmin
} from './_utils.js';

const RECENT_DAYS = 7;

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

function findSourceForItem(item, sources) {
  const rawUrl = textValue(item.pageUrl, item.profileUrl, item.facebookUrl, item.groupUrl, item.url);
  return sources.find((source) => rawUrl && rawUrl.includes(new URL(source.page_url).pathname.split('/').filter(Boolean)[0]))
    || sources.find((source) => textValue(item.pageName, item.profileName, item.groupName, item.author, item.name).includes(source.page_name || ''))
    || sources[0];
}

export function apifyConfigured() {
  return Boolean(process.env.APIFY_TOKEN && (process.env.APIFY_FACEBOOK_PAGES_ACTOR_ID || process.env.APIFY_FACEBOOK_GROUPS_ACTOR_ID));
}

async function runActor(actorId, sources, type) {
  const token = process.env.APIFY_TOKEN;
  const timeout = Number(process.env.APIFY_FACEBOOK_TIMEOUT_SECS || 120);
  const maxPosts = Number(process.env.APIFY_FACEBOOK_MAX_POSTS || 10);
  const baseInput = process.env.APIFY_FACEBOOK_INPUT_JSON
    ? JSON.parse(process.env.APIFY_FACEBOOK_INPUT_JSON)
    : {};
  const urls = sources.map((source) => source.page_url);
  const input = {
    ...baseInput,
    startUrls: urls.map((url) => ({ url })),
    urls,
    maxPosts,
    resultsLimit: maxPosts,
    postsLimit: maxPosts
  };

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

function toArticleRow(item, sources, type) {
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

export async function collectFacebookWithApify() {
  if (!process.env.APIFY_TOKEN) throw new Error('APIFY_TOKEN 尚未設定');

  const supabase = supabaseAdmin();
  const { data: configuredSources, error } = await supabase
    .from('facebook_pages')
    .select('*')
    .eq('enabled', true);
  if (error) throw error;

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
        rows.push(...items.map((item) => toArticleRow(item, pages, 'page')).filter(Boolean));
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
        rows.push(...items.map((item) => toArticleRow(item, groups, 'group')).filter(Boolean));
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
