-- إدارة المستخدمين من صفحة الإعدادات (لحساب المدير فقط).
-- دوال تعمل بصلاحية عالية داخل قاعدة البيانات، وكل دالة تتحقق أن من يستدعيها هو المدير
-- (raw_app_meta_data.is_admin = true) — وهذه العلامة لا يستطيع أي مستخدم تعديلها بنفسه.

-- 1) علّم حساب المدير
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"is_admin": true}'::jsonb
where email = 'saud@sababah.sa';

-- 2) التحقق من أن المستدعي مدير
create or replace function public.admin_assert()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not exists (
    select 1 from auth.users
    where id = auth.uid() and coalesce(raw_app_meta_data ->> 'is_admin', 'false') = 'true'
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
end;
$$;

-- 3) قائمة المستخدمين
create or replace function public.admin_list_users()
returns table (
  id uuid, email text, name text, created_at timestamptz, last_sign_in_at timestamptz,
  suspended boolean, can_write boolean, is_admin boolean
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  perform public.admin_assert();
  return query
    select u.id,
           u.email::text,
           coalesce(u.raw_user_meta_data ->> 'name', '')::text,
           u.created_at,
           u.last_sign_in_at,
           (u.banned_until is not null and u.banned_until > now()),
           coalesce(u.raw_app_meta_data ->> 'payments_manage', 'true') <> 'false',
           coalesce(u.raw_app_meta_data ->> 'is_admin', 'false') = 'true'
    from auth.users u
    order by u.created_at;
end;
$$;

-- 4) تغيير كلمة مرور مستخدم (ويُسجَّل خروجه من أجهزته)
create or replace function public.admin_set_password(target uuid, new_password text)
returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
begin
  perform public.admin_assert();
  if new_password is null or length(new_password) < 6 then
    raise exception 'password too short' using errcode = '22023';
  end if;
  update auth.users
  set encrypted_password = crypt(new_password, gen_salt('bf')), updated_at = now()
  where id = target;
  delete from auth.sessions where user_id = target;
end;
$$;

-- 5) إيقاف / إعادة تشغيل مستخدم (الإيقاف يمنع الدخول ويُنهي جلساته)
create or replace function public.admin_set_suspended(target uuid, suspended boolean)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  perform public.admin_assert();
  if target = auth.uid() then
    raise exception 'cannot suspend your own account' using errcode = '42501';
  end if;
  update auth.users
  set banned_until = case when suspended then now() + interval '100 years' else null end,
      updated_at = now()
  where id = target;
  if suspended then
    delete from auth.sessions where user_id = target;
  end if;
end;
$$;

-- 6) حذف مستخدم
create or replace function public.admin_delete_user(target uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  perform public.admin_assert();
  if target = auth.uid() then
    raise exception 'cannot delete your own account' using errcode = '42501';
  end if;
  delete from auth.users where id = target;
end;
$$;

-- الصلاحيات: للمسجّلين فقط (والتحقق من المدير داخل كل دالة)
revoke all on function public.admin_assert() from public, anon, authenticated;
revoke all on function public.admin_list_users() from public, anon;
revoke all on function public.admin_set_password(uuid, text) from public, anon;
revoke all on function public.admin_set_suspended(uuid, boolean) from public, anon;
revoke all on function public.admin_delete_user(uuid) from public, anon;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_set_password(uuid, text) to authenticated;
grant execute on function public.admin_set_suspended(uuid, boolean) to authenticated;
grant execute on function public.admin_delete_user(uuid) to authenticated;
