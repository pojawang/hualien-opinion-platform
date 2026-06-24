begin;

-- 本平台不直接從瀏覽器讀寫 Supabase，所有資料操作均由 Service Role 後端執行。
-- 因此公開的 anon/authenticated 角色不需要任何資料表政策或直接權限。
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'users',
    'admin_users',
    'keywords',
    'sources',
    'articles',
    'facebook_pages',
    'broadcasts',
    'posts'
  ]
  loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('alter table public.%I enable row level security', table_name);
      execute format(
        'revoke all privileges on table public.%I from anon, authenticated',
        table_name
      );
    end if;
  end loop;
end
$$;

commit;

-- 驗證方式：執行下列查詢，rowsecurity 應全部為 true。
-- select c.relname, c.relrowsecurity as rowsecurity
-- from pg_class c
-- join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'public'
--   and c.relkind = 'r'
-- order by c.relname;
