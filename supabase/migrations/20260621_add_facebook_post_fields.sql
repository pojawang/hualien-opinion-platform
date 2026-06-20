begin;

alter table public.articles
  add column if not exists post_id text,
  add column if not exists image_url text;

create index if not exists idx_articles_post_id
  on public.articles(post_id)
  where post_id is not null;

commit;
