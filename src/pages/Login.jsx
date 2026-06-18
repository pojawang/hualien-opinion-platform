import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, setToken } from '../lib/supabase.js';

export default function Login() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError('');

    try {
      const data = await apiFetch('auth', {
        method: 'POST',
        body: JSON.stringify(form)
      });
      setToken(data.token);
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="loginPage">
      <form className="loginPanel" onSubmit={submit}>
        <h1>花蓮輿情平台</h1>
        <p>後台管理登入</p>
        {error && <div className="alert">{error}</div>}
        <label>
          帳號
          <input
            value={form.username}
            onChange={(event) => setForm({ ...form, username: event.target.value })}
            required
          />
        </label>
        <label>
          密碼
          <input
            type="password"
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
            required
          />
        </label>
        <button disabled={loading}>{loading ? '登入中...' : '登入'}</button>
      </form>
    </main>
  );
}
