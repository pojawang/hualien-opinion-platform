begin;

alter table public.users
  add column if not exists enabled boolean not null default true;

update public.users
set role = 'user'
where role is null or role not in ('admin', 'user');

alter table public.users
  alter column role set default 'admin';

alter table public.users
  drop constraint if exists users_role_check;

alter table public.users
  add constraint users_role_check check (role in ('admin', 'user'));

commit;
