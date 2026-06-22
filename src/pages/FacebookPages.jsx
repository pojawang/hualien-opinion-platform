import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/supabase.js';

const categories = ['其他', '觀光', '美食', '住宿', '交通', '活動', '災害', '政策'];

export default function FacebookPages() {
  const [pages, setPages] = useState([]);
  const [pageUrl, setPageUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load() {
    try {
      const data = await apiFetch('facebook-pages');
      setPages(data.pages || []);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function create(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    try {
      await apiFetch('facebook-pages', { method: 'POST', body: JSON.stringify({ page_url: pageUrl }) });
      setPageUrl('');
      setMessage('Facebook 粉專已加入監測。');
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function patch(id, payload) {
    setError('');
    try {
      await apiFetch('facebook-pages', { method: 'PATCH', body: JSON.stringify({ id, ...payload }) });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(id) {
    setError('');
    try {
      await apiFetch('facebook-pages', { method: 'DELETE', body: JSON.stringify({ id }) });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function collectNow() {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const result = await apiFetch('collect-facebook-pages', { method: 'POST' });
      setMessage(`巡查完成：找到 ${result.matched || 0} 則，新增或更新 ${result.upserted || 0} 則。`);
      if (result.errors?.length) setError(result.errors.map((item) => `${item.page}：${item.message}`).join('；'));
      await load();
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
          <h2>Facebook 監測來源</h2>
          <p>管理公開粉專並蒐集最近 7 日貼文</p>
        </div>
        <button type="button" onClick={collectNow} disabled={loading}>{loading ? '巡查中...' : '立即巡查'}</button>
      </header>
      {error && <div className="alert">{error}</div>}
      {message && <div className="notice">{message}</div>}
      <form className="panel facebookPageForm" onSubmit={create}>
        <input
          type="url"
          placeholder="https://www.facebook.com/粉專網址"
          value={pageUrl}
          onChange={(event) => setPageUrl(event.target.value)}
          required
        />
        <button>新增粉專</button>
      </form>
      <section className="tablePanel">
        {pages.map((page) => (
          <div className="facebookPageRow" key={page.id}>
            <div>
              <strong>{page.page_name || 'Facebook 粉專'}</strong>
              <a href={page.page_url} target="_blank" rel="noreferrer">{page.page_url}</a>
            </div>
            <select value={page.category || '其他'} onChange={(event) => patch(page.id, { category: event.target.value })}>
              {categories.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
            <span>{page.last_fetch_at ? new Date(page.last_fetch_at).toLocaleString('zh-TW') : '尚未巡查'}</span>
            <button type="button" onClick={() => patch(page.id, { enabled: !page.enabled })}>{page.enabled ? '停用' : '啟用'}</button>
            <button type="button" onClick={() => remove(page.id)}>刪除</button>
          </div>
        ))}
        {pages.length === 0 && <p className="emptyState">目前沒有 Facebook 粉專監測來源。</p>}
      </section>
    </div>
  );
}
