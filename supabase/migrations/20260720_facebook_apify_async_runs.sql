begin;

create table if not exists public.facebook_apify_runs (
  id uuid primary key default gen_random_uuid(),
  actor_run_id text unique not null,
  dataset_id text,
  source_kind text not null default 'page' check (source_kind in ('page', 'public_group')),
  source_ids uuid[] not null default '{}',
  status text not null default 'READY',
  error_message text,
  imported_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.facebook_apify_runs enable row level security;
revoke all privileges on table public.facebook_apify_runs from anon, authenticated;

create index if not exists idx_facebook_apify_runs_status
  on public.facebook_apify_runs(status);

update public.facebook_pages
set page_name = case
  when page_url like '%265344726961368%' then '花蓮人Hualien'
  when page_url like '%255935524557211%' then '花蓮大小事'
  when page_url like '%249927231705630%' then '花蓮同鄉會'
  when page_url like '%833233640557210%' then '花蓮爆料王'
  when page_url like '%100063596289388%' then '今日花蓮'
  else page_name
end
where page_url like '%265344726961368%'
   or page_url like '%255935524557211%'
   or page_url like '%249927231705630%'
   or page_url like '%833233640557210%'
   or page_url like '%100063596289388%';

commit;
