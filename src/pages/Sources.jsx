import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/supabase.js';
import { sourceTypeLabel, sourceTypeOptions } from '../lib/labels.js';

export default function Sources() {
  const [sources, setSources] = useState([]);
  const [form, setForm] = useState({ name: '', source_type: 'rss', url: '' });
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
    try {
      setError('');
      await apiFetch('sources', { method: 'POST', body: JSON.stringify(form) });
      setForm({ name: '', source_type: 'rss', url: '' });
      setMessage('來源新增成功');
      load();
    } catch (err) {
      setError(err.message);
    }
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
    try {
      setMessage('');
      setError('');
      const data = await apiFetch('sources', {
        method: 'PUT',
        body: JSON.stringify({ name: source.name, url: source.url, source_type: source.source_type })
      });
      setMessage(`${source.name}：${data.message}`);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="pageStack">
      <header className="pageHeader">
        <div>
          <h2>來源管理</h2>
          <p>管理 API、公開搜尋、RSS、Sitemap 與一般網站來源</p>
        </div>
      </header>
      {error && <div className="alert">{error}</div>}
      {message && <div className="notice">{message}</div>}
      <form className="formGrid panel" onSubmit={create}>
        <input placeholder="來源名稱" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
        <select value={form.source_type} onChange={(event) => setForm({ ...form, source_type: event.target.value })}>
          {sourceTypeOptions.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <input placeholder="URL" value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} required />
        <button>新增來源</button>
      </form>
      <section className="tablePanel">
        {sources.map((item) => (
          <div className="tableRow wide" key={item.id}>
            <strong>{item.name}</strong>
            <span>{sourceTypeLabel(item.source_type)}</span>
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
