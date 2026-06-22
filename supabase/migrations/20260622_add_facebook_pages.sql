begin;

alter table public.articles add column if not exists share_count integer default 0;

create table if not exists public.facebook_pages (
  id uuid primary key default gen_random_uuid(),
  page_name text,
  page_url text unique not null,
  category text default '其他',
  enabled boolean default true,
  last_fetch_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists idx_facebook_pages_enabled
  on public.facebook_pages(enabled);

commit;
