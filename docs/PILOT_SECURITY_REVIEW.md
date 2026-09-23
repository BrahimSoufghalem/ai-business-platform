# Pilot Security Review

**تاريخ المراجعة التقنية:** 2026-09-21  
**النطاق:** API، Web Dashboard، PostgreSQL، AI Gateway، Customer Agent وعمليات Pilot  
**الحالة:** الضوابط التقنية الأساسية منفذة؛ إطلاق البيانات الحقيقية مشروط بتوقيع [Go/No-Go](PILOT_GO_NO_GO.md).

## الأدلة الآلية

```bash
pnpm pilot:gates
pnpm lint
pnpm typecheck
pnpm test
pnpm build
TEST_DATABASE_URL=postgresql://... pnpm --filter @ai-business/api test:integration
BACKUP_DATABASE_URL=postgresql://.../source \
RESTORE_DATABASE_URL=postgresql://.../pilot_restore \
RESTORE_DRILL_CONFIRM=ERASE_RESTORE_DATABASE \
pnpm restore:drill
```

`pilot:gates` يجمع:

- فحص أنماط الأسرار عالية الثقة في الملفات المتتبعة وغير المتجاهلة.
- `pnpm audit --prod --audit-level=high`.
- تقييمات intent بالعربية وحالات prompt injection/handoff واختبارات memory/runtime.

يجب أن تكون كل الأوامر خضراء على commit المرشح للإطلاق. فشل أي gate يمنع Go-Live.

## مراجعة التهديدات

| التهديد                         | الضابط                                                                  | الدليل المطلوب قبل Go-Live            | الحالة التقنية |
| ------------------------------- | ----------------------------------------------------------------------- | ------------------------------------- | -------------- |
| عبور بيانات بين المتاجر         | عضوية موثقة، tenant transaction، PostgreSQL RLS واختبارات سلبية         | اختبارات DB/API integration خضراء     | منفذ           |
| انتحال الهوية أو tenant ID      | OIDC issuer/audience/signature؛ tenant مرشح ثم تتحقق العضوية داخل DB    | إعدادات IdP وMFA ومستخدم Pilot تجريبي | منفذ/تشغيلي    |
| Prompt injection أو كشف تعليمات | router حتمي، allow-list للأدوات، grounding، redaction وsafety evals     | `pilot:gates` أخضر                    | منفذ           |
| كتابة AI غير مصرح بها           | Command Tools مغلقة، authorization داخل Tool، idempotency وaudit        | trace لرحلة message→tool→order        | منفذ           |
| تكرار الطلب/الحجز               | idempotency keys، transactions، constraints واختبارات إعادة التشغيل     | سيناريو تأكيد مكرر بلا أثر مكرر       | منفذ           |
| تسريب PII أو token في logs      | structured metadata فقط، إخفاء route IDs ومنع body/message/token        | مراجعة عينة logs                      | منفذ           |
| إساءة الاستخدام/الإغراق         | حدود لكل subject/method/route وحد أقل لمسار agent                       | اختبار `429` و`Retry-After`           | منفذ لـPilot   |
| اعتماد ضعيف أو سر داخل المستودع | dependency audit وsecret scan في CI                                     | `security-gates` أخضر                 | منفذ           |
| فقد/فساد البيانات               | backup مقيّد الصلاحيات وتجربة restore مع مقارنة schema/migrations       | سجل restore ناجح ضمن RTO              | منفذ/تشغيلي    |
| صلاحية زائدة للوحة              | `audit:read` للـowner/manager وRLS؛ لا تعيد نص الرسائل في trace         | اختبار 403 والعزل                     | منفذ           |
| بيانات Pilot غير منضبطة         | manifest محدود، تحقق صارم، متجر موجود، idempotent inventory وaudit hash | rerun يثبت عدم مضاعفة الرصيد          | منفذ           |

## تغييرات الاعتمادات

- `drizzle-orm` مضبوط على إصدار مصحح من ثغرة escaping للمعرّفات.
- `fastify` و`postcss` مثبتان عبر قيود workspace على إصدارات مصححة.
- بوابة CI ترفض ثغرات production ذات مستوى `high` أو `critical`.

لا يكفي نجاح الفحص في يوم المراجعة؛ يجب إعادة تشغيله على commit المرشح للإطلاق.

## الأسرار

- القيم الحقيقية تأتي من Secret Manager للبيئة ولا تُكتب في `.env.example`.
- يجب تدوير مفاتيح OIDC/AI/Instagram/S3 قبل Pilot إذا استُخدمت في بيئة مشتركة.
- فحص المستودع لا يغطي تلقائيًا تاريخ Git أو أسرار البنية التحتية؛ يجب فحصهما في منصة الاستضافة.
- أي نتيجة اشتباه تعامل كتسريب: revoke ثم rotate ثم تحقيق، وليس مجرد حذف الملف.

## الخصوصية والاحتفاظ

- ابدأ ببيانات اصطناعية.
- لا تنسخ نص المحادثة أو الهاتف أو العنوان إلى logs أو feedback.
- traces التشغيلية تعرض metadata فقط.
- يجب اعتماد مدة الاحتفاظ للمحادثات وAI traces والنسخ الاحتياطية، ومسار الحذف/التصدير، قبل البيانات الحقيقية.
- يجب تأكيد منطقة معالجة مزود AI وشروطه، وتعطيل استخدام البيانات للتدريب إن كان ذلك متاحًا.

## المخاطر المتبقية

| الخطر المتبقي                             | القيد الحالي                           | شرط الإغلاق/التخفيف                                     |
| ----------------------------------------- | -------------------------------------- | ------------------------------------------------------- |
| Rate limiter داخل ذاكرة نسخة API          | Pilot بنسخة واحدة فقط                  | مخزن موزع قبل horizontal scaling                        |
| لا يوجد paging خارجي للتنبيهات            | متابعة اللوحة يدويًا خلال ساعات Pilot  | ربط alerting مُدار قبل تغطية 24/7                       |
| تشفير النسخة ليس داخل السكريبت            | تخزين مُدار مشفر ونقل مقيد             | إثبات encryption/retention/access                       |
| مزود AI خارجي                             | بيانات دنيا + redaction + Safe Handoff | DPA/region/retention sign-off                           |
| قناة Instagram الحية ليست ضمن هذا التسليم | القناة الحية معطلة                     | مراجعة webhook signature/replay والـsandbox قبل التفعيل |
| الاستجابة للحوادث تعتمد على مشغل محدد     | مسؤول مناوب واحد وبديل موثق            | تمرين tabletop وتأكيد جهات الاتصال                      |

وجود خطر متبقٍ غير مقبول أو بلا مسؤول/موعد يعني **No-Go**.

## اعتماد المراجعة

| الدور               | الاسم | التاريخ | القرار | ملاحظات |
| ------------------- | ----- | ------- | ------ | ------- |
| Engineering         |       |         |        |         |
| Product/Pilot owner |       |         |        |         |
| Security/Privacy    |       |         |        |         |

لا تعتبر هذه الصفحة موقعة حتى تُملأ الصفوف الثلاثة ويُربط كل استثناء بتذكرة ومسؤول وتاريخ إغلاق.
