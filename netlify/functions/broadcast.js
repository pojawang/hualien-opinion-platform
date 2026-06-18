import { guard, json, supabaseAdmin } from './_utils.js';

function buildMessage(article) {
  return [
    '【花蓮輿情快訊】',
    `分類：${article.category || '其他'}`,
    `標題：${article.title}`,
    `來源：${article.source || article.platform || '未知來源'}`,
    `摘要：${article.summary || article.snippet || '無摘要'}`,
    `連結：${article.url}`
  ].join('\n');
}

async function sendLineMessage(messages) {
  if (!process.env.LINE_CHANNEL_ACCESS_TOKEN || !process.env.LINE_GROUP_ID) {
    throw new Error('LINE 環境變數尚未設定');
  }

  const response = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      to: process.env.LINE_GROUP_ID,
      messages: messages.map((text) => ({ type: 'text', text }))
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LINE 推播失敗：${response.status} ${body}`);
  }

  return response.headers.get('x-line-request-id') || '';
}

export async function handler(event) {
  try {
    guard(event);

    if (event.httpMethod !== 'POST') {
      return json(405, { error: 'Method not allowed' });
    }

    const supabase = supabaseAdmin();
    const { data: articles, error } = await supabase
      .from('articles')
      .select('*')
      .eq('status', 'approved')
      .eq('is_broadcasted', false)
      .order('category', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(5);

    if (error) throw error;
    if (!articles || articles.length === 0) {
      return json(200, { ok: true, sent: 0, message: '沒有待推播文章' });
    }

    const lineMessageId = await sendLineMessage(articles.map(buildMessage));
    const ids = articles.map((article) => article.id);

    const { error: updateError } = await supabase
      .from('articles')
      .update({ is_broadcasted: true })
      .in('id', ids);
    if (updateError) throw updateError;

    const { error: broadcastError } = await supabase.from('broadcasts').insert(
      articles.map((article) => ({
        article_id: article.id,
        line_message_id: lineMessageId
      }))
    );
    if (broadcastError) throw broadcastError;

    return json(200, { ok: true, sent: articles.length, lineMessageId });
  } catch (err) {
    const status = err.message === '尚未登入' ? 401 : 500;
    return json(status, { error: err.message });
  }
}
