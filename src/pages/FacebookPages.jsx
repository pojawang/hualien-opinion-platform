import { useEffect, useState } from 'react';
import { apiFetch, getCurrentUser } from '../lib/supabase.js';

const categories = ['全部', '其他', '觀光', '美食', '住宿', '交通', '活動', '災害', '政策'];

export default function FacebookPages() {
  const canManage = getCurrentUser()?.role === 'admin';
  const [pages, setPages] = useState([]);
  const [pageUrl, setPageUrl] = useState('');
  const [collecting, setCollecting] = useState(false);
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
    setCollecting(true);
    setError('');
    setMessage('');
    try {
      const result = await apiFetch('trigger-facebook-collector', { method: 'POST' });
      setMessage(result.message || 'Facebook 巡查已啟動。');
    } catch (err) {
      setError(err.message);
    } finally {
      setCollecting(false);
    }
  }

  return (
    <div className="pageStack">
      <header className="pageHeader">
        <div>
          <h2>Facebook 監測來源</h2>
          <p>管理公開粉專並蒐集最近 7 日貼文</p>
        </div>
        {canManage && <button type="button" onClick={collectNow} disabled={collecting}>
          {collecting ? '啟動中...' : '開始巡查'}
        </button>}
      </header>
      {error && <div className="alert">{error}</div>}
      {message && <div className="notice">{message}</div>}
      {!canManage && <div className="readOnlyNotice">唯讀模式：僅管理員可巡查、新增、修改、停用或刪除 Facebook 來源。</div>}
      {canManage && <form className="panel facebookPageForm" onSubmit={create}>
        <input
          type="url"
          placeholder="https://www.facebook.com/粉專網址"
          value={pageUrl}
          onChange={(event) => setPageUrl(event.target.value)}
          required
        />
        <button>新增粉專</button>
      </form>}
      <section className="tablePanel">
        {pages.map((page) => (
          <div className={`facebookPageRow${canManage ? '' : ' readOnly'}`} key={page.id}>
            <div>
              <strong>{page.page_name || 'Facebook 粉專'}</strong>
              <a href={page.page_url} target="_blank" rel="noreferrer">{page.page_url}</a>
            </div>
            <select disabled={!canManage} value={page.category || '全部'} onChange={(event) => patch(page.id, { category: event.target.value })}>
              {categories.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
            <span>{page.last_fetch_at ? new Date(page.last_fetch_at).toLocaleString('zh-TW') : '尚未巡查'}</span>
            {canManage && <button type="button" onClick={() => patch(page.id, { enabled: !page.enabled })}>{page.enabled ? '停用' : '啟用'}</button>}
            {canManage && <button type="button" onClick={() => remove(page.id)}>刪除</button>}
          </div>
        ))}
        {pages.length === 0 && <p className="emptyState">目前沒有 Facebook 粉專監測來源。</p>}
      </section>
    </div>
  );
}
