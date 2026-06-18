import { useEffect, useState } from 'react';
import ArticleCard from '../components/ArticleCard.jsx';
import { apiFetch } from '../lib/supabase.js';

const blankFilters = {
  status: '',
  category: '',
  source: '',
  q: ''
};

export default function Articles() {
  const [articles, setArticles] = useState([]);
  const [filters, setFilters] = useState(blankFilters);
  const [error, setError] = useState('');

  async function load(nextFilters = filters) {
    try {
      const params = new URLSearchParams();
      Object.entries(nextFilters).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });
      const data = await apiFetch(`articles?${params.toString()}`);
      setArticles(data.articles);
    } catch (err) {
      setError(err.message);
    }
  }

  async function updateArticle(id, payload) {
    await apiFetch('articles', { method: 'PATCH', body: JSON.stringify({ id, ...payload }) });
    load();
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="pageStack">
      <header className="pageHeader">
        <div>
          <h2>文章審核</h2>
          <p>篩選、審核與標記重要程度</p>
        </div>
      </header>
      {error && <div className="alert">{error}</div>}
      <section className="filters panel">
        <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
          <option value="">全部狀態</option>
          <option value="pending">待審核</option>
          <option value="approved">已核准</option>
          <option value="rejected">已拒絕</option>
        </select>
        <select value={filters.category} onChange={(event) => setFilters({ ...filters, category: event.target.value })}>
          <option value="">全部分類</option>
          {['觀光', '美食', '住宿', '交通', '活動', '災害', '政策', '其他'].map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
        <input
          placeholder="來源"
          value={filters.source}
          onChange={(event) => setFilters({ ...filters, source: event.target.value })}
        />
        <input
          placeholder="搜尋標題"
          value={filters.q}
          onChange={(event) => setFilters({ ...filters, q: event.target.value })}
        />
        <button onClick={() => load()}>套用</button>
        <button className="ghostButton" onClick={() => {
          setFilters(blankFilters);
          load(blankFilters);
        }}>清除</button>
      </section>
      <div className="cardList">
        {articles.map((article) => (
          <ArticleCard key={article.id} article={article} onUpdate={updateArticle} />
        ))}
        {articles.length === 0 && <div className="panel">目前沒有符合條件的文章。</div>}
      </div>
    </div>
  );
}
