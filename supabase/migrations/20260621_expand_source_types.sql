begin;

alter table public.sources
  drop constraint if exists sources_source_type_check;

alter table public.sources
  add constraint sources_source_type_check
  check (source_type in (
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
  ));

update public.sources
set platform = source_type
where platform is null or platform = '' or platform = 'web';

commit;
