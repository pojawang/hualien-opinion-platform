begin;

alter table public.facebook_pages
  add column if not exists source_kind text not null default 'page'
    check (source_kind in ('page', 'public_group')),
  add column if not exists collector text not null default 'playwright'
    check (collector in ('apify', 'playwright'));

update public.facebook_pages
set source_kind = case
  when page_url ~* 'facebook\.com/groups/' then 'public_group'
  else 'page'
end
where source_kind is null or source_kind = 'page';

create index if not exists idx_facebook_pages_source_kind
  on public.facebook_pages(source_kind);

create index if not exists idx_articles_facebook_all_hotness
  on public.articles(hotness_score desc)
  where platform in ('facebook_page', 'facebook_group');

commit;
