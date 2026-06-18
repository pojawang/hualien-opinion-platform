import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/supabase.js';

export default function Sources() {
  const [sources, setSources] = useState([]);
  const [form, setForm] = useState({ name: '', source_type: 'rss', url: '', platform: 'web' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load() {
    try {
      const data = await apiFetch('sources');
      setSources(data.sources);
    } catch (err) {
      setError(err.message);
    }
  }

  async function create(event) {
    event.preventDefault();
    await apiFetch('sources', { method: 'POST', body: JSON.stringify(form) });
    setForm({ name: '', source_type: 'rss', url: '', platform: 'web' });
    load();
  }

  async function patchSource(id, payload) {
    await apiFetch('sources', { method: 'PATCH', body: JSON.stringify({ id, ...payload }) });
    load();
  }

  async function remove(id) {
    await apiFetch('sources', { method: 'DELETE', body: JSON.stringify({ id }) });
    load();
  }

  async function testSource(source) {
    setMessage('');
    const data = await apiFetch('sources', { method: 'PUT', body: JSON.stringify({ url: source.url, source_type: source.source_type }) });
    setMessage(`${source.name} 可讀取，找到 ${data.count} 筆項目`);
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="pageStack">
      <header className="pageHeader">
        <div>
          <h2>來源管理</h2>
          <p>RSS 與 Sitemap 來源設定</p>
        </div>
      </header>
      {error && <div className="alert">{error}</div>}
      {message && <div className="notice">{message}</div>}
      <form className="formGrid panel" onSubmit={create}>
        <input placeholder="來源名稱" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
        <select value={form.source_type} onChange={(event) => setForm({ ...form, source_type: event.target.value })}>
          <option value="rss">RSS</option>
          <option value="sitemap">Sitemap</option>
        </select>
        <input placeholder="URL" value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} required />
        <input placeholder="平台" value={form.platform} onChange={(event) => setForm({ ...form, platform: event.target.value })} />
        <button>新增來源</button>
      </form>
      <section className="tablePanel">
        {sources.map((item) => (
          <div className="tableRow wide" key={item.id}>
            <strong>{item.name}</strong>
            <span>{item.source_type}</span>
            <span className="truncate">{item.url}</span>
            <span>{item.enabled ? '啟用' : '停用'}</span>
            <button onClick={() => testSource(item)}>測試</button>
            <button onClick={() => patchSource(item.id, { enabled: !item.enabled })}>{item.enabled ? '停用' : '啟用'}</button>
            <button onClick={() => remove(item.id)}>刪除</button>
          </div>
        ))}
      </section>
    </div>
  );
}
