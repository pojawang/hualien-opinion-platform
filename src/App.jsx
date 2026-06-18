import { Navigate, Route, Routes } from 'react-router-dom';
import Navbar from './components/Navbar.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Search from './pages/Search.jsx';
import Articles from './pages/Articles.jsx';
import Keywords from './pages/Keywords.jsx';
import Sources from './pages/Sources.jsx';
import Reports from './pages/Reports.jsx';
import { getToken } from './lib/supabase.js';

function PrivateRoute({ children }) {
  if (!getToken()) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="shell">
      <Navbar />
      <main className="main">{children}</main>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
      <Route path="/search" element={<PrivateRoute><Search /></PrivateRoute>} />
      <Route path="/articles" element={<PrivateRoute><Articles /></PrivateRoute>} />
      <Route path="/keywords" element={<PrivateRoute><Keywords /></PrivateRoute>} />
      <Route path="/sources" element={<PrivateRoute><Sources /></PrivateRoute>} />
      <Route path="/reports" element={<PrivateRoute><Reports /></PrivateRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
