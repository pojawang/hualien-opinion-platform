begin;

alter table public.articles add column if not exists hotness_score numeric(10, 2) default 0;
alter table public.articles add column if not exists analysis_keywords text[] default '{}';
alter table public.articles add column if not exists ai_analyzed boolean default false;

create index if not exists idx_articles_facebook_hotness
  on public.articles(hotness_score desc)
  where platform = 'facebook_page';

commit;
