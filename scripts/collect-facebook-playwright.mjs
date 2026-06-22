import crypto from 'node:crypto';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY'];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing environment variable: ${name}`);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false }
});
const cutoff = new Date(Date.now() - 7 * 86400000);
const categories = ['觀光', '美食', '住宿', '交通', '活動', '災害', '政策', '其他'];
const positiveWords = ['推薦', '喜歡', '好吃', '好玩', '漂亮', '值得', '成功', '歡迎', '感謝', '精彩'];
const negativeWords = ['失望', '糟', '爛', '危險', '災情', '塞車', '問題', '抗議', '不滿', '受損'];

function metricNumber(value = '') {
  const text = String(value).replace(/,/g, '').trim();
  const match = text.match(/(\d+(?:\.\d+)?)\s*(萬|億|[kKmM])?/);
  if (!match) return 0;
  const multipliers = { 萬: 1e4, 億: 1e8, k: 1e3, m: 1e6 };
  return Math.max(0, Math.round(Number(match[1]) * (multipliers[(match[2] || '').toLowerCase()] || 1)));
}

function metricFromText(text, labels) {
  for (const label of labels) {
    const after = text.match(new RegExp(`${label}\\s*[：:]?\\s*([\\d,.]+\\s*(?:萬|億|[kKmM])?)`, 'i'));
    if (after) return metricNumber(after[1]);
    const before = text.match(new RegExp(`([\\d,.]+\\s*(?:萬|億|[kKmM])?)\\s*(?:個|則|次)?\\s*${label}`, 'i'));
    if (before) return metricNumber(before[1]);
  }
  return 0;
}

function parsePublishedAt(value = '') {
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d{10,13}$/.test(text)) {
    const number = Number(text);
    return new Date(text.length === 10 ? number * 1000 : number);
  }
  const direct = Date.parse(text);
  if (!Number.isNaN(direct)) return new Date(direct);
  const relative = text.match(/(\d+)\s*(分鐘|小時|天|日|週|周)\s*前?/);
  if (relative) {
    const units = { 分鐘: 60000, 小時: 3600000, 天: 86400000, 日: 86400000, 週: 604800000, 周: 604800000 };
    return new Date(Date.now() - Number(relative[1]) * units[relative[2]]);
  }
  if (/剛剛|just now/i.test(text)) return new Date();
  const monthDay = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (monthDay) {
    const now = new Date();
    let year = now.getFullYear();
    const date = new Date(year, Number(monthDay[1]) - 1, Number(monthDay[2]));
    if (date > now) date.setFullYear(--year);
    return date;
  }
  return null;
}

