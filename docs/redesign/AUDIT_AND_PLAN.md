# تدقيق الواجهة الحالية وخطة إعادة البناء

> وثيقة عمل لمرحلة إعادة التصميم والمصادقة. تُحدَّث عند اكتمال كل مرحلة.

## 1) ملخص التدقيق (قبل التعديل)

### البنية الحالية

- `apps/web`: Next.js 15 (App Router) + React 19، بلا نظام تصميم، بلا i18n، بلا مصادقة.
- 5 مسارات فقط: `/` (صفحة تسويقية)، `/dashboard`، `/inbox`، `/settings/configuration`، `/settings/product-types`.
- كل صفحة تشغيلية تحتوي نموذج «اتصال» يدوي: **Store ID (UUID) + Bearer token** يُخزَّن في React state ويُرسَل مع كل طلب.
- `globals.css` (1806 أسطر): ثيم داكن أخضر `#07110e`، خلفية radial-gradient، Accent نيون `#60e5a5`،
  عنوان clamp حتى 6.5rem، أرقام monospace، بطاقات مرقّمة 01/02/03 — كلها أنماط تسويقية لا تشغيلية.
- نصوص عربية hardcoded مختلطة بمصطلحات إنجليزية في نفس السطر؛ `letter-spacing` مطبّق على العربية؛ `<html lang="ar" dir="rtl">` ثابت.
- لا توجد صفحات إطلاقًا لـ: المنتجات، المخزون، الطلبات، العملاء، التكاملات، تسجيل الدخول.

### الـBackend (لا يتغير)

- NestJS + Fastify على `/api`، مصادقة Bearer JWT عبر OIDC/JWKS (Supabase Auth: `AUTH_ISSUER`/`AUTH_AUDIENCE`/`AUTH_JWKS_URI`).
- العزل متعدد المتاجر عبر RLS + `withTenantTransaction`؛ العضوية عبر `app_list_current_identity_memberships()`.
- الـEndpoints المتاحة فعلًا (تُستهلك كما هي دون تغيير عقود):
  - `GET/POST /tenants`، `GET /tenants/:id`، `GET /tenants/:id/audit-events`
  - `GET/POST /tenants/:t/products`، `GET/PUT/DELETE .../products/:id`، `POST .../products/:id/publish`، `GET .../products/by-code/:code`
  - `.../products/:id/media` (upload-ticket/complete/download)، `PUT .../content-links`
  - `GET /product-type-templates`، CRUD `.../product-types`
  - `.../inventory`: locations، balances (+reorder-point)، movements، receive/adjust/sales/returns، reservations (+release/commit)
  - `.../draft-orders` CRUD + submit/confirm/cancel؛ `.../orders` (status,q,limit) + `:id` + transition + cancel
  - `.../customers` CRUD + `:id/notes`
  - `.../conversations` (+messages/claim/release/status/links) + `handoff-metrics` + `agent-reply`
  - `.../rule-sets` (+draft/publish/evaluate-price)، `.../knowledge` (+search/draft/publish)، `.../agent-settings` (+draft/publish)
  - `.../operations/dashboard|alerts|traces/:id`
  - `.../integrations/instagram` GET/PUT/DELETE (لا يعيد قيمة التوكن إطلاقًا)

### المشاكل المؤكدة

1. إدخال Store ID وBearer token يدويًا في 4 صفحات.
2. لا توجد صفحات تسجيل دخول/إنشاء حساب حقيقية.
3. خلط العربية والإنجليزية داخل الصفحة نفسها.
4. تشوهات اتجاه النص العربي (letter-spacing وuppercase).
5. إفراط في الخلفية الخضراء الداكنة والبطاقات المتطابقة.
6. عناوين ضخمة تسويقية لا تناسب تطبيقًا تشغيليًا.
7. معلومات Dashboard مكدّسة في صفحة واحدة.
8. غياب صفحات جداول مكتملة للمنتجات والطلبات والمخزون والعملاء.

## 2) خطة التنفيذ (مراحل رأسية قابلة للبناء)

| المرحلة       | النطاق                                                                                                                         | معيار القبول                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| 1. Foundation | design tokens، خطوط next/font (Inter + IBM Plex Sans Arabic)، next-intl (ar/fr/en + RTL)، App shell، مكوّنات UI                | build أخضر وتبديل لغة/اتجاه يعمل                    |
| 2. Auth       | @supabase/ssr + PKCE، login/signup/forgot/reset/callback، حماية المسارات، اختيار المتجر، API client تلقائي، إزالة Bearer forms | لا Bearer token في الواجهة؛ الجلسة تصمد بعد refresh |
| 3. Products   | جدول + فلاتر + URL sync + إنشاء/تعديل/تفاصيل + نشر/أرشفة                                                                       | جدول احترافي مربوط بالبيانات الحقيقية               |
| 4. Operations | Inventory (أرصدة/حركات/حجوزات)، Orders (+timeline/transitions)، Customers (+ملف 360)                                           | صفحات تشغيل مستقلة                                  |
| 5. Channels   | Inbox (قائمة/محادثة/context + claim/release/رد)، AI Agent tabs، Integrations (Instagram)                                       | تدفقات حقيقية فقط                                   |
| 6. Polish     | Dashboard تشغيلية، Settings، a11y، responsive، أداء                                                                            | lint/typecheck/test/build + screenshots             |

## 3) قرارات هندسية

- **i18n**: `next-intl` مع بادئة `/[locale]`؛ `ar` افتراضي؛ `dir` تلقائي (rtl/ltr)؛ قواميس JSON منفصلة لكل لغة؛ لا نصوص hardcoded في المكوّنات.
- **Auth**: Supabase Auth (email/password، PKCE عبر `@supabase/ssr`). الحماية في middleware + guard في layout على الخادم. المتجر الحالي في cookie `ab_store_id` ويُختار من `GET /tenants`. لا service-role في المتصفح إطلاقًا.
- **API client**: عميل واحد مكتوب الأنواع في `lib/api` يضيف `Authorization` من جلسة Supabase و`X-Correlation-Id` لكل طلب، ويعالج 401 بتوجيه إلى login مع حفظ `next`.
- **State**: React server/client components فقط؛ لا مكتبة state إضافية.
- **Styling**: CSS نقي بطبقات (`tokens` → `base` → `components` → `shell` → `pages`) مع CSS logical properties؛ لا إطار CSS جاهز ولا Theme مستورد.
