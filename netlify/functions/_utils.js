import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import { XMLParser } from 'fast-xml-parser';

export const defaultKeywords = [
  ['花蓮', '其他'],
  ['花蓮觀光', '觀光'],
  ['花蓮旅遊', '觀光'],
  ['花蓮美食', '美食'],
  ['花蓮住宿', '住宿'],
  ['花蓮活動', '活動'],
  ['花蓮交通', '交通'],
  ['花蓮地震', '災害'],
  ['花蓮颱風', '災害'],
  ['花蓮災情', '災害'],
  ['花蓮景點', '觀光'],
  ['花蓮縣政府', '政策'],
  ['花蓮市公所', '政策'],
  ['太魯閣', '觀光'],
  ['七星潭', '觀光'],
  ['東大門夜市', '美食'],
  ['洄瀾網', '其他']
];

export const SOURCE_TYPES = Object.freeze([
  'rss',
  'sitemap',
  'google_news',
  'youtube',
  'facebook_page',
  'facebook_group',
  'google_reviews',
  'ptt',
  'dcard',
  'website'
]);

export function normalizeSourceType(value = 'rss') {
  const sourceType = String(value).trim().toLowerCase();
  if (!SOURCE_TYPES.includes(sourceType)) {
    throw new Error('不支援的來源類型');
  }
  return sourceType;
}

export function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify(body)
  };
}

export function parseBody(event) {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body);
  } catch {
    return {};
  }
}

export function supabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    throw new Error('Supabase 後端環境變數尚未設定');
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

export function verifyRequest(event) {
  const header = event.headers.authorization || event.headers.Authorization || '';
  const token = header.replace(/^Bearer\s+/i, '');
  if (!token) {
    throw new Error('尚未登入');
  }
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    throw new Error('尚未登入');
  }
}

export function guard(event) {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET 尚未設定');
  }
  return verifyRequest(event);
}

export function allowedMethod(event, methods) {
  return methods.includes(event.httpMethod);
}

export function cleanText(value = '') {
  const namedEntities = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"'
  };

  let text = String(value);
  for (let index = 0; index < 2; index += 1) {
    text = text
      .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
      .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
      .replace(/&(amp|apos|gt|lt|nbsp|quot);/gi, (_, name) => namedEntities[name.toLowerCase()]);
  }

  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export function classifyArticle(title = '', snippet = '') {
  const text = `${title} ${snippet}`;
  const rules = [
    ['觀光', ['觀光', '旅遊', '景點', '遊程']],
    ['美食', ['美食', '餐廳', '小吃', '夜市', '伴手禮']],
    ['住宿', ['飯店', '民宿', '住宿', '旅館']],
    ['交通', ['交通', '台鐵', '公路', '停車', '航班']],
    ['活動', ['活動', '展覽', '演唱會', '節慶', '市集']],
    ['災害', ['地震', '颱風', '豪雨', '災情', '封路']],
    ['政策', ['縣府', '公所', '政策', '補助', '公告']]
  ];

  const matched = rules.find(([, words]) => words.some((word) => text.includes(word)));
  return matched ? matched[0] : '其他';
}

export function estimateSentiment(title = '', snippet = '') {
  const text = `${title} ${snippet}`;
  if (['災情', '死亡', '受傷', '封路', '停班', '停課', '詐騙', '抗議', '負面'].some((word) => text.includes(word))) {
    return 'negative';
  }
  if (['推薦', '熱鬧', '開幕', '優惠', '好評', '獲獎'].some((word) => text.includes(word))) {
    return 'positive';
  }
  return 'neutral';
}

export function estimateImportance(category, title = '', snippet = '') {
  const text = `${title} ${snippet}`;
  if (category === '災害' || ['緊急', '災情', '封路', '地震', '颱風'].some((word) => text.includes(word))) {
    return 'urgent';
  }
  if (['縣府', '公告', '補助', '交通'].some((word) => text.includes(word))) {
    return 'high';
  }
  return 'medium';
}

export async function parseXmlFeed(url, sourceType = 'rss') {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'HualienOpinionPlatform/1.0'
    }
  });

  if (!response.ok) {
    throw new Error(`來源讀取失敗：${response.status}`);
  }

  const xml = await response.text();
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text'
  });
  const data = parser.parse(xml);

  if (sourceType === 'sitemap') {
    return asArray(data.urlset?.url).map((item) => ({
      title: item.loc,
      url: item.loc,
      snippet: '',
      published_at: item.lastmod || ''
    })).filter((item) => item.url);
  }

  const rssItems = asArray(data.rss?.channel?.item);
  const atomItems = asArray(data.feed?.entry);
  const items = rssItems.length > 0 ? rssItems : atomItems;

  return items.map((item) => {
    const link = typeof item.link === 'string'
      ? item.link
      : item.link?.['@_href'] || item.guid;
    return {
      title: cleanText(item.title?.['#text'] || item.title || link),
      url: link,
      snippet: cleanText(item.description || item.summary || item.content || ''),
      published_at: item.pubDate || item.published || item.updated || ''
    };
  }).filter((item) => item.url);
}

export async function fetchMeta(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'HualienOpinionPlatform/1.0'
    }
  });

  if (!response.ok) return null;
  const html = await response.text();
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '';
  const description =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i)?.[1] ||
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["'][^>]*>/i)?.[1] ||
    '';

  return {
    title: cleanText(title),
    description: cleanText(description)
  };
}

export function normalizeArticle(item) {
  const title = cleanText(item.title || '');
  const snippet = cleanText(item.snippet || item.summary || '');
  const category = item.category || classifyArticle(title, snippet);
  const sentiment = item.sentiment || estimateSentiment(title, snippet);

  return {
    title: title || item.url,
    url: item.url,
    source: item.source || '',
    platform: item.platform || 'web',
    category,
    snippet,
    summary: cleanText(item.summary || snippet),
    published_at: item.published_at || '',
    sentiment,
    importance: item.importance || estimateImportance(category, title, snippet),
    status: 'pending',
    is_broadcasted: false
  };
}

export async function upsertDefaultsIfEmpty(supabase) {
  const { count, error } = await supabase
    .from('keywords')
    .select('id', { count: 'exact', head: true });

  if (error || count !== 0) return;

  await supabase.from('keywords').insert(
    defaultKeywords.map(([keyword, category]) => ({ keyword, category, enabled: true }))
  );
}
