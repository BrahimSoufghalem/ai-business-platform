# Deployment — Vercel + Supabase

هذا الدليل يجعل نشر staging قابلًا للتكرار وفق [ADR-0001](adr/0001-proposed-stack.md). لا تستخدم مشروع Supabase أو مفاتيح production في staging.

## البنية

| الجزء      | Staging project                             |
| ---------- | ------------------------------------------- |
| Web        | Vercel project، Root Directory = `apps/web` |
| API        | Vercel project، Root Directory = `apps/api` |
| DB/Auth/S3 | Supabase project مستقل في منطقة EU          |
| Deploy     | GitHub Actions: `Deploy staging`            |

في مشروعي Vercel فعّل الوصول إلى ملفات monorepo خارج Root Directory. الإعدادات الموجودة في `apps/web/vercel.json` و`apps/api/vercel.json` تثبت build command والمنطقة.

## إعداد Supabase staging

1. أنشئ مشروعًا أوروبيًا منفصلًا ببيانات اصطناعية.
2. أنشئ runtime DB role بلا ملكية للجداول ولا `BYPASSRLS`.
3. استخدم pooled URL للـAPI وdirect/session URL المسموح للمigrations.
4. اضبط Supabase Auth وأضف redirect URLs الخاصة بـstaging.
5. اضبط Storage bucket خاصًا بالمتجر، private افتراضيًا.

## متغيرات Vercel

### API project

```text
NODE_ENV=production
DATABASE_URL=<pooled runtime role URL>
WEB_ORIGIN=https://<staging-web-domain>
AUTH_ISSUER=<Supabase Auth issuer>
AUTH_AUDIENCE=<accepted audience>
AUTH_JWKS_URI=<Supabase JWKS URL>
AI_PROVIDER_*=<managed staging values>
S3_*=<Supabase Storage S3 values>
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=120
RATE_LIMIT_AGENT_MAX_REQUESTS=30
PILOT_HANDOFF_WAIT_ALERT_SECONDS=900
```

### Web project

```text
NEXT_PUBLIC_API_BASE_URL=https://<staging-api-domain>/api
```

لا تضع service-role key في Web أو في متغير يبدأ بـ`NEXT_PUBLIC_`.

## GitHub environment

أنشئ Environment باسم `staging` مع approval اختياري، ثم أضف:

| Secret                                    | الغرض                                 |
| ----------------------------------------- | ------------------------------------- |
| `VERCEL_TOKEN`                            | Token محدود للنشر                     |
| `VERCEL_ORG_ID`                           | Team/account ID                       |
| `VERCEL_API_STAGING_PROJECT_ID`           | مشروع API staging                     |
| `VERCEL_WEB_STAGING_PROJECT_ID`           | مشروع Web staging                     |
| `SUPABASE_STAGING_MIGRATION_DATABASE_URL` | اتصال migrations فقط                  |
| `VERCEL_AUTOMATION_BYPASS_SECRET`         | اختياري لاختبار deployment protection |

Runtime secrets تبقى داخل Vercel، ولا تمر في Workflow.

## النشر

1. ادمج commit أخضر إلى `main`.
2. من Actions شغّل `Deploy staging`.
3. الـWorkflow يعيد quality gates، يطبق migrations، يبني وينشر API ثم Web، ثم يفحص:
   - `/api/health/live`
   - `/api/health/ready`
   - الصفحة الرئيسية للـWeb.
4. نفّذ smoke يدويًا للـlogin وDashboard وInbox ببيانات اصطناعية.

## Rollback

- **Web/API:** اعمل Promote لآخر deployment سليم من Vercel.
- **Database:** migrations forward-only؛ نفذ forward fix، ولا تعمل rollback يدويًا على بيانات Pilot.
- عند فشل migration لا ينفذ deploy، وعند فشل smoke يبقى الـWorkflow أحمر ويجب إعادة Promote للنسخة السابقة.

## Production

استخدم مشاريع Vercel وSupabase جديدة ومفاتيح منفصلة. انسخ الإعدادات لا القيم، وطبّق [Pilot Go/No-Go](PILOT_GO_NO_GO.md) قبل أول بيانات حقيقية. لا تجعل Workflow staging ينشر إلى مشاريع production.
