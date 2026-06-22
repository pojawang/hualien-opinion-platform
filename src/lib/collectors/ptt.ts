export const PTT_BOARDS = ['Hualien', 'Travel', 'Food', 'Hotel'] as const;

type CollectorOptions = {
  supabase: any;
  keywords: string[];
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  delayMs?: number;
};

type PttIndexPost = {
  title: string;
  author: string;
  pushCount: number;
  publishedAt: string;
  url: string;
  externalId: string;
  board: string;
};

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function decodeHtml(value = '') {
  const entities: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"'
  };
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(amp|apos|gt|lt|nbsp|quot);/gi, (_, name) => entities[name.toLowerCase()])
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

function parsePushCount(value = '') {
  const text = decodeHtml(value);
  if (text.includes('爆')) return 100;
  if (/^X\d+$/i.test(text)) return 0;
  return Math.max(0, Number.parseInt(text, 10) || 0);
}

function publishedAtFromIndex(value = '') {
  const match = value.trim().match(/(\d{1,2})\/(\d{1,2})/);
  if (!match) return new Date().toISOString();

  const now = new Date();
  let year = now.getFullYear();
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month > now.getMonth() + 2) year -= 1;
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0)).toISOString();
}

function parseBoardIndex(html: string, board: string): PttIndexPost[] {
  return html.split('<div class="r-ent">').slice(1).map((segment) => {
    const linkMatch = segment.match(/<div class="title">[\s\S]*?<a href="([^"]+)">([\s\S]*?)<\/a>/i);
    if (!linkMatch) return null;

    const relativeUrl = linkMatch[1];
    const filename = relativeUrl.split('/').pop() || relativeUrl;
    const author = segment.match(/<div class="author">([\s\S]*?)<\/div>/i)?.[1] || '';
    const date = segment.match(/<div class="date">([\s\S]*?)<\/div>/i)?.[1] || '';
    const push = segment.match(/<div class="nrec">([\s\S]*?)<\/div>/i)?.[1] || '';

    return {
      title: decodeHtml(linkMatch[2]),
      author: decodeHtml(author),
      pushCount: parsePushCount(push),
      publishedAt: publishedAtFromIndex(decodeHtml(date)),
      url: `https://www.ptt.cc${relativeUrl}`,
      externalId: `ptt:${board}:${filename}`,
      board
    };
  }).filter(Boolean) as PttIndexPost[];
}

async function fetchBoard(
  board: string,
  fetchImpl: typeof fetch,
  timeoutMs: number
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(`https://www.ptt.cc/bbs/${board}/index.html`, {
      signal: controller.signal,
      headers: {
        Accept: 'text/html',
        Cookie: 'over18=1',
        'User-Agent': 'Mozilla/5.0 (compatible; HualienOpinionPlatform/1.0)'
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return parseBoardIndex(await response.text(), board);
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new Error('請求逾時');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPostPushCount(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        Accept: 'text/html',
        Cookie: 'over18=1',
        'User-Agent': 'Mozilla/5.0 (compatible; HualienOpinionPlatform/1.0)'
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    return (html.match(/<div\s+class=["']push["']/gi) || []).length;
  } finally {
    clearTimeout(timer);
  }
}

async function enrichPushCounts(
  rows: Array<Record<string, unknown>>,
  fetchImpl: typeof fetch,
  timeoutMs: number
) {
  const selectedRows = rows.slice(0, 10);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < selectedRows.length) {
      const index = nextIndex;
      nextIndex += 1;
      const row = selectedRows[index];
      try {
        row.push_count = await fetchPostPushCount(String(row.url), fetchImpl, timeoutMs);
      } catch {
        // Keep the board index count when an individual article cannot be read.
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(5, selectedRows.length) }, () => worker()));
}

export async function collectPttPosts(options: CollectorOptions) {
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs || 6000;
  const delayMs = Math.min(2000, Math.max(1000, options.delayMs || 1500));
  const keywords = options.keywords.map((keyword) => keyword.trim()).filter(Boolean);
  const collected = new Map<string, Record<string, unknown>>();
  const errors: Array<{ board: string; message: string }> = [];
  let scanned = 0;

  for (let index = 0; index < PTT_BOARDS.length; index += 1) {
    const board = PTT_BOARDS[index];
    try {
      const posts = await fetchBoard(board, fetchImpl, timeoutMs);
      scanned += posts.length;
      for (const post of posts) {
        if (!keywords.some((keyword) => post.title.includes(keyword))) continue;
        collected.set(post.externalId, {
          title: post.title,
          content: post.title,
          author: post.author,
          push_count: post.pushCount,
          url: post.url,
          source: 'ptt',
          source_name: post.board,
          external_id: post.externalId,
          published_at: post.publishedAt,
          sentiment: 'neutral',
          raw_data: post
        });
      }
    } catch (error: any) {
      errors.push({ board, message: error?.message || '未知錯誤' });
    }

    if (index < PTT_BOARDS.length - 1) await delay(delayMs);
  }

  const rows = Array.from(collected.values());
  await enrichPushCounts(rows, fetchImpl, timeoutMs);
  let upserted = 0;
  for (let index = 0; index < rows.length; index += 100) {
    const chunk = rows.slice(index, index + 100);
    const { data, error } = await options.supabase
      .from('posts')
      .upsert(chunk, { onConflict: 'external_id' })
      .select('external_id');
    if (error) {
      errors.push({ board: 'database', message: error.message });
      break;
    }
    upserted += data?.length || 0;
  }

  return { scanned, matched: rows.length, upserted, errors };
}
