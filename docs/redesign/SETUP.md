# إعداد المصادقة والتشغيل بعد إعادة التصميم

## متغيرات البيئة الجديدة (apps/web)

| المتغير | النوع | المصدر |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | عام (آمن للمتصفح) | Supabase → Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | عام (anon public key) | Supabase → Project Settings → API → anon public |
| `NEXT_PUBLIC_API_BASE_URL` | عام | عنوان الـAPI، محليًا `http://localhost:3001/api` |

> لا تضع `service_role` في أي متغير `NEXT_PUBLIC_*` إطلاقًا. الـAPI يستمر في التحقق عبر
> `AUTH_ISSUER` / `AUTH_AUDIENCE` / `AUTH_JWKS_URI` كما هو اليوم.

## إعداد Supabase Auth

1. أنشئ مشروع Supabase (أو استخدم الحالي).
2. **Authentication → URL Configuration**:
   - Site URL: `https://<your-web-domain>` (محليًا `http://localhost:3000`).
   - Redirect URLs — أضف لكل لغة ولكل بيئة:
     - `http://localhost:3000/ar/auth/callback`
     - `http://localhost:3000/fr/auth/callback`
     - `http://localhost:3000/en/auth/callback`
     - `https://<your-web-domain>/ar/auth/callback` (ونفسها لـ fr وen)
3. **Authentication → Providers → Email**: فعّل Email. فعّل «Confirm email» لإلزام تأكيد البريد.
4. لا حاجة لأي migrations: المصادقة كلها على جانب Supabase، والعضويات تُقرأ من قاعدة البيانات الحالية
   عبر `app_list_current_identity_memberships()` باستخدام `sub` من توكن Supabase (لا تغيير في الـBackend).

## التدفقات المنفذة

- `/[locale]/login` — تسجيل دخول بالبريد وكلمة المرور، تذكّر الجلسة، رسائل خطأ مترجمة.
- `/[locale]/signup` — حساب جديد + تأكيد بريد اختياري حسب إعداد Supabase.
- `/[locale]/forgot-password` و`/reset-password` — استعادة كاملة عبر رابط آمن (PKCE).
- `/[locale]/auth/callback` — تبادل الكود بالجلسة، ثم الرجوع إلى `next` الآمن.
- `/[locale]/confirm-email` و`/auth-error` — حالات واضحة.
- `/[locale]/select-store` — اختيار المتجر من `GET /api/tenants`، أو إنشاء أول متجر (onboarding).
- الحماية: `src/middleware.ts` يحدّث الجلسة ويعيد التوجيه؛ و`[locale]/(app)/layout.tsx` يتحقق على الخادم
  (لا يظهر أي جزء من الصفحات المحمية قبل التحقق). عند 401 يحوّل الـAPI client إلى `/login?next=…`.

## التشغيل محليًا

```bash
cp .env.example .env   # املأ NEXT_PUBLIC_SUPABASE_* و DATABASE_URL و AUTH_*
pnpm install
docker compose up -d postgres
pnpm db:migrate
pnpm dev             # web على 3000 و api على 3001
```

## النشر

- **Web (Vercel)**: Root Directory = `apps/web`، وأضف متغيرات `NEXT_PUBLIC_*` الثلاثة. `vercel.json` الحالي يعمل كما هو.
- **API (Vercel)**: Root Directory = `apps/api`، ولا تغيير على متغيراته (تأكد أن `WEB_ORIGIN` يطابق نطاق الويب).
- **Worker (Railway)**: خدمة دائمة من `apps/worker`؛ لا تغيير.
- حدّث Redirect URLs في Supabase لنطاق staging/production قبل أول مستخدم حقيقي.
