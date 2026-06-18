import { NavLink, useNavigate } from 'react-router-dom';
import { clearToken } from '../lib/supabase.js';

const links = [
  { to: '/', label: 'Dashboard' },
  { to: '/search', label: '搜尋' },
  { to: '/articles', label: '文章審核' },
  { to: '/keywords', label: '關鍵字' },
  { to: '/sources', label: '來源' },
  { to: '/reports', label: '報表' }
];

export default function Navbar() {
  const navigate = useNavigate();

  function logout() {
    clearToken();
    navigate('/login');
  }

  return (
    <aside className="navbar">
      <div>
        <h1>花蓮輿情平台</h1>
        <p>Hualien Monitor</p>
      </div>
      <nav>
        {links.map((link) => (
          <NavLink key={link.to} to={link.to} end={link.to === '/'}>
            {link.label}
          </NavLink>
        ))}
      </nav>
      <button className="ghostButton" onClick={logout}>登出</button>
    </aside>
  );
}
