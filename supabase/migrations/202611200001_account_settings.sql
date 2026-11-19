-- MT DOCS account settings migration
-- Run once in Supabase SQL Editor after the initial schema.
-- Preserves profile UUID, approval status, position and admin flag.

begin;

alter table public.profiles add column if not exists avatar_path text;

create or replace function public.update_own_nickname(new_nickname text)
returns void language plpgsql security definer set search_path = '' as $$
declare normalized text := btrim(coalesce(new_nickname, ''));
begin
  if auth.uid() is null then raise exception 'Требуется авторизация' using errcode = '42501'; end if;
  if char_length(normalized) not between 2 and 64 then
    raise exception 'Никнейм должен содержать от 2 до 64 символов' using errcode = '22023';
  end if;
  update public.profiles set nickname = normalized where id = auth.uid();
  if not found then raise exception 'Профиль не найден' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.set_own_avatar_path(new_path text)
returns void language plpgsql security definer set search_path = '' as $$
declare expected_path text;
begin
  if auth.uid() is null then raise exception 'Требуется авторизация' using errcode = '42501'; end if;
  expected_path := auth.uid()::text || '/avatar.webp';
  if new_path is not null and new_path <> expected_path then
    raise exception 'Недопустимый путь аватара' using errcode = '42501';
  end if;
  update public.profiles set avatar_path = new_path where id = auth.uid();
  if not found then raise exception 'Профиль не найден' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.protect_reserved_support_email()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if lower(coalesce(old.email, '')) = 'supportmytanks@gmail.com'
     and lower(coalesce(new.email, '')) <> 'supportmytanks@gmail.com' then
    raise exception 'Служебный адрес электронной почты нельзя изменить' using errcode = '42501';
  end if;
  if lower(coalesce(new.email, '')) = 'supportmytanks@gmail.com'
     and lower(coalesce(old.email, '')) <> 'supportmytanks@gmail.com' then
    raise exception 'Этот адрес закреплён за служебным аккаунтом' using errcode = '23505';
  end if;
  return new;
end;
$$;

create or replace function public.sync_profile_email()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

drop trigger if exists protect_reserved_support_email on auth.users;
create trigger protect_reserved_support_email
before update of email on auth.users
for each row when (old.email is distinct from new.email)
execute function public.protect_reserved_support_email();

drop trigger if exists sync_profile_email on auth.users;
create trigger sync_profile_email
after update of email on auth.users
for each row when (old.email is distinct from new.email)
execute function public.sync_profile_email();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/webp'])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatars: public read" on storage.objects;
create policy "avatars: public read" on storage.objects
for select to public using (bucket_id = 'avatars');

drop policy if exists "avatars: owner insert" on storage.objects;
create policy "avatars: owner insert" on storage.objects
for insert to authenticated with check (bucket_id = 'avatars' and name = auth.uid()::text || '/avatar.webp');

drop policy if exists "avatars: owner update" on storage.objects;
create policy "avatars: owner update" on storage.objects
for update to authenticated
using (bucket_id = 'avatars' and name = auth.uid()::text || '/avatar.webp')
with check (bucket_id = 'avatars' and name = auth.uid()::text || '/avatar.webp');

drop policy if exists "avatars: owner delete" on storage.objects;
create policy "avatars: owner delete" on storage.objects
for delete to authenticated using (bucket_id = 'avatars' and name = auth.uid()::text || '/avatar.webp');

revoke all on function public.update_own_nickname(text) from public, anon, authenticated;
revoke all on function public.set_own_avatar_path(text) from public, anon, authenticated;
grant execute on function public.update_own_nickname(text) to authenticated;
grant execute on function public.set_own_avatar_path(text) to authenticated;

commit;
