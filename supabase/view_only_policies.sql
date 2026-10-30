-- حماية حسابات "المشاهدة فقط" على مستوى قاعدة البيانات.
-- شغّل هذا الملف في Supabase → SQL Editor.
--
-- القراءة: لكل مستخدم مسجّل دخول.
-- الإضافة/التعديل/الحذف: فقط لمن ليس عنده payments_manage = false في app_metadata
-- (حسابا user1 و user2 عندهما payments_manage = false، فيقرآن فقط ولو استخدما أدوات المتصفح).
-- حسابك الحالي (saud) بدون هذه العلامة، فيبقى بكامل الصلاحيات.

do $$
declare t text;
begin
  foreach t in array array['projects', 'contracts', 'payments', 'archived_contracts'] loop
    execute format('drop policy if exists "authenticated full access" on public.%I', t);
    execute format('drop policy if exists "authenticated read" on public.%I', t);
    execute format('drop policy if exists "managers insert" on public.%I', t);
    execute format('drop policy if exists "managers update" on public.%I', t);
    execute format('drop policy if exists "managers delete" on public.%I', t);

    execute format($f$create policy "authenticated read" on public.%I for select using (auth.role() = 'authenticated')$f$, t);
    execute format($f$create policy "managers insert" on public.%I for insert with check (
      auth.role() = 'authenticated' and coalesce(auth.jwt() -> 'app_metadata' ->> 'payments_manage', 'true') <> 'false')$f$, t);
    execute format($f$create policy "managers update" on public.%I for update
      using (auth.role() = 'authenticated' and coalesce(auth.jwt() -> 'app_metadata' ->> 'payments_manage', 'true') <> 'false')
      with check (auth.role() = 'authenticated' and coalesce(auth.jwt() -> 'app_metadata' ->> 'payments_manage', 'true') <> 'false')$f$, t);
    execute format($f$create policy "managers delete" on public.%I for delete using (
      auth.role() = 'authenticated' and coalesce(auth.jwt() -> 'app_metadata' ->> 'payments_manage', 'true') <> 'false')$f$, t);
  end loop;
end $$;
