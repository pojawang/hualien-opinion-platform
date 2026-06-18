# 花蓮輿情平台

花蓮輿情平台是一套針對花蓮地區新聞、觀光、美食、住宿、交通、活動、災害與地方議題設計的 MVP 後台系統。資料蒐集採低風險方式：Serper API、YouTube Data API v3、RSS、Sitemap，以及公開網頁的 title / meta description，不使用 Facebook、Instagram、Threads、Dcard、PTT 或評論硬爬蟲。

## 使用技術

- React 18、React Router、Vite
- Recharts
- Netlify Functions
- Supabase PostgreSQL
- Serper API：Google Search / Google News
- YouTube Data API v3
- LINE Messaging API
- JWT + bcryptjs 自建登入

## 環境變數

請在本機 `.env` 與 Netlify Environment Variables 設定：

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=

SUPABASE_URL=
SUPABASE_SERVICE_KEY=
SERPER_API_KEY=
YOUTUBE_API_KEY=
LINE_CHANNEL_ACCESS_TOKEN=
LINE_GROUP_ID=
JWT_SECRET=
```

`SUPABASE_SERVICE_KEY`、`JWT_SECRET`、`SERPER_API_KEY`、`YOUTUBE_API_KEY`、`LINE_CHANNEL_ACCESS_TOKEN` 只能放在 Netlify 後端環境變數，不可暴露到前端。

## Supabase 資料表建立

1. 到 Supabase Project 的 SQL Editor。
2. 貼上並執行 `supabase/schema.sql`。
3. 建立第一個管理員密碼雜湊：

```bash
node -e "import bcrypt from 'bcryptjs'; console.log(await bcrypt.hash('你的密碼', 10));"
```

4. 將產生的 hash 寫入 Supabase：

```sql
insert into users (username, password_hash)
values ('admin', '貼上 bcrypt hash');
```

## 本機開發

```bash
npm install
npm run dev
```

若要同時測試 Netlify Functions：

```bash
npm install -g netlify-cli
netlify dev
```

在 Windows PowerShell 若 `npm` 被執行政策擋住，可改用：

```bash
npm.cmd install
npm.cmd run dev
```

## Netlify 部署

1. 建立 GitHub Repository 並推送本專案。
2. 在 Netlify 新增 Site，連接該 GitHub Repository。
3. Build command 設為 `npm run build`。
4. Publish directory 設為 `dist`。
5. Functions directory 設為 `netlify/functions`。
6. 設定所有 Environment Variables。
7. Push 到 GitHub 後，Netlify 會自動部署。

`netlify/functions/search.js` 已設定每日排程，部署後 Netlify 會每日自動執行蒐集；後台仍可手動執行搜尋。

## API 功能

- `auth.js`：帳密登入，簽發 JWT。
- `search.js`：讀取啟用關鍵字與來源，蒐集 Serper Search、Serper News、YouTube、RSS、Sitemap，寫入 `articles`。
- `articles.js`：文章列表、篩選、審核、重置、重要程度與情緒更新。
- `keywords.js`：關鍵字新增、停用、啟用、刪除。
- `sources.js`：RSS/Sitemap 來源新增、停用、啟用、刪除、測試讀取。
- `stats.js`：Dashboard 統計與每日摘要資料。
- `broadcast.js`：推播最多 5 則已核准且尚未推播的文章到 LINE 群組。

## 未來擴充方向

- AI 摘要與長文分析
- PDF / PPT 報表
- 更多官方資料來源
- 角色權限與操作紀錄
- API quota 管理與蒐集排程設定
- Facebook、Instagram、Threads、Dcard、PTT 等來源的合規整合方案
