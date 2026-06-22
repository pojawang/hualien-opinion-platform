export const DCARD_FORUMS = ['travel', 'food', 'talk', 'mood', 'trending'] as const;

export const HUALIEN_KEYWORDS = [
  '花蓮',
  '花蓮旅遊',
  '花蓮美食',
  '花蓮住宿',
  '花蓮景點',
  '太魯閣',
  '七星潭',
  '東大門夜市',
  '鯉魚潭',
  '瑞穗',
  '光復',
  '玉里',
  '壽豐',
  '吉安',
  '新城'
] as const;

type DcardPost = {
  id?: number | string;
  title?: string;
  excerpt?: string;
  content?: string;
  createdAt?: string;
  likeCount?: number;
  commentCount?: number;
  shareCount?: number;
  forumAlias?: string;
  forumName?: string;
  url?: string;
  [key: string]: unknown;
};

type CollectorOptions = {
  supabase: any;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  delayMs?: number;
  serperApiKey?: string;
};

const POSITIVE_WORDS = ['推薦', '好玩', '好吃', '漂亮', '喜歡', '值得'];
const NEGATIVE_WORDS = ['雷', '失望', '糟', '爛', '貴', '塞車', '排隊', '問題'];

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function sentimentOf(text: string) {
  if (POSITIVE_WORDS.some((word) => text.includes(word))) return 'positive';
  if (NEGATIVE_WORDS.some((word) => text.includes(word))) return 'negative';
  return 'neutral';
}

function matchesHualien(post: DcardPost) {
  const text = `${post.title || ''} ${post.excerpt || ''} ${post.content || ''}`;
  return HUALIEN_KEYWORDS.some((keyword) => text.includes(keyword));
}

