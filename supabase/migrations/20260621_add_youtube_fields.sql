begin;

alter table public.articles
  add column if not exists channel_name text,
  add column if not exists view_count bigint default 0,
  add column if not exists thumbnail text;

create index if not exists idx_articles_channel_name
  on public.articles(channel_name)
  where channel_name is not null;

create index if not exists idx_articles_view_count
  on public.articles(view_count desc)
  where platform = 'youtube';

commit;
