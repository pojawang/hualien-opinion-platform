begin;

create table if not exists public.posts (
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

alter table public.posts add column if not exists author text;
alter table public.posts add column if not exists push_count integer default 0;
alter table public.posts add column if not exists source_name text;
alter table public.posts add column if not exists raw_data jsonb;

create index if not exists idx_posts_source on public.posts(source);
create index if not exists idx_posts_published_at on public.posts(published_at desc);
create index if not exists idx_posts_engagement
  on public.posts((like_count + comment_count) desc)
  where source = 'dcard';
create index if not exists idx_posts_ptt_push_count
  on public.posts(push_count desc)
  where source = 'ptt';

commit;
