import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/supabase.js';

const emptyForm = { username: '', password: '', role: 'user' };

export default function Users() {
  const [users, setUsers] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [currentUserId, setCurrentUserId] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    try {
      setError('');
      const data = await apiFetch('users');
      setUsers(data.users || []);
      setCurrentUserId(data.currentUserId || '');
      setDrafts(Object.fromEntries((data.users || []).map((user) => [user.id, {
        username: user.username,
        role: user.role,
        password: ''
      }])));
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
      await apiFetch('users', { method: 'POST', body: JSON.stringify(form) });
      setForm(emptyForm);
      setMessage('帳號已新增。');
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  function updateDraft(id, field, value) {
    setDrafts((current) => ({ ...current, [id]: { ...current[id], [field]: value } }));
  }

  async function save(user) {
    setError('');
    setMessage('');
    try {
      const draft = drafts[user.id];
      await apiFetch('users', {
        method: 'PATCH',
        body: JSON.stringify({ id: user.id, username: draft.username, role: draft.role, password: draft.password })
      });
      setMessage(`已更新帳號 ${draft.username}。`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleEnabled(user) {
    setError('');
    setMessage('');
    try {
      await apiFetch('users', {
        method: 'PATCH',
        body: JSON.stringify({ id: user.id, enabled: !user.enabled })
      });
      setMessage(`帳號已${user.enabled ? '停用' : '啟用'}。`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(user) {
    if (!window.confirm(`確定刪除帳號「${user.username}」？`)) return;
    setError('');
    setMessage('');
    try {
      await apiFetch('users', { method: 'DELETE', body: JSON.stringify({ id: user.id }) });
      setMessage('帳號已刪除。');
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="pageStack">
      <header className="pageHeader">
        <div>
          <h2>帳號管理</h2>
          <p>新增、修改、啟停與刪除後台使用者</p>
        </div>
      </header>
      {error && <div className="alert">{error}</div>}
      {message && <div className="notice">{message}</div>}
      <form className="panel userCreateForm" onSubmit={create}>
        <input
          placeholder="帳號（至少 3 個字元）"
          value={form.username}
          onChange={(event) => setForm({ ...form, username: event.target.value })}
          required
        />
        <input
          type="password"
          placeholder="密碼（至少 8 個字元）"
          value={form.password}
          onChange={(event) => setForm({ ...form, password: event.target.value })}
          minLength={8}
          required
        />
        <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>
          <option value="user">一般使用者</option>
          <option value="admin">管理員</option>
        </select>
        <button>新增帳號</button>
      </form>
      <section className="tablePanel userTable">
        {users.map((user) => {
          const draft = drafts[user.id] || { username: user.username, role: user.role, password: '' };
          const isSelf = user.id === currentUserId;
          return (
            <div className="userRow" key={user.id}>
              <div className="userIdentity">
                <input value={draft.username} onChange={(event) => updateDraft(user.id, 'username', event.target.value)} />
                <span>{isSelf ? '目前登入帳號' : user.enabled ? '啟用中' : '已停用'}</span>
              </div>
              <select value={draft.role} disabled={isSelf} onChange={(event) => updateDraft(user.id, 'role', event.target.value)}>
                <option value="user">一般使用者</option>
                <option value="admin">管理員</option>
              </select>
              <input
                type="password"
                placeholder="輸入新密碼才會重設"
                value={draft.password}
                onChange={(event) => updateDraft(user.id, 'password', event.target.value)}
                minLength={8}
              />
              <button type="button" onClick={() => save(user)}>儲存</button>
              <button type="button" disabled={isSelf} onClick={() => toggleEnabled(user)}>{user.enabled ? '停用' : '啟用'}</button>
              <button type="button" className="dangerButton" disabled={isSelf} onClick={() => remove(user)}>刪除</button>
            </div>
          );
        })}
        {users.length === 0 && <p className="emptyState">目前沒有使用者帳號。</p>}
      </section>
    </div>
  );
}