function normalizePostUrl(value = '') {
  try {
    const url = new URL(value, 'https://www.facebook.com');
    if (url.hostname === 'l.facebook.com' && url.searchParams.get('u')) return normalizePostUrl(url.searchParams.get('u'));
    if (!/(^|\.)facebook\.com$/i.test(url.hostname)) return '';
    url.protocol = 'https:';
    url.hostname = 'www.facebook.com';
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (!['story_fbid', 'id', 'fbid', 'v'].includes(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return '';
  }
}

function postLinkScore(anchor) {
  const href = anchor.href || '';
  if (!/(^|\.)facebook\.com\//i.test(href)) return -1;
  if (/comment_id=|reply_comment_id=|\/comments\/?(?:\?|$)/i.test(href)) return -1;

  const context = `${anchor.text} ${anchor.label} ${anchor.title}`;
  let score = /分鐘|小時|天|日|月|週|剛剛|ago|yesterday/i.test(context) ? 120 : 0;
  if (/story_fbid=|\/posts\//i.test(href)) score += 100;
  else if (/\/permalink\/|\/share\/p\//i.test(href)) score += 90;
  else if (/\/reel\/|\/videos\/|\/share\/v\//i.test(href)) score += 60;
  else if (/\/photo(?:\.php|\/)|fbid=|\/watch\/?\?v=/i.test(href)) score += 40;
  else return -1;
  return score;
}

function facebookPostId(value) {
  try {
    const url = new URL(value);
    return url.searchParams.get('story_fbid')
      || url.searchParams.get('fbid')
      || url.searchParams.get('v')
      || url.pathname.match(/\/(?:posts|videos|reel)\/([^/?]+)/i)?.[1]
      || url.pathname.match(/\/share\/(?:p|v)\/([^/?]+)/i)?.[1]
      || crypto.createHash('sha1').update(value).digest('hex');
  } catch {
    return crypto.createHash('sha1').update(value).digest('hex');
  }
}

function fallbackAnalysis(text, engagement) {
  const positive = positiveWords.filter((word) => text.includes(word)).length;
  const negative = negativeWords.filter((word) => text.includes(word)).length;
  const sentiment = negative > positive ? 'negative' : positive > negative ? 'positive' : 'neutral';
  const categoryRules = [
    ['災害', /(地震|颱風|豪雨|災情|封路)/], ['住宿', /(飯店|民宿|住宿|旅館)/],
    ['美食', /(美食|餐廳|小吃|夜市|伴手禮)/], ['交通', /(交通|台鐵|公路|停車|航班)/],
    ['活動', /(活動|展覽|演唱會|節慶|市集)/], ['政策', /(縣府|公所|政策|補助|公告)/],
    ['觀光', /(觀光|旅遊|景點|遊程)/]
  ];
  const category = categoryRules.find(([, pattern]) => pattern.test(text))?.[0] || '其他';
  const hashtags = [...text.matchAll(/#([^\s#，。！？]+)/g)].map((match) => match[1]);
  const known = ['花蓮', '太魯閣', '七星潭', '東大門夜市', '觀光', '美食', '住宿', '交通', '活動', '地震', '颱風', '政策']
    .filter((word) => text.includes(word));
  return {
    sentiment,
    category,
    keywords: [...new Set([...hashtags, ...known])].slice(0, 10),
    hotness_score: engagement.likes + engagement.comments * 2 + engagement.shares * 3,
    ai_analyzed: false
  };
}

async function analyzeText(text, engagement) {
  const fallback = fallbackAnalysis(text, engagement);
  if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_MODEL || !text) return fallback;
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL,
        input: `分析以下花蓮 Facebook 公開貼文。輸出情緒 positive/neutral/negative、分類 ${categories.join('/')}、最多10個繁中關鍵字。\n\n${text.slice(0, 5000)}`,
        text: { format: { type: 'json_schema', name: 'facebook_analysis', strict: true, schema: {
          type: 'object', additionalProperties: false,
          properties: {
            sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
            category: { type: 'string', enum: categories },
            keywords: { type: 'array', items: { type: 'string' }, maxItems: 10 }
          }, required: ['sentiment', 'category', 'keywords']
        } } }
      })
    });
    if (!response.ok) throw new Error(`AI HTTP ${response.status}`);
    const payload = await response.json();
    const outputText = payload.output?.flatMap((item) => item.content || []).find((item) => item.type === 'output_text')?.text;
    const parsed = JSON.parse(outputText || '{}');
    return { ...fallback, sentiment: parsed.sentiment, category: parsed.category, keywords: parsed.keywords || [], ai_analyzed: true };
  } catch (error) {
    console.warn(`AI analysis fallback: ${error.message}`);
    return fallback;
  }
}

async function dismissOverlays(page) {
  for (const label of ['允許所有 Cookie', 'Allow all cookies', '關閉', 'Close', '稍後再說', 'Not now']) {
    await page.getByRole('button', { name: label, exact: false }).first().click({ timeout: 800 }).catch(() => {});
  }
  await page.keyboard.press('Escape').catch(() => {});
}

async function scrapePage(page, configuredPage) {
  await page.goto(configuredPage.page_url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await dismissOverlays(page);
  const found = new Map();
  let articleCount = 0;

  for (let pass = 0; pass < 10; pass += 1) {
    const snapshots = await page.locator('[role="article"]').evaluateAll((articles) => articles.map((article) => {
      const messageNode = article.querySelector('[data-ad-preview="message"], [data-ad-comet-preview="message"]');
      const autoTexts = [...article.querySelectorAll('div[dir="auto"]')]
        .map((node) => node.textContent?.trim() || '')
        .filter((text) => text.length > 10 && text.length < 8000)
        .sort((a, b) => b.length - a.length);
      const anchors = [...article.querySelectorAll('a[href]')].map((anchor, order) => ({
        href: anchor.href,
        text: anchor.textContent?.trim() || '',
        label: anchor.getAttribute('aria-label') || '',
        title: anchor.getAttribute('title') || '',
        order
      }));
      const timeNode = article.querySelector('time[datetime], abbr[data-utime], [data-utime]');
      const timeAnchor = timeNode?.closest('a[href]') || timeNode?.parentElement?.closest('a[href]');
      const timeHref = timeAnchor?.href || '';
      const timeValue = timeNode?.getAttribute('datetime') || timeNode?.getAttribute('data-utime')
        || anchors.map((anchor) => `${anchor.label} ${anchor.title} ${anchor.text}`).find((text) => /分鐘|小時|天|日|月|週|剛剛|ago|yesterday/i.test(text)) || '';
      return {
        message: messageNode?.textContent?.trim() || autoTexts[0] || '',
        timeHref,
        anchors,
        timeValue,
        metricsText: `${article.innerText} ${[...article.querySelectorAll('[aria-label]')].map((node) => node.getAttribute('aria-label')).join(' ')}`
      };
    }));
    articleCount = Math.max(articleCount, snapshots.length);

    for (const snapshot of snapshots) {
      const timeUrl = normalizePostUrl(snapshot.timeHref);
      const rankedLink = [...snapshot.anchors]
        .map((anchor) => ({ anchor, score: postLinkScore(anchor) }))
        .filter((candidate) => candidate.score >= 0)
        .sort((a, b) => b.score - a.score || a.anchor.order - b.anchor.order)[0]?.anchor.href;
      const postUrl = postLinkScore({ href: timeUrl, text: snapshot.timeValue, label: '', title: '' }) >= 0
        ? timeUrl
        : normalizePostUrl(rankedLink);
      const published = parsePublishedAt(snapshot.timeValue);
      if (!postUrl || !snapshot.message || !published || published < cutoff || published > new Date()) continue;
      const likes = metricFromText(snapshot.metricsText, ['讚', 'likes?']);
      const comments = metricFromText(snapshot.metricsText, ['留言', 'comments?']);
      const shares = metricFromText(snapshot.metricsText, ['分享', 'shares?']);
      found.set(postUrl, { ...snapshot, postUrl, published, likes, comments, shares });
    }

    await page.mouse.wheel(0, 1800);
    await page.waitForTimeout(1200);
  }
  if (articleCount === 0) throw new Error('未找到公開貼文，頁面可能要求登入或限制自動瀏覽');
  return [...found.values()];
}

async function upsertRows(rows) {
  if (!rows.length) return 0;
  const { data: existing, error: lookupError } = await supabase
    .from('articles')
    .select('*')
    .eq('platform', 'facebook_page')
    .gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString());
  if (lookupError) throw lookupError;
  const byUrl = new Map((existing || []).map((row) => [row.url, row]));
  const byIdentity = new Map((existing || []).map((row) => [`${row.source}\n${row.title}`, row]));
  const inserts = [];
  let updated = 0;

  for (const row of rows) {
    const previous = byUrl.get(row.url) || byIdentity.get(`${row.source}\n${row.title}`);
    if (!previous) {
      inserts.push(row);
      continue;
    }
    const { error } = await supabase.from('articles').update({
      ...row,
      status: previous.status,
      is_broadcasted: previous.is_broadcasted
    }).eq('id', previous.id);
    if (error) throw error;
    updated += 1;
  }

  if (!inserts.length) return updated;
  const { data, error } = await supabase.from('articles').upsert(inserts, { onConflict: 'url' }).select('url');
  if (error) throw error;
  return updated + (data?.length || 0);
}

const { data: configuredPages, error: pagesError } = await supabase.from('facebook_pages').select('*').eq('enabled', true);
if (pagesError) throw pagesError;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ locale: 'zh-TW', timezoneId: 'Asia/Taipei', viewport: { width: 1440, height: 1100 } });
const rows = [];
const errors = [];

