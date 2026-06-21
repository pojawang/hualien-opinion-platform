import { useState } from 'react';
import { apiFetch } from '../lib/supabase.js';

export default function Search() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  async function runSearch() {
    setLoading(true);
    setError('');
    setResult(null);

    try {
      const [searchResult, dcardResult, pttResult] = await Promise.allSettled([
        apiFetch('search', { method: 'POST' }),
        apiFetch('collect-dcard', { method: 'POST' }),
        apiFetch('collect-ptt', { method: 'POST' })
      ]);

      if (searchResult.status === 'rejected') throw searchResult.reason;
      const collectorErrors = [];
      if (dcardResult.status === 'rejected') collectorErrors.push(`Dcard：${dcardResult.reason.message}`);
      if (pttResult.status === 'rejected') collectorErrors.push(`PTT：${pttResult.reason.message}`);
      if (dcardResult.status === 'fulfilled') {
        collectorErrors.push(...(dcardResult.value.errors || []).map((item) => `Dcard ${item.forum}：${item.message}`));
      }
      if (pttResult.status === 'fulfilled') {
        collectorErrors.push(...(pttResult.value.errors || []).map((item) => `PTT ${item.board}：${item.message}`));
      }
      setResult({
        ...searchResult.value,
        dcard: dcardResult.status === 'fulfilled' ? dcardResult.value : null,
        ptt: pttResult.status === 'fulfilled' ? pttResult.value : null,
        collectorErrors
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="pageStack">
      <header className="pageHeader">
        <div>
          <h2>搜尋蒐集</h2>
          <p>手動執行 Serper Search、News、Videos、RSS 與 Sitemap 蒐集</p>
        </div>
        <button onClick={runSearch} disabled={loading}>{loading ? '蒐集中...' : '開始搜尋'}</button>
      </header>
      {error && <div className="alert">{error}</div>}
      {result && (
        <section className="panel">
          <h3>本次結果</h3>
          <div className="resultGrid">
            <span>新增：<strong>{result.inserted}</strong></span>
            <span>重複略過：<strong>{result.duplicates}</strong></span>
            <span>候選資料：<strong>{result.total}</strong></span>
            <span>YouTube 候選：<strong>{result.youtubeCandidates || 0}</strong></span>
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
