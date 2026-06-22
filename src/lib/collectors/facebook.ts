type FacebookPage = {
  id: string;
  page_name?: string;
  page_url: string;
  category?: string;
};

type CollectorOptions = {
  supabase: any;
  pages: FacebookPage[];
  accessToken: string;
  apiVersion?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

const POSITIVE_WORDS = ['推薦', '喜歡', '好吃', '好玩', '漂亮', '值得', '成功', '歡迎', '感謝'];
const NEGATIVE_WORDS = ['失望', '糟', '爛', '危險', '災情', '塞車', '問題', '抗議', '不滿'];

function pageIdentifier(value: string) {
  try {
    const url = new URL(value);
    if (url.pathname.toLowerCase().startsWith('/groups/')) {
      return '__facebook_group__';
    }
    const queryId = url.searchParams.get('id');
    if (queryId) return queryId;
    const parts = url.pathname.split('/').filter(Boolean);
    const numericId = [...parts].reverse().find((part) => /^\d+$/.test(part));
    return numericId || parts[0] || '';
  } catch {
    return '';
  }
}

function friendlyGraphError(message: string) {
  if (/pages_read_engagement|Page Public Content Access|Page Public Metadata Access/i.test(message)) {
    return 'Meta 權限不足：Token 需要 pages_read_engagement，且 App 必須取得 Page Public Content Access 或 Page Public Metadata Access';
  }
  if (/Unsupported get request|Missing Permission|Object does not exist/i.test(message)) {
    return '無法讀取此粉專：請確認網址正確，且目前的 Meta App 與 Token 有權存取該粉專';
  }
  return message;
}

function classify(text: string, preferred = '') {
  if (preferred && preferred !== '其他') return preferred;
  if (/(觀光|旅遊|景點|遊程)/.test(text)) return '觀光';
  if (/(美食|餐廳|小吃|夜市|伴手禮)/.test(text)) return '美食';
  if (/(飯店|民宿|住宿|旅館)/.test(text)) return '住宿';
  if (/(交通|台鐵|公路|停車|航班)/.test(text)) return '交通';
  if (/(活動|展覽|演唱會|節慶|市集)/.test(text)) return '活動';
  if (/(地震|颱風|豪雨|災情|封路)/.test(text)) return '災害';
  if (/(縣府|公所|政策|補助|公告)/.test(text)) return '政策';
  return '其他';
}

function sentiment(text: string) {
  const positive = POSITIVE_WORDS.filter((word) => text.includes(word)).length;
  const negative = NEGATIVE_WORDS.filter((word) => text.includes(word)).length;
  if (negative > positive) return 'negative';
  if (positive > negative) return 'positive';
  return 'neutral';
}

async function graphRequest(
  path: string,
  params: Record<string, string>,
  options: CollectorOptions
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 8000);
  const version = /^v\d+\.\d+$/.test(options.apiVersion || '') ? options.apiVersion : 'v23.0';
  const query = new URLSearchParams(params);
  try {
    const response = await (options.fetchImpl || fetch)(
      `https://graph.facebook.com/${version}/${path}?${query.toString()}`,
      {
        signal: controller.signal,
        headers: { Authorization: `Bearer ${options.accessToken}` }
      }
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) {
      throw new Error(payload.error?.message || `HTTP ${response.status}`);
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function upsertArticles(supabase: any, rows: Array<Record<string, unknown>>) {
  if (rows.length === 0) return 0;
  const urls = rows.map((row) => String(row.url));
  const { data: existingRows, error: lookupError } = await supabase
    .from('articles')
    .select('*')
    .in('url', urls);
  if (lookupError) throw lookupError;

  const existingMap = new Map((existingRows || []).map((row: any) => [row.url, row]));
  const merged = rows.map((row) => {
    const existing = existingMap.get(row.url);
    return existing
      ? { ...existing, ...row, status: existing.status, is_broadcasted: existing.is_broadcasted }
      : row;
  });
  const { data, error } = await supabase
    .from('articles')
    .upsert(merged, { onConflict: 'url' })
    .select('url');
  if (error) throw error;
  return data?.length || 0;
}

export async function collectFacebookPages(options: CollectorOptions) {
  if (!options.accessToken) throw new Error('FACEBOOK_PAGE_ACCESS_TOKEN 尚未設定');
  const cutoff = new Date(Date.now() - 7 * 86400000);
  const rows = new Map<string, Record<string, unknown>>();
  const errors: Array<{ page: string; message: string }> = [];
  let scanned = 0;

  for (const configuredPage of options.pages) {
    try {
      const identifier = pageIdentifier(configuredPage.page_url);
      if (identifier === '__facebook_group__') throw new Error('此監測只支援 Facebook 粉專，不支援社團');
      if (!identifier) throw new Error('無法辨識粉專網址');
      const page = await graphRequest(encodeURIComponent(identifier), { fields: 'id,name' }, options);
      const posts = await graphRequest(`${encodeURIComponent(page.id)}/posts`, {
        fields: 'id,message,created_time,permalink_url,full_picture,reactions.limit(0).summary(true),comments.limit(0).summary(true),shares',
        since: String(Math.floor(cutoff.getTime() / 1000)),
        limit: '100'
      }, options);

      for (const post of posts.data || []) {
        if (!post.created_time || new Date(post.created_time) < cutoff) continue;
        const message = String(post.message || '').trim();
        const url = post.permalink_url || `https://www.facebook.com/${post.id}`;
        rows.set(url, {
          title: message.slice(0, 90) || `${page.name || configuredPage.page_name || 'Facebook 粉專'}貼文`,
          url,
          source: page.name || configuredPage.page_name || 'Facebook 粉專',
          platform: 'facebook_page',
          category: classify(message, configuredPage.category),
          snippet: message,
          summary: message,
          post_id: post.id,
          image_url: post.full_picture || null,
          like_count: Number(post.reactions?.summary?.total_count) || 0,
          comment_count: Number(post.comments?.summary?.total_count) || 0,
          share_count: Number(post.shares?.count) || 0,
          published_at: post.created_time,
          sentiment: sentiment(message),
          importance: 'medium',
          status: 'pending',
          is_broadcasted: false
        });
      }
      scanned += posts.data?.length || 0;
      const { error: pageError } = await options.supabase
        .from('facebook_pages')
        .update({ page_name: page.name || configuredPage.page_name, last_fetch_at: new Date().toISOString() })
        .eq('id', configuredPage.id);
      if (pageError) throw pageError;
    } catch (error: any) {
      errors.push({
        page: configuredPage.page_name || configuredPage.page_url,
        message: friendlyGraphError(error?.message || '讀取失敗')
      });
    }
  }

  const upserted = await upsertArticles(options.supabase, Array.from(rows.values()));
  return { scanned, matched: rows.size, upserted, errors };
}
