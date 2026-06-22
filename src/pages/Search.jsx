import { useState } from 'react';
import { apiFetch } from '../lib/supabase.js';

function collectorErrorMessage(message) {
  if (String(message).includes("Could not find the table 'public.posts'")) {
    return '尚未建立 posts 資料表，請先在 Supabase 執行 posts migration。';
  }
  return message;
}

export default function Search() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');

  async function runSearch() {
    setLoading(true);
    setError('');
    setResult(null);

    try {
      const combined = {
        inserted: 0,
        duplicates: 0,
        total: 0,
        youtubeCandidates: 0,
        googleReviewCandidates: 0,
        errors: []
      };

      function merge(data) {
        combined.inserted += data.inserted || 0;
        combined.duplicates += data.duplicates || 0;
        combined.total += data.total || 0;
        combined.youtubeCandidates += data.youtubeCandidates || 0;
        combined.googleReviewCandidates += data.googleReviewCandidates || 0;
        combined.errors.push(...(data.errors || []));
      }

      async function runBatches(mode, label) {
        let offset = 0;
        while (true) {
          setProgress(`${label}：第 ${Math.floor(offset / 3) + 1} 批`);
          try {
            const data = await apiFetch('search', {
              method: 'POST',
              body: JSON.stringify({ mode, offset, limit: 3 })
            });
            merge(data);
            if (!data.hasMore || data.serperBlocked || !data.processedKeywords) break;
            offset += data.processedKeywords;
          } catch (batchError) {
            combined.errors.push({ source: label, message: batchError.message });
            break;
          }
        }
      }

      await runBatches('web', 'Google Search 與 News');
      await runBatches('videos', 'YouTube');

      setProgress('RSS、Sitemap、Places 與網站來源');
      try {
        merge(await apiFetch('search', {
          method: 'POST',
          body: JSON.stringify({ mode: 'sources' })
        }));
      } catch (sourceError) {
        combined.errors.push({ source: '網站來源', message: sourceError.message });
      }

      setProgress('Dcard 與 PTT');
      const [dcardResult, pttResult] = await Promise.allSettled([
        apiFetch('collect-dcard', { method: 'POST' }),
        apiFetch('collect-ptt', { method: 'POST' })
      ]);

      const collectorErrors = [];
      if (dcardResult.status === 'rejected') collectorErrors.push(`Dcard：${dcardResult.reason.message}`);
      if (pttResult.status === 'rejected') collectorErrors.push(`PTT：${pttResult.reason.message}`);
      if (dcardResult.status === 'fulfilled') {
        collectorErrors.push(...(dcardResult.value.errors || []).map((item) => `Dcard ${item.forum}：${collectorErrorMessage(item.message)}`));
      }
      if (pttResult.status === 'fulfilled') {
        collectorErrors.push(...(pttResult.value.errors || []).map((item) => `PTT ${item.board}：${collectorErrorMessage(item.message)}`));
      }
      setResult({
        ...combined,
        dcard: dcardResult.status === 'fulfilled' ? dcardResult.value : null,
        ptt: pttResult.status === 'fulfilled' ? pttResult.value : null,
        collectorErrors
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setProgress('');
      setLoading(false);
    }
  }

  return (
    <div className="pageStack">
      <header className="pageHeader">
        <div>
          <h2>搜尋蒐集</h2>
          <p>分批執行 Search、News、Videos、Places、RSS、Sitemap、Dcard 與 PTT 蒐集</p>
        </div>
        <button onClick={runSearch} disabled={loading}>{loading ? '蒐集中...' : '開始搜尋'}</button>
      </header>
      {progress && <div className="notice">目前進度：{progress}</div>}
      {error && <div className="alert">{error}</div>}
      {result && (
        <section className="panel">
          <h3>本次結果</h3>
          <div className="resultGrid">
            <span>新增：<strong>{result.inserted}</strong></span>
            <span>重複略過：<strong>{result.duplicates}</strong></span>
            <span>候選資料：<strong>{result.total}</strong></span>
            <span>YouTube 候選：<strong>{result.youtubeCandidates || 0}</strong></span>
            <span>Google 評論候選：<strong>{result.googleReviewCandidates || 0}</strong></span>
            <span>Dcard 新增或更新：<strong>{result.dcard?.upserted || 0}</strong></span>
            <span>PTT 新增或更新：<strong>{result.ptt?.upserted || 0}</strong></span>
          </div>
          {result.ptt?.skipped && <div className="notice">PTT 尚未啟用，請先在來源管理新增一筆 PTT 來源。</div>}
          {result.dcard?.fallback === 'serper' && <div className="notice">Dcard API 拒絕連線，已自動改用 Serper 公開搜尋結果。</div>}
          {result.collectorErrors?.length > 0 && (
            <div className="alert">{result.collectorErrors.map((message) => <p key={message}>{message}</p>)}</div>
          )}
          {result.errors?.length > 0 && (
            <div className="alert">
              {result.errors.map((item) => <p key={`${item.source}-${item.message}`}>{item.source}: {item.message}</p>)}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