async function fetchForumPosts(
  forumAlias: string,
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<DcardPost[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(
      `https://www.dcard.tw/service/api/v2/forums/${forumAlias}/posts?limit=100`,
      {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'Accept-Language': 'zh-TW,zh;q=0.9',
          Referer: `https://www.dcard.tw/f/${forumAlias}`,
          'User-Agent': 'Mozilla/5.0 (compatible; HualienOpinionPlatform/1.0)'
        }
      }
    );

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload)) throw new Error('Dcard API 回傳格式不正確');
    return payload;
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new Error('請求逾時');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSerperPosts(
  apiKey: string,
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<DcardPost[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl('https://google.serper.dev/search', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': apiKey
      },
      body: JSON.stringify({
        q: 'site:dcard.tw/f 花蓮',
        gl: 'tw',
        hl: 'zh-tw',
        num: 10
      })
    });
    if (!response.ok) throw new Error(`Serper HTTP ${response.status}`);
    const payload = await response.json();
    return (payload.organic || []).map((item: any) => {
      const url = String(item.link || '');
      const match = url.match(/dcard\.tw\/f\/([^/]+)\/p\/(\d+)/i);
      if (!match) return null;
      return {
        id: match[2],
        title: item.title || 'Dcard 貼文',
        excerpt: item.snippet || '',
        forumAlias: match[1],
        forumName: match[1],
        url
      };
    }).filter(Boolean) as DcardPost[];
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new Error('Serper 請求逾時');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPostDetail(
  post: DcardPost,
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<DcardPost> {
  if (!post.id) return post;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(`https://www.dcard.tw/service/api/v2/posts/${post.id}`, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'zh-TW,zh;q=0.9',
        Referer: post.url || 'https://www.dcard.tw/',
        'User-Agent': 'Mozilla/5.0 (compatible; HualienOpinionPlatform/1.0)'
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const detail = await response.json();
    return {
      ...post,
      ...detail,
      id: post.id,
      url: post.url,
      forumAlias: detail.forumAlias || post.forumAlias,
      forumName: detail.forumName || post.forumName
    };
  } finally {
    clearTimeout(timer);
  }
}

async function enrichPostDetails(posts: DcardPost[], fetchImpl: typeof fetch, timeoutMs: number) {
  const enriched: DcardPost[] = [];
  let failed = 0;
  for (let index = 0; index < posts.length; index += 3) {
    const results = await Promise.allSettled(
      posts.slice(index, index + 3).map((post) => fetchPostDetail(post, fetchImpl, timeoutMs))
    );
    results.forEach((result, offset) => {
      if (result.status === 'fulfilled') enriched.push(result.value);
      else {
        enriched.push(posts[index + offset]);
        failed += 1;
      }
    });
    if (index + 3 < posts.length) await delay(350);
  }
  return { posts: enriched, failed };
}

function toPostRow(post: DcardPost, forumAlias: string) {
  const externalId = String(post.id || '');
  const content = post.excerpt || post.content || '';
  const text = `${post.title || ''} ${content}`;

  return {
    title: post.title || content.slice(0, 100) || 'Dcard 貼文',
    content,
    url: post.url || `https://www.dcard.tw/f/${post.forumAlias || forumAlias}/p/${externalId}`,
    source: 'dcard',
    source_name: post.forumName || post.forumAlias || forumAlias,
    external_id: externalId,
    published_at: post.createdAt || null,
    like_count: post.likeCount == null ? null : Number(post.likeCount) || 0,
    comment_count: post.commentCount == null ? null : Number(post.commentCount) || 0,
    share_count: post.shareCount == null ? null : Number(post.shareCount) || 0,
    sentiment: sentimentOf(text),
    raw_data: post
  };
}

export async function collectDcardPosts(options: CollectorOptions) {
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs || 6000;
  const delayMs = Math.min(2000, Math.max(1000, options.delayMs || 1500));
  const collected = new Map<string, ReturnType<typeof toPostRow>>();
  const errors: Array<{ forum: string; message: string }> = [];
  let scanned = 0;
  let fallback: string | null = null;

  for (let index = 0; index < DCARD_FORUMS.length; index += 1) {
    const forum = DCARD_FORUMS[index];
    try {
      const posts = await fetchForumPosts(forum, fetchImpl, timeoutMs);
      scanned += posts.length;
      for (const post of posts) {
        if (!post.id || !matchesHualien(post)) continue;
        const row = toPostRow(post, forum);
        collected.set(row.external_id, row);
      }
    } catch (error: any) {
      if (String(error?.message).includes('HTTP 403') && options.serperApiKey) {
        try {
          const fallbackPosts = await fetchSerperPosts(options.serperApiKey, fetchImpl, timeoutMs);
          const detailResult = await enrichPostDetails(fallbackPosts, fetchImpl, timeoutMs);
          scanned += detailResult.posts.length;
          for (const post of detailResult.posts) {
            if (!post.id || !matchesHualien(post)) continue;
            const row = toPostRow(post, post.forumAlias || forum);
            collected.set(row.external_id, row);
          }
          if (detailResult.failed > 0) {
            errors.push({ forum: 'detail', message: `${detailResult.failed} 篇文章無法取得即時互動數` });
          }
          fallback = 'serper';
        } catch (fallbackError: any) {
          errors.push({ forum: 'serper', message: fallbackError?.message || 'Dcard 備援搜尋失敗' });
        }
        break;
      }
      errors.push({ forum, message: error?.message || '未知錯誤' });
    }

    if (index < DCARD_FORUMS.length - 1) await delay(delayMs);
  }

  const rows = Array.from(collected.values());
  let upserted = 0;
  for (let index = 0; index < rows.length; index += 100) {
    const chunk = rows.slice(index, index + 100);
    const { data, error } = await options.supabase
      .from('posts')
      .upsert(chunk, { onConflict: 'external_id' })
      .select('external_id');
    if (error) {
      errors.push({ forum: 'database', message: error.message });
      break;
    }
    upserted += data?.length || 0;
  }

  return { scanned, matched: rows.length, upserted, fallback, errors };
}
