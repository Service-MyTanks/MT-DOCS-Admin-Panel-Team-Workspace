-- Global workspace appearance, controlled only by the reserved support account.
-- Run once in Supabase SQL Editor after the existing account settings migration.

begin;

create table if not exists public.workspace_settings (
  setting_key text primary key check (setting_key = 'appearance'),
  global_theme text not null default 'mt-standard'
    check (global_theme in ('mt-standard', 'new-year')),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

insert into public.workspace_settings (setting_key, global_theme)
values ('appearance', 'mt-standard')
on conflict (setting_key) do nothing;

alter table public.workspace_settings enable row level security;

drop policy if exists "workspace settings: public read" on public.workspace_settings;
create policy "workspace settings: public read"
  on public.workspace_settings for select to anon, authenticated
  using (true);

revoke all on public.workspace_settings from public, anon, authenticated;
grant select on public.workspace_settings to anon, authenticated;

create or replace function public.set_workspace_global_theme(new_theme text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Требуется авторизация' using errcode = '42501';
  end if;

  if new_theme not in ('mt-standard', 'new-year') then
    raise exception 'Недопустимая глобальная тема' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from auth.users u
    join public.profiles p on p.id = u.id
    where u.id = auth.uid()
      and lower(u.email) = 'supportmytanks@gmail.com'
      and u.email_confirmed_at is not null
      and lower(p.email) = 'supportmytanks@gmail.com'
      and p.status = 'approved'
  ) then
    raise exception 'Управление глобальной темой доступно только закреплённому аккаунту техподдержки'
      using errcode = '42501';
  end if;

  update public.workspace_settings
  set global_theme = new_theme,
      updated_at = now(),
      updated_by = auth.uid()
  where setting_key = 'appearance';

  if not found then
    raise exception 'Глобальные настройки рабочего пространства не инициализированы'
      using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.set_workspace_global_theme(text) from public, anon, authenticated;
grant execute on function public.set_workspace_global_theme(text) to authenticated;

-- Enable realtime updates so already-open sessions switch themes immediately.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'workspace_settings'
     ) then
    alter publication supabase_realtime add table public.workspace_settings;
  end if;
end;
$$;

commit;
