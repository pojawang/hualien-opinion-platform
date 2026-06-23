import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

export function getToken() {
  return localStorage.getItem('hualien_token');
}

export function setToken(token) {
  localStorage.setItem('hualien_token', token);
}

export function setCurrentUser(user) {
  localStorage.setItem('hualien_user', JSON.stringify(user));
}

export function getCurrentUser() {
  try {
    const stored = JSON.parse(localStorage.getItem('hualien_user') || 'null');
    if (stored) return stored;
    const token = getToken();
    if (!token) return null;
    const segment = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(segment.padEnd(Math.ceil(segment.length / 4) * 4, '=')));
    return { id: payload.sub, username: payload.username, role: payload.role };
  } catch {
    return null;
  }
}

export function clearToken() {
  localStorage.removeItem('hualien_token');
  localStorage.removeItem('hualien_user');
}

export async function apiFetch(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  const token = getToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`/.netlify/functions/${path}`, {
    ...options,
    headers
  });

  const rawBody = await response.text();
  let data = {};
  try {
    data = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    data = {};
  }
  if (!response.ok) {
    if (response.status === 401 && path !== 'auth') {
      clearToken();
      sessionStorage.setItem('hualien_login_notice', '登入已逾期，請重新登入。');
      window.location.replace('/login');
      throw new Error('登入已逾期，請重新登入。');
    }
    const statusMessages = {
      502: '後端服務暫時無法回應，請稍後再試。（502）',
      504: '搜尋執行逾時，請稍後再試。（504）'
    };
    throw new Error(data.error || statusMessages[response.status] || `請求失敗（${response.status}）`);
  }
  return data;
}
