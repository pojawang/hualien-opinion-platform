import { useEffect, useState } from 'react';
import {
  BarChart,
  Bar,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell
} from 'recharts';
import ArticleCard from '../components/ArticleCard.jsx';
import StatCard from '../components/StatCard.jsx';
import { apiFetch } from '../lib/supabase.js';
import { cleanArticleText, importanceLabel, localizeSentimentCounts } from '../lib/labels.js';

const pieColors = ['#0f766e', '#d97706', '#b91c1c'];

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');
  const [selectedKeyword, setSelectedKeyword] = useState('');
  const [loading, setLoading] = useState(false);

  async function load(keyword = selectedKeyword) {
    try {
      setLoading(true);
      setError('');
      const query = keyword ? `?keyword=${encodeURIComponent(keyword)}` : '';
      setStats(await apiFetch(`stats${query}`));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (error) return <div className="alert">{error}</div>;
  if (!stats) return <div className="panel">載入中...</div>;

  const sentimentCounts = localizeSentimentCounts(stats.sentimentCounts);

  return (
    <div className="pageStack">
      <header className="pageHeader">
        <div>
          <h2>儀表板</h2>
          <p>{selectedKeyword ? `「${selectedKeyword}」相關輿情總覽` : '今日輿情與審核狀態總覽'}</p>
        </div>
        <label className="keywordPicker">
          <span>關鍵字</span>
          <select
            value={selectedKeyword}
            disabled={loading}
            onChange={(event) => {
              const keyword = event.target.value;
              setSelectedKeyword(keyword);
              load(keyword);
            }}
          >
            <option value="">全部關鍵字</option>
            {stats.keywords.map((keyword) => <option key={keyword} value={keyword}>{keyword}</option>)}
          </select>
        </label>
      </header>
      <section className="statsGrid">
        <StatCard label="今日新增" value={stats.todayCount} />
        <StatCard label="待審核" value={stats.pendingCount} />
        <StatCard label="已核准" value={stats.approvedCount} />
        <StatCard label="已拒絕" value={stats.rejectedCount} />
        <StatCard label="已推播" value={stats.broadcastedCount} />
      </section>
      <section className="panel summaryPanel">
        <div className="sectionHeading">
          <div>
            <h3>AI 每日摘要</h3>
            <span>{selectedKeyword || '全部關鍵字'}</span>
          </div>
        </div>
        <p>{stats.dailySummary}</p>
      </section>
      <section className="chartGrid">
        <div className="panel">
          <h3>聲量趨勢</h3>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={stats.volumeTrend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis allowDecimals={false} />
              <Tooltip formatter={(value) => [`${value} 則`, '聲量']} />
              <Line type="monotone" dataKey="value" name="聲量" stroke="#0f766e" strokeWidth={3} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="panel">
          <h3>情緒比例</h3>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={sentimentCounts} dataKey="value" nameKey="name" outerRadius={90} label>
                {sentimentCounts.map((entry, index) => (
                  <Cell key={entry.name} fill={pieColors[index % pieColors.length]} />
                ))}
              </Pie>
              <Legend />
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </section>
      <section className="chartGrid">
        <div className="panel">
          <h3>熱門關鍵字排行榜</h3>
          <ol className="keywordRanking">
            {stats.popularKeywords.map((item, index) => (
              <li key={item.name}>
                <strong>{index + 1}</strong>
                <span>{item.name}</span>
                <b>{item.value} 則</b>
              </li>
            ))}
          </ol>
          {stats.popularKeywords.length === 0 && <p className="emptyState">目前沒有關鍵字聲量。</p>}
        </div>
        <div className="panel warningPanel">
          <div className="sectionHeading">
            <h3>負評預警</h3>
            <span>{stats.negativeAlerts.length} 則</span>
          </div>
          <div className="warningList">
            {stats.negativeAlerts.map((article) => (
              <a key={article.id} href={article.url} target="_blank" rel="noreferrer">
                <span>{cleanArticleText(article.title, '未命名文章')}</span>
                <small>{article.category || '其他'} · 重要程度：{importanceLabel(article.importance)}</small>
              </a>
            ))}
          </div>
          {stats.negativeAlerts.length === 0 && <p className="emptyState">目前沒有負面預警。</p>}
        </div>
      </section>
      <section className="panel">
        <h3>分類數量</h3>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={stats.categoryCounts}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis allowDecimals={false} />
            <Tooltip formatter={(value) => [`${value} 則`, '文章數']} />
            <Bar dataKey="value" fill="#0f766e" />
          </BarChart>
        </ResponsiveContainer>
      </section>
      <section className="panel">
        <h3>{selectedKeyword ? `「${selectedKeyword}」最新文章` : '最新 10 筆文章'}</h3>
        <div className="cardList">
          {stats.latestArticles.map((article) => (
            <ArticleCard key={article.id} article={article} onUpdate={async (id, payload) => {
              await apiFetch('articles', { method: 'PATCH', body: JSON.stringify({ id, ...payload }) });
              load(selectedKeyword);
            }} />
          ))}
        </div>
      </section>
    </div>
  );
}
