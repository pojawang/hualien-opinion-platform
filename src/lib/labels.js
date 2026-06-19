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
