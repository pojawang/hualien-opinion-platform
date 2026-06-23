import StatusBadge from './StatusBadge.jsx';
import { getCurrentUser } from '../lib/supabase.js';
import {
  cleanArticleText,
  importanceLabel,
  platformLabel,
  publishedAtLabel,
  sentimentLabel
} from '../lib/labels.js';

export default function ArticleCard({ article, onUpdate }) {
  const canManage = getCurrentUser()?.role === 'admin';
  return (
    <article className="articleCard">
      <div className="articleTop">
        <div>
          <h3>{cleanArticleText(article.title, '未命名文章')}</h3>
          <p className="meta">
            {cleanArticleText(article.source, '未知來源')} · {platformLabel(article.platform)} · {article.category || '其他'}
          </p>
        </div>
        <StatusBadge status={article.status} />
      </div>
      <p className="snippet">{cleanArticleText(article.summary || article.snippet, '沒有摘要')}</p>
      <div className="articleInfo">
        <span>發布：{publishedAtLabel(article.published_at)}</span>
        <span>重要程度：{importanceLabel(article.importance)}</span>
        <span>情緒：{sentimentLabel(article.sentiment)}</span>
      </div>
      <div className="actions">
        <a href={article.url} target="_blank" rel="noreferrer">原文連結</a>
        {canManage && (
          <>
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
          </>
        )}
      </div>
    </article>
  );
}
