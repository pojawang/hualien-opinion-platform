import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/supabase.js';

export default function Reports() {
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');

  async function load() {
    try {
      setReport(await apiFetch('stats?report=daily'));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (error) return <div className="alert">{error}</div>;
  if (!report) return <div className="panel">載入中...</div>;

  const sections = [
    ['今日重點新聞', report.headlines],
    ['負面議題', report.negative],
    ['觀光相關文章', report.tourism],
    ['美食相關文章', report.food],
    ['活動相關文章', report.events]
  ];

  return (
    <div className="pageStack">
      <header className="pageHeader">
        <div>
          <h2>每日輿情摘要</h2>
          <p>依今日文章彙整重點主題</p>
        </div>
        <button onClick={load}>重新產生</button>
      </header>
      <section className="panel">
        <h3>熱門分類</h3>
        <div className="chips">
          {report.topCategories.map((item) => (
            <span key={item.name}>{item.name}：{item.value}</span>
          ))}
        </div>
      </section>
      {sections.map(([title, items]) => (
        <section className="panel" key={title}>
          <h3>{title}</h3>
          <div className="reportList">
            {items.map((article) => (
              <a key={article.id} href={article.url} target="_blank" rel="noreferrer">
                <strong>{article.title}</strong>
                <span>{article.source || article.platform || '未知來源'} · {article.category || '其他'}</span>
              </a>
            ))}
            {items.length === 0 && <p>今日尚無資料。</p>}
          </div>
        </section>
      ))}
    </div>
  );
}
