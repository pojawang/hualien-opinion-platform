import StatusBadge from './StatusBadge.jsx';

export default function ArticleCard({ article, onUpdate }) {
  return (
    <article className="articleCard">
      <div className="articleTop">
        <div>
          <h3>{article.title || '未命名文章'}</h3>
          <p className="meta">
            {article.source || '未知來源'} · {article.platform || 'web'} · {article.category || '其他'}
          </p>
        </div>
        <StatusBadge status={article.status} />
      </div>
      <p className="snippet">{article.summary || article.snippet || '沒有摘要'}</p>
      <div className="articleInfo">
        <span>發布：{article.published_at || '未提供'}</span>
        <span>重要程度：{article.importance || 'medium'}</span>
        <span>情緒：{article.sentiment || 'neutral'}</span>
      </div>
      <div className="actions">
        <a href={article.url} target="_blank" rel="noreferrer">原文連結</a>
        <button onClick={() => onUpdate(article.id, { status: 'approved' })}>核准</button>
        <button onClick={() => onUpdate(article.id, { status: 'rejected' })}>拒絕</button>
        <button onClick={() => onUpdate(article.id, { status: 'pending' })}>重置</button>
        <select
          value={article.importance || 'medium'}
          onChange={(event) => onUpdate(article.id, { importance: event.target.value })}
        >
          <option value="low">低</option>
          <option value="medium">中</option>
          <option value="high">高</option>
          <option value="urgent">緊急</option>
        </select>
      </div>
    </article>
  );
}
