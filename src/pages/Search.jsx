import { useState } from 'react';
import { apiFetch } from '../lib/supabase.js';

export default function Search() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  async function runSearch() {
    setLoading(true);
    setError('');
    setResult(null);

    try {
      setResult(await apiFetch('search', { method: 'POST' }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="pageStack">
      <header className="pageHeader">
        <div>
          <h2>搜尋蒐集</h2>
          <p>手動執行 Serper Search、News、Videos、RSS 與 Sitemap 蒐集</p>
        </div>
        <button onClick={runSearch} disabled={loading}>{loading ? '蒐集中...' : '開始搜尋'}</button>
      </header>
      {error && <div className="alert">{error}</div>}
      {result && (
        <section className="panel">
          <h3>本次結果</h3>
          <div className="resultGrid">
            <span>新增：<strong>{result.inserted}</strong></span>
            <span>重複略過：<strong>{result.duplicates}</strong></span>
            <span>候選資料：<strong>{result.total}</strong></span>
          </div>
          {result.errors?.length > 0 && (
            <div className="alert">
              {result.errors.map((item) => <p key={`${item.source}-${item.message}`}>{item.source}: {item.message}</p>)}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
