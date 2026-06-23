import { NavLink, useNavigate } from 'react-router-dom';
import { clearToken, getCurrentUser } from '../lib/supabase.js';

const links = [
  { to: '/', label: '儀表板' },
  { to: '/search', label: '搜尋' },
  { to: '/articles', label: '文章審核' },
  { to: '/keywords', label: '關鍵字' },
  { to: '/sources', label: '來源' },
  { to: '/facebook-pages', label: 'Facebook監測' },
  { to: '/reports', label: '報表' },
  { to: '/users', label: '帳號管理', adminOnly: true }
];

export default function Navbar() {
  const navigate = useNavigate();
  const currentUser = getCurrentUser();

  function logout() {
    clearToken();
    navigate('/login');
  }

  return (
    <aside className="navbar">
      <div>
        <h1>花蓮輿情平台</h1>
        <p>花蓮輿情監測</p>
      </div>
      <nav>
        {links.filter((link) => !link.adminOnly || currentUser?.role === 'admin').map((link) => (
          <NavLink key={link.to} to={link.to} end={link.to === '/'}>
            {link.label}
          </NavLink>
        ))}
      </nav>
      <button className="ghostButton" onClick={logout}>登出</button>
    </aside>
  );
}
