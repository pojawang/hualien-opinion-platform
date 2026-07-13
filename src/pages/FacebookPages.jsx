import { useEffect, useState } from 'react';
import { apiFetch, getCurrentUser } from '../lib/supabase.js';

const categories = ['全部', '其他', '觀光', '美食', '住宿', '交通', '活動', '災害', '政策'];
const sourceKinds = [
  ['page', 'Facebook 粉專'],
  ['public_group', 'Facebook 公開社團']
];

function sourceKindLabel(value) {
  return sourceKinds.find(([key]) => key === value)?.[1] || 'Facebook 粉專';
}

function collectorLabel(value) {
  if (value === 'apify') return 'Apify';
  if (value === 'playwright') return 'Playwright 備援';
  return '尚未巡查';
}

export default function FacebookPages() {
  const canManage = getCurrentUser()?.role === 'admin';
  const [pages, setPages] = useState([]);
  const [pageUrl, setPageUrl] = useState('');
  const [sourceKind, setSourceKind] = useState('page');
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
      await apiFetch('facebook-pages', {
        method: 'POST',
        body: JSON.stringify({ page_url: pageUrl, source_kind: sourceKind })
      });
      setPageUrl('');
      setSourceKind('page');
      setMessage('Facebook 監測來源已加入。');
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
      await load();
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
          <p>Apify 優先巡查公開粉專與公開社團，Playwright 保留為粉專備援。</p>
        </div>
        {canManage && <button type="button" onClick={collectNow} disabled={collecting}>
          {collecting ? '巡查中...' : '開始巡查'}
        </button>}
      </header>
      {error && <div className="alert">{error}</div>}
      {message && <div className="notice">{message}</div>}
      {!canManage && <div className="readOnlyNotice">唯讀模式：僅管理員可巡查、新增、修改、停用或刪除 Facebook 來源。</div>}
      {canManage && <form className="panel facebookPageForm" onSubmit={create}>
        <select value={sourceKind} onChange={(event) => setSourceKind(event.target.value)}>
          {sourceKinds.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <input
          type="url"
          placeholder="https://www.facebook.com/粉專代號 或 https://www.facebook.com/groups/公開社團代號"
          value={pageUrl}
          onChange={(event) => setPageUrl(event.target.value)}
          required
        />
        <button>新增來源</button>
      </form>}
      <section className="tablePanel">
        {pages.map((page) => (
          <div className={`facebookPageRow${canManage ? '' : ' readOnly'}`} key={page.id}>
            <div>
              <strong>{page.page_name || 'Facebook 來源'}</strong>
              <a href={page.page_url} target="_blank" rel="noreferrer">{page.page_url}</a>
              <small>{sourceKindLabel(page.source_kind)} · {collectorLabel(page.collector)}</small>
            </div>
            <select disabled={!canManage} value={page.source_kind || 'page'} onChange={(event) => patch(page.id, { source_kind: event.target.value })}>
              {sourceKinds.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select disabled={!canManage} value={page.category || '其他'} onChange={(event) => patch(page.id, { category: event.target.value })}>
              {categories.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
            <span>{page.last_fetch_at ? new Date(page.last_fetch_at).toLocaleString('zh-TW') : '尚未巡查'}</span>
            {canManage && <button type="button" onClick={() => patch(page.id, { enabled: !page.enabled })}>{page.enabled ? '停用' : '啟用'}</button>}
            {canManage && <button type="button" onClick={() => remove(page.id)} className="dangerButton">刪除</button>}
          </div>
        ))}
        {pages.length === 0 && <p className="emptyState">目前沒有 Facebook 監測來源。</p>}
      </section>
    </div>
  );
}
