import { useEffect, useState } from 'react';
import { apiFetch, getCurrentUser } from '../lib/supabase.js';

export default function Keywords() {
  const canManage = getCurrentUser()?.role === 'admin';
  const [keywords, setKeywords] = useState([]);
  const [form, setForm] = useState({ keyword: '', category: '其他' });
  const [error, setError] = useState('');

  async function load() {
    try {
      const data = await apiFetch('keywords');
      setKeywords(data.keywords);
    } catch (err) {
      setError(err.message);
    }
  }

  async function create(event) {
    event.preventDefault();
    await apiFetch('keywords', { method: 'POST', body: JSON.stringify(form) });
    setForm({ keyword: '', category: '其他' });
    load();
  }

  async function patchKeyword(id, payload) {
    await apiFetch('keywords', { method: 'PATCH', body: JSON.stringify({ id, ...payload }) });
    load();
  }

  async function remove(id) {
    await apiFetch('keywords', { method: 'DELETE', body: JSON.stringify({ id }) });
    load();
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="pageStack">
      <header className="pageHeader">
        <div>
          <h2>關鍵字管理</h2>
          <p>新增、停用、刪除與分類設定</p>
        </div>
      </header>
      {error && <div className="alert">{error}</div>}
      {!canManage && <div className="readOnlyNotice">唯讀模式：僅管理員可新增、停用或刪除關鍵字。</div>}
      {canManage && <form className="formRow panel" onSubmit={create}>
        <input
          placeholder="關鍵字"
          value={form.keyword}
          onChange={(event) => setForm({ ...form, keyword: event.target.value })}
          required
        />
        <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
          {['觀光', '美食', '住宿', '交通', '活動', '災害', '政策', '其他'].map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
        <button>新增</button>
      </form>}
      <section className="tablePanel">
        {keywords.map((item) => (
          <div className={`tableRow${canManage ? '' : ' readOnly'}`} key={item.id}>
            <strong>{item.keyword}</strong>
            <span>{item.category || '其他'}</span>
            <span>{item.enabled ? '啟用' : '停用'}</span>
            {canManage && <button onClick={() => patchKeyword(item.id, { enabled: !item.enabled })}>
              {item.enabled ? '停用' : '啟用'}
            </button>}
            {canManage && <button onClick={() => remove(item.id)}>刪除</button>}
          </div>
        ))}
      </section>
    </div>
  );
}
