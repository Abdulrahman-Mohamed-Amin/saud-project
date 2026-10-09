# نشر دوال التذكير بالإيميل (Edge Functions)

محتاج حساب [Resend](https://resend.com) مجاني (100 إيميل/يوم) — سجّل، خد الـ API Key من
Dashboard → API Keys، وتأكد من عمل "Verify Domain" لدومين بتاعك (أو استخدم sender
التجريبي `onboarding@resend.dev` للتجربة فقط — بيبعت لصاحب الحساب نفسه بس).

## 1. تثبيت Supabase CLI وتسجيل الدخول
```
npm install -g supabase
supabase login
supabase link --project-ref <project-ref-بتاع-مشروعك-الجديد>
```
(الـ project-ref موجود في رابط الـ Dashboard: `supabase.com/dashboard/project/<project-ref>`)

## 2. ضبط الأسرار (Secrets)
```
supabase secrets set RESEND_API_KEY=re_xxxxxxxx
supabase secrets set FROM_EMAIL="اسم الشركة <notifications@yourdomain.com>"
```
(`SUPABASE_URL` و `SUPABASE_SERVICE_ROLE_KEY` متاحين تلقائياً جوه كل Edge Function، مفيش داعي تضبطهم.)

## 3. نشر الدوال الثلاثة
```
supabase functions deploy send-early-reminder
supabase functions deploy send-project-reminders --no-verify-jwt
supabase functions deploy send-statement --no-verify-jwt
```
`send-early-reminder` بيتستدعى عن طريق `supabase.functions.invoke()` من التطبيق (بيبعت توكن
المستخدم تلقائياً)، أما التانيين فبيتستدعوا بـ `fetch()` عادي من غير أي توكن — فلازم
`--no-verify-jwt` وإلا هترجع 401.

## اختبار سريع
بعد النشر، جرّب من التطبيق نفسه (زرار "تذكير" على أي قسط متأخر، أو زرار "إرسال كشف حساب"
على أي عميل عنده إيميل في حقل `email`/`mail`/`الايميل`/`البريد` ضمن بيانات العقد).
