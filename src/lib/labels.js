const importanceLabels = {
  low: '低',
  medium: '中',
  high: '高',
  urgent: '緊急'
};

const sentimentLabels = {
  positive: '正面',
  neutral: '中立',
  negative: '負面'
};

const platformLabels = {
  web: '網頁',
  news: '新聞',
  youtube: 'YouTube',
  rss: 'RSS',
  sitemap: '網站地圖'
};

export function importanceLabel(value = 'medium') {
  return importanceLabels[value] || value;
}

export function sentimentLabel(value = 'neutral') {
  return sentimentLabels[value] || value;
}

export function platformLabel(value = 'web') {
  return platformLabels[value.toLowerCase?.()] || value;
}

export function localizeSentimentCounts(items = []) {
  return items.map((item) => ({ ...item, name: sentimentLabel(item.name) }));
}

export function cleanArticleText(value, fallback = '') {
  if (!value) return fallback;

  let text = String(value);
  for (let index = 0; index < 2; index += 1) {
    const document = new DOMParser().parseFromString(text, 'text/html');
    const decoded = document.documentElement.textContent || '';
    if (decoded === text) break;
    text = decoded;
  }

  return text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim() || fallback;
}

export function publishedAtLabel(value) {
  if (!value) return '未提供';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return cleanArticleText(value, '未提供');

  return new Intl.DateTimeFormat('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}
