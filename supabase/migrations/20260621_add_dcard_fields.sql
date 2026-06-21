begin;

alter table public.articles
  add column if not exists excerpt text,
  add column if not exists like_count integer default 0,
  add column if not exists comment_count integer default 0;

create index if not exists idx_articles_dcard_engagement
  on public.articles((like_count + comment_count) desc)
  where platform = 'dcard';

commit;
