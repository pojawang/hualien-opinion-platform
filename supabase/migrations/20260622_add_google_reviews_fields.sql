begin;

alter table public.articles add column if not exists place_name text;
alter table public.articles add column if not exists rating numeric(3, 2);
alter table public.articles add column if not exists review_count integer default 0;
alter table public.articles add column if not exists review_text text;
alter table public.articles add column if not exists place_type text;

create index if not exists idx_articles_google_reviews_rating
  on public.articles(rating desc)
  where platform = 'google_reviews';

commit;
