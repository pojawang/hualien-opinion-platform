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

export function clearToken() {
  localStorage.removeItem('hualien_token');
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

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && path !== 'auth') {
      clearToken();
      sessionStorage.setItem('hualien_login_notice', '登入已逾期，請重新登入。');
      window.location.replace('/login');
      throw new Error('登入已逾期，請重新登入。');
    }
    throw new Error(data.error || '請求失敗');
  }
  return data;
}
