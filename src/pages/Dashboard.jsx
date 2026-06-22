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
import {
  cleanArticleText,
  importanceLabel,
  localizeSentimentCounts,
  sourceTypeLabel
} from '../lib/labels.js';

const pieColors = ['#0f766e', '#d97706', '#b91c1c'];
const numberFormat = new Intl.NumberFormat('zh-TW');
const PAGE_SIZE = 5;

function PagedItems({ items = [], className, ordered = false, children }) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = items.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const ListTag = ordered ? 'ol' : 'div';

  useEffect(() => {
    setPage(0);
  }, [items]);

  return (
    <>
      <ListTag className={className}>
        {pageItems.map((item, index) => children(item, index, safePage * PAGE_SIZE + index))}
      </ListTag>
      {pageCount > 1 && (
        <div className="paginationControls">
          <button type="button" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={safePage === 0}>上一頁</button>
          <span>{safePage + 1} / {pageCount}</span>
          <button type="button" onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))} disabled={safePage === pageCount - 1}>下一頁</button>
        </div>
      )}
    </>
  );
}

function ReviewRanking({ title, items = [], emptyText }) {
  return (
    <div className="panel">
      <h3>{title}</h3>
      <PagedItems items={items} className="warningList">
        {(place) => (
          <a key={place.id} href={place.url} target="_blank" rel="noreferrer">
            <span>{cleanArticleText(place.place_name || place.title, '未命名地點')}</span>
            <small>
              評分 {Number(place.rating).toFixed(1)} · 口碑 {Number(place.reputation_score || place.rating).toFixed(2)} · {numberFormat.format(Number(place.review_count) || 0)} 則評論
              {place.review_text ? ` · ${cleanArticleText(place.review_text)}` : ''}
            </small>
          </a>
        )}
      </PagedItems>
      {items.length === 0 && <p className="emptyState">{emptyText}</p>}
    </div>
  );
}

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
  const facebookSentimentCounts = localizeSentimentCounts(stats.facebookSentimentCounts || []);
  const sourceCounts = (stats.sourceCounts || []).map((item) => ({
    ...item,
    name: sourceTypeLabel(item.name)
  }));

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
        <StatCard label="Facebook 貼文" value={stats.facebookPostCount || 0} />
        <StatCard label="YouTube 影片" value={stats.youtubeVideoCount || 0} />
        <StatCard label="Dcard 聲量" value={stats.dcardCount || 0} />
        <StatCard label="PTT 聲量" value={stats.pttCount || 0} />
        <StatCard label="Google 評論地點" value={stats.googleReviewPlaceCount || 0} />
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
          <h3>Facebook 聲量趨勢</h3>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={stats.facebookVolumeTrend || []}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis allowDecimals={false} />
              <Tooltip formatter={(value) => [`${value} 則`, 'Facebook 聲量']} />
              <Line type="monotone" dataKey="value" name="Facebook 聲量" stroke="#1877f2" strokeWidth={3} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="panel">
          <h3>Facebook 情緒分析</h3>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={facebookSentimentCounts} dataKey="value" nameKey="name" outerRadius={90} label>
                {facebookSentimentCounts.map((entry, index) => <Cell key={entry.name} fill={pieColors[index % pieColors.length]} />)}
              </Pie>
              <Legend />
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </section>
      <section className="chartGrid">
        <div className="panel">
          <h3>Facebook 熱門貼文 TOP 10</h3>
          <PagedItems items={stats.facebookTopPosts || []} className="warningList">
            {(post) => (
              <a key={post.id} href={post.url} target="_blank" rel="noreferrer">
                <span>{cleanArticleText(post.title, 'Facebook 貼文')}</span>
                <small>
                  {post.source || 'Facebook 粉專'} · {numberFormat.format(Number(post.like_count) || 0)} 讚 · {numberFormat.format(Number(post.comment_count) || 0)} 留言 · {numberFormat.format(Number(post.share_count) || 0)} 分享
                  {Number(post.hotness_score) > 0 ? ` · 熱門度 ${numberFormat.format(Number(post.hotness_score))}` : ''}
                  {post.analysis_keywords?.length ? ` · 關鍵字：${post.analysis_keywords.join('、')}` : ''}
                </small>
              </a>
            )}
          </PagedItems>
          {stats.facebookTopPosts?.length === 0 && <p className="emptyState">目前沒有 Facebook 貼文資料。</p>}
        </div>
        <div className="panel">
          <h3>Facebook 粉專排行</h3>
          <PagedItems items={stats.facebookPageRanking || []} className="keywordRanking" ordered>
            {(page, index, globalIndex) => (
              <li key={page.name}>
                <strong>{globalIndex + 1}</strong>
                <span>{page.name}</span>
                <b>{page.value} 則</b>
              </li>
            )}
          </PagedItems>
          {stats.facebookPageRanking?.length === 0 && <p className="emptyState">目前沒有 Facebook 粉專資料。</p>}
        </div>
      </section>
      <section className="chartGrid">
        <div className="panel">
          <h3>熱門關鍵字排行榜</h3>
          <PagedItems items={stats.popularKeywords} className="keywordRanking" ordered>
            {(item, index, globalIndex) => (
              <li key={item.name}>
                <strong>{globalIndex + 1}</strong>
                <span>{item.name}</span>
                <b>{item.value} 則</b>
              </li>
            )}
          </PagedItems>
          {stats.popularKeywords.length === 0 && <p className="emptyState">目前沒有關鍵字聲量。</p>}
        </div>
        <div className="panel warningPanel">
          <div className="sectionHeading">
            <h3>近一個月負評預警</h3>
            <span>{stats.negativeAlerts.length} 則</span>
          </div>
          <PagedItems items={stats.negativeAlerts} className="warningList">
            {(article) => (
              <a key={article.id} href={article.url} target="_blank" rel="noreferrer">
                <span>{cleanArticleText(article.title, '未命名文章')}</span>
                <small>{article.category || '其他'} · 重要程度：{importanceLabel(article.importance)}</small>
              </a>
            )}
          </PagedItems>
          {stats.negativeAlerts.length === 0 && <p className="emptyState">近一個月沒有負面預警。</p>}
        </div>
      </section>
      <section className="chartGrid">
        <div className="panel">
          <h3>Dcard 熱門文章排行</h3>
          <PagedItems items={stats.dcardTopPosts || []} className="warningList">
            {(post) => (
              <a key={post.id} href={post.url} target="_blank" rel="noreferrer">
                <span>{cleanArticleText(post.title, '未命名文章')}</span>
                <small>
                  {post.like_count == null ? '按讚數未提供' : `${numberFormat.format(Number(post.like_count) || 0)} 個讚`}
                  {' · '}
                  {post.comment_count == null ? '留言數未提供' : `${numberFormat.format(Number(post.comment_count) || 0)} 則留言`}
                </small>
              </a>
            )}
          </PagedItems>
          {stats.dcardTopPosts?.length === 0 && <p className="emptyState">目前沒有 Dcard 文章資料。</p>}
        </div>
        <div className="panel">
          <h3>Dcard 熱門討論關鍵字</h3>
          <PagedItems items={stats.dcardDiscussionKeywords || []} className="keywordRanking" ordered>
            {(item, index, globalIndex) => (
              <li key={item.name}>
                <strong>{globalIndex + 1}</strong>
                <span>{item.name}</span>
                <b>{item.value} 則</b>
              </li>
            )}
          </PagedItems>
          {stats.dcardDiscussionKeywords?.length === 0 && <p className="emptyState">目前沒有 Dcard 關鍵字資料。</p>}
        </div>
      </section>
      <section className="chartGrid">
        <div className="panel">
          <h3>PTT 熱門文章</h3>
          <PagedItems items={stats.pttTopPosts || []} className="warningList">
            {(post) => (
              <a key={post.id} href={post.url} target="_blank" rel="noreferrer">
                <span>{cleanArticleText(post.title, '未命名文章')}</span>
                <small>{post.author || '未知作者'} · {post.source_name || 'PTT'} · {numberFormat.format(Number(post.push_count) || 0)} 推</small>
              </a>
            )}
          </PagedItems>
          {stats.pttTopPosts?.length === 0 && <p className="emptyState">目前沒有 PTT 文章資料。</p>}
        </div>
        <div className="panel">
          <h3>PTT 熱門關鍵字</h3>
          <PagedItems items={stats.pttDiscussionKeywords || []} className="keywordRanking" ordered>
            {(item, index, globalIndex) => (
              <li key={item.name}>
                <strong>{globalIndex + 1}</strong>
                <span>{item.name}</span>
                <b>{item.value} 則</b>
              </li>
            )}
          </PagedItems>
          {stats.pttDiscussionKeywords?.length === 0 && <p className="emptyState">目前沒有 PTT 關鍵字資料。</p>}
        </div>
      </section>
      <section className="chartGrid">
        <div className="panel">
          <h3>YouTube 熱門頻道排行</h3>
          <PagedItems items={stats.youtubeTopChannels || []} className="keywordRanking" ordered>
            {(channel, index, globalIndex) => (
              <li key={channel.name}>
                <strong>{globalIndex + 1}</strong>
                <span>{channel.name}</span>
                <b>{channel.value} 部</b>
              </li>
            )}
          </PagedItems>
          {stats.youtubeTopChannels?.length === 0 && <p className="emptyState">目前沒有 YouTube 頻道資料。</p>}
        </div>
        <div className="panel">
          <h3>YouTube 觀看數前 10 名</h3>
          <PagedItems items={stats.youtubeTopVideos || []} className="warningList">
            {(video) => (
              <a key={video.id} href={video.url} target="_blank" rel="noreferrer">
                <span>{cleanArticleText(video.title, '未命名影片')}</span>
                <small>{video.channel_name || '未知頻道'} · {numberFormat.format(Number(video.view_count) || 0)} 次觀看</small>
              </a>
            )}
          </PagedItems>
          {stats.youtubeTopVideos?.length === 0 && <p className="emptyState">目前沒有 YouTube 觀看數資料。</p>}
        </div>
      </section>
      <section className="chartGrid">
        <ReviewRanking
          title="評價分數排行"
          items={stats.googleReviewRatingRanking}
          emptyText="目前沒有 Google 評論評分資料。"
        />
        <ReviewRanking
          title="負評排行"
          items={stats.googleReviewNegativeRanking}
          emptyText="目前沒有 Google 負評資料。"
        />
      </section>
      <section className="chartGrid">
        <ReviewRanking
          title="景點口碑排行"
          items={stats.googleReviewAttractionRanking}
          emptyText="目前沒有景點口碑資料。"
        />
        <ReviewRanking
          title="住宿口碑排行"
          items={stats.googleReviewLodgingRanking}
          emptyText="目前沒有住宿口碑資料。"
        />
      </section>
      <section>
        <ReviewRanking
          title="餐廳口碑排行"
          items={stats.googleReviewRestaurantRanking}
          emptyText="目前沒有餐廳口碑資料。"
        />
      </section>
      <section className="chartGrid">
        <div className="panel">
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
        </div>
        <div className="panel">
          <h3>來源統計</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={sourceCounts} layout="vertical" margin={{ left: 12 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" allowDecimals={false} />
              <YAxis type="category" dataKey="name" width={105} />
              <Tooltip formatter={(value) => [`${value} 則`, '文章數']} />
              <Bar dataKey="value" fill="#d97706" />
            </BarChart>
          </ResponsiveContainer>
        </div>
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
