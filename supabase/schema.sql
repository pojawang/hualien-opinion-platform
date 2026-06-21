create extension if not exists "pgcrypto";

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  password_hash text not null,
  role text default 'admin',
  created_at timestamp default now()
);

create table if not exists keywords (
  id uuid primary key default gen_random_uuid(),
  keyword text unique not null,
  category text,
  enabled boolean default true,
  created_at timestamp default now()
);

create table if not exists sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  source_type text not null check (source_type in (
    'rss',
    'sitemap',
    'google_news',
    'youtube',
    'facebook_page',
    'facebook_group',
    'google_reviews',
    'ptt',
    'dcard',
    'website'
  )),
  url text unique not null,
  platform text,
  enabled boolean default true,
  created_at timestamp default now()
);

create table if not exists articles (
  id uuid primary key default gen_random_uuid(),
  title text,
  url text unique not null,
  source text,
  platform text,
  category text,
  snippet text,
  summary text,
  post_id text,
  image_url text,
  channel_name text,
  view_count bigint default 0,
  thumbnail text,
  excerpt text,
  like_count integer default 0,
  comment_count integer default 0,
  published_at text,
  sentiment text check (sentiment in ('positive', 'neutral', 'negative')),
  importance text check (importance in ('low', 'medium', 'high', 'urgent')),
  status text default 'pending' check (status in ('pending', 'approved', 'rejected')),
  is_broadcasted boolean default false,
  created_at timestamp default now()
);

create table if not exists broadcasts (
  id uuid primary key default gen_random_uuid(),
  article_id uuid references articles(id) on delete set null,
  broadcasted_at timestamp default now(),
  line_message_id text
);

create table if not exists posts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text,
  url text unique not null,
  source text not null default 'dcard',
  source_name text,
  external_id text unique not null,
  author text,
  push_count integer default 0,
  published_at timestamptz,
  like_count integer default 0,
  comment_count integer default 0,
  share_count integer default 0,
  sentiment text default 'neutral' check (sentiment in ('positive', 'neutral', 'negative')),
  status text default 'pending' check (status in ('pending', 'approved', 'rejected')),
  raw_data jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_articles_status on articles(status);
create index if not exists idx_articles_category on articles(category);
create index if not exists idx_articles_created_at on articles(created_at desc);
create index if not exists idx_articles_is_broadcasted on articles(is_broadcasted);
create index if not exists idx_articles_post_id on articles(post_id) where post_id is not null;
create index if not exists idx_articles_channel_name on articles(channel_name) where channel_name is not null;
create index if not exists idx_articles_view_count on articles(view_count desc) where platform = 'youtube';
create index if not exists idx_articles_dcard_engagement on articles((like_count + comment_count) desc) where platform = 'dcard';
create index if not exists idx_posts_source on posts(source);
create index if not exists idx_posts_published_at on posts(published_at desc);
create index if not exists idx_posts_engagement on posts((like_count + comment_count) desc) where source = 'dcard';
create index if not exists idx_posts_ptt_push_count on posts(push_count desc) where source = 'ptt';

insert into keywords (keyword, category, enabled) values
  ('花蓮', '其他', true),
  ('花蓮觀光', '觀光', true),
  ('花蓮旅遊', '觀光', true),
  ('花蓮美食', '美食', true),
  ('花蓮住宿', '住宿', true),
  ('花蓮活動', '活動', true),
  ('花蓮交通', '交通', true),
  ('花蓮地震', '災害', true),
  ('花蓮颱風', '災害', true),
  ('花蓮災情', '災害', true),
  ('花蓮景點', '觀光', true),
  ('花蓮縣政府', '政策', true),
  ('花蓮市公所', '政策', true),
  ('太魯閣', '觀光', true),
  ('七星潭', '觀光', true),
  ('東大門夜市', '美食', true),
  ('洄瀾網', '其他', true)
on conflict (keyword) do nothing;

-- 建立管理員時請先用 bcrypt 產生 password_hash，再執行：
-- insert into users (username, password_hash) values ('admin', '$2a$10$your_bcrypt_hash');