try {
  for (const configuredPage of configuredPages || []) {
    if (/facebook\.com\/groups\//i.test(configuredPage.page_url)) {
      errors.push(`${configuredPage.page_name || configuredPage.page_url}: 不支援 Facebook 社團`);
      continue;
    }
    const page = await context.newPage();
    try {
      const posts = await scrapePage(page, configuredPage);
      for (const post of posts) {
        const analysis = await analyzeText(post.message, { likes: post.likes, comments: post.comments, shares: post.shares });
        const postId = facebookPostId(post.postUrl);
        rows.push({
          title: post.message.split('\n')[0].slice(0, 90), url: post.postUrl,
          source: configuredPage.page_name || 'Facebook 粉專', platform: 'facebook_page',
          category: configuredPage.category !== '其他' ? configuredPage.category : analysis.category,
          snippet: post.message, summary: post.message, post_id: postId,
          like_count: post.likes, comment_count: post.comments, share_count: post.shares,
          published_at: post.published.toISOString(), sentiment: analysis.sentiment,
          importance: analysis.hotness_score >= 1000 ? 'high' : 'medium', status: 'pending', is_broadcasted: false,
          hotness_score: analysis.hotness_score, analysis_keywords: analysis.keywords, ai_analyzed: analysis.ai_analyzed
        });
      }
      await supabase.from('facebook_pages').update({ last_fetch_at: new Date().toISOString() }).eq('id', configuredPage.id);
      console.log(`${configuredPage.page_name || configuredPage.page_url}: ${posts.length} posts`);
    } catch (error) {
      errors.push(`${configuredPage.page_name || configuredPage.page_url}: ${error.message}`);
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}

const upserted = await upsertRows(rows);
console.log(JSON.stringify({ pages: configuredPages?.length || 0, matched: rows.length, upserted, errors }, null, 2));
if (errors.length) process.exitCode = 2;
