import { useEffect, useState } from 'react';
import { BarChart, Bar, CartesianGrid, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from 'recharts';
import ArticleCard from '../components/ArticleCard.jsx';
import StatCard from '../components/StatCard.jsx';
import { apiFetch } from '../lib/supabase.js';

const pieColors = ['#0f766e', '#d97706', '#b91c1c'];

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');

  async function load() {
    try {
      setStats(await apiFetch('stats'));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (error) return <div className="alert">{error}</div>;
  if (!stats) return <div className="panel">載入中...</div>;

  return (
    <div className="pageStack">
      <header className="pageHeader">
        <div>
          <h2>Dashboard</h2>
          <p>今日輿情與審核狀態總覽</p>
        </div>
      </header>
      <section className="statsGrid">
        <StatCard label="今日新增" value={stats.todayCount} />
        <StatCard label="待審核" value={stats.pendingCount} />
        <StatCard label="已核准" value={stats.approvedCount} />
        <StatCard label="已拒絕" value={stats.rejectedCount} />
        <StatCard label="已推播" value={stats.broadcastedCount} />
      </section>
      <section className="chartGrid">
        <div className="panel">
          <h3>分類數量</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={stats.categoryCounts}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="value" fill="#0f766e" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="panel">
          <h3>情緒比例</h3>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={stats.sentimentCounts} dataKey="value" nameKey="name" outerRadius={90} label>
                {stats.sentimentCounts.map((entry, index) => (
                  <Cell key={entry.name} fill={pieColors[index % pieColors.length]} />
                ))}
              </Pie>
              <Legend />
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </section>
      <section className="panel">
        <h3>最新 10 筆文章</h3>
        <div className="cardList">
          {stats.latestArticles.map((article) => (
            <ArticleCard key={article.id} article={article} onUpdate={async (id, payload) => {
              await apiFetch('articles', { method: 'PATCH', body: JSON.stringify({ id, ...payload }) });
              load();
            }} />
          ))}
        </div>
      </section>
    </div>
  );
}
