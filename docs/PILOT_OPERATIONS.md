# Pilot Operations Runbook

هذا الدليل مخصص لمرحلة Pilot محدودة ببيانات اصطناعية أولًا. لا يُسمح بإدخال بيانات عميل حقيقية قبل اكتمال [قائمة Go/No-Go](PILOT_GO_NO_GO.md) وتوقيعها.

## لوحة التشغيل

تتوفر اللوحة في `/dashboard`، وتتطلب:

- معرّف متجر UUID.
- Bearer token صالح في ذاكرة الصفحة فقط؛ لا يُحفظ في المتصفح.
- عضوية `owner` أو `manager` تملك صلاحية `audit:read`.

النوافذ المدعومة: `7d` و`30d` و`90d`.

| المؤشر         | التعريف                                                                     |
| -------------- | --------------------------------------------------------------------------- |
| الطلبات        | إجمالي الطلبات، النشطة، المسلّمة، الملغاة والتوزيع حسب الحالة ضمن المدة     |
| المبيعات       | مجموع الطلبات غير الملغاة مجمّعًا حسب العملة ضمن المدة                      |
| المخزون        | أرصدة عند حد إعادة الطلب أو دونه، وحالات نفاد المخزون الحالية               |
| التحويل للموظف | pending/active/resolved ومتوسط زمن أول استجابة والحل                        |
| AI             | عدد التشغيلات، نسبة التحويل، متوسط وP95 latency، التكلفة المقدرة وفشل Tools |
| النشاط اليومي  | الطلبات والتحويلات وتشغيلات AI حسب المنطقة الزمنية للمتجر                   |

### API

```text
GET /api/tenants/:tenantId/operations/dashboard?range=30d
GET /api/tenants/:tenantId/operations/alerts?limit=20
GET /api/tenants/:tenantId/operations/traces/:correlationId
```

كل استدعاء يمر عبر التحقق من الهوية والعضوية وRLS. لا يعيد trace نص الرسائل أو مدخلات Tool الحرة؛ يعيد المعرّفات والحالة والتوقيت والبيانات التشغيلية اللازمة للتشخيص فقط.

## التنبيهات

| النوع           | Warning                 | Critical             | الإجراء الأول                        |
| --------------- | ----------------------- | -------------------- | ------------------------------------ |
| Low stock       | المتاح ≤ حد إعادة الطلب | المتاح = 0           | تحقق من الحركة ثم حدّث المخزون بأمر  |
| Handoff wait    | تجاوز حد الانتظار       | تجاوز ضعفي الحد      | استلم المحادثة أو صعّد للمسؤول       |
| AI tool failure | فشل/رفض Read Tool       | فشل/رفض Command Tool | أوقف الأتمتة وافتح trace قبل الإعادة |

يُضبط حد انتظار التحويل بواسطة `PILOT_HANDOFF_WAIT_ALERT_SECONDS`، والقيمة الافتراضية 900 ثانية. التنبيهات Read Model وليست بديلًا عن نظام paging خارجي.

## Correlation trace

1. انسخ `X-Correlation-Id` من الاستجابة أو معرّف الارتباط من سجل الخطأ.
2. ابحث عنه من لوحة Pilot أو endpoint الخاص بالـtrace.
3. تحقق من التسلسل: `message → ai_run → tool_call → order/handoff → audit`.
4. عند غياب حلقة، سجّل المعرّف والتوقيت ونوع الحلقة المفقودة في feedback log.
5. لا تنسخ محتوى الرسالة أو الهاتف أو العنوان إلى السجل التشغيلي.

## السجلات والصحة

يسجل API أحداث JSON منظمة:

- `http_request` أو `http_request_failed`
- `correlationId`
- method وroute بعد تعميم المعرّفات
- statusCode وdurationMs
- `errorType` فقط عند الفشل

لا يسجل الـinterceptor body أو token أو نص الرسالة. كل استجابة تحمل `X-Correlation-Id`.

```text
GET /api/health/live   # العملية تعمل
GET /api/health/ready  # الاتصال بقاعدة البيانات يعمل
```

فشل `ready` يمنع توجيه حركة جديدة إلى النسخة.

## Rate limits

| المتغير                         | الافتراضي | الغرض                       |
| ------------------------------- | --------- | --------------------------- |
| `RATE_LIMIT_WINDOW_MS`          | 60000     | نافذة القياس                |
| `RATE_LIMIT_MAX_REQUESTS`       | 120       | حد كل subject/method/route  |
| `RATE_LIMIT_AGENT_MAX_REQUESTS` | 30        | حد أدنى لمسار `agent-reply` |

يرجع التجاوز `429` مع `Retry-After` و`X-RateLimit-*`.

> المحدد الحالي داخل ذاكرة العملية ومناسب لنسخة API واحدة في Pilot فقط. قبل التوسع الأفقي يجب نقله إلى مخزن مشترك وموزع.

## النسخ والاستعادة

### هدف Pilot

- **RPO مستهدف:** 24 ساعة كحد أقصى.
- **RTO مستهدف:** ساعتان كحد أقصى.
- نسخة يومية مشفرة في مخزن مُدار منفصل عن قاعدة الإنتاج.
- تجربة استعادة أسبوعية وأخرى إلزامية قبل Go-Live.

السكريبت المحلي يضبط صلاحيات الملف، لكنه لا يشفره. مسؤول التشغيل ملزم بنقله فورًا إلى تخزين مشفر ذي retention واختبار وصول.

### إنشاء نسخة

```bash
BACKUP_DATABASE_URL=postgresql://... pnpm backup
```

أو لتحديد المسار:

```bash
BACKUP_DATABASE_URL=postgresql://... BACKUP_OUTPUT=/secure/path/pilot.dump pnpm backup
```

النجاح يتطلب أن يستطيع `pg_restore --list` قراءة الملف.

### تجربة الاستعادة

استخدم قاعدة منفصلة اسمها يحتوي `restore`. لا تستخدم قاعدة staging أو production كهدف.

```bash
BACKUP_DATABASE_URL=postgresql://.../source \
RESTORE_DATABASE_URL=postgresql://.../pilot_restore \
RESTORE_DRILL_CONFIRM=ERASE_RESTORE_DATABASE \
pnpm restore:drill
```

التجربة تعيد إنشاء schema الهدف ثم تقارن عدد جداول `public` وعدد migrations. بعد نجاحها:

1. تحقق من timestamp وحجم النسخة.
2. شغّل health/read-only smoke test على قاعدة الاستعادة.
3. سجل زمن النسخ والاستعادة والنتيجة في دليل Go/No-Go.
4. احذف قاعدة الاستعادة والنسخة المؤقتة وفق سياسة البيئة.

## Seed محدود للـPilot

الاستيراد يقبل manifest من 1 إلى 25 منتجًا، ويعمل على متجر موجود وعضوية نشطة فقط. استخدم بيانات اصطناعية قبل Go-Live.

```bash
cp scripts/pilot-seed.example.json /tmp/pilot-seed.json
# عدّل tenantId وidentitySubject والمنتجات الاصطناعية
DATABASE_URL=postgresql://... \
PILOT_SEED_CONFIRM=SEED_EXISTING_TENANT \
pnpm pilot:seed /tmp/pilot-seed.json
```

العملية:

- تتحقق من UUID والعملات والرموز والأسعار والأرصدة والحد الأقصى للحجم.
- تستخدم upsert للكتالوج والموقع.
- تسجل استلام المخزون بأمر idempotent؛ إعادة الملف نفسه لا تضاعف الرصيد.
- تكتب audit event مع SHA-256 للـmanifest، دون حفظ الملف نفسه.

يُرفض التشغيل دون عبارة التأكيد. لا تستخدم هذا المسار لاستيراد محادثات أو بيانات شخصية.

## Runbooks للحوادث

### فشل Command Tool أو تضارب طلب

1. أوقف الرد الآلي للمحادثة وحوّلها لموظف.
2. افتح trace بالـcorrelation ID.
3. تحقق من order command وaudit event قبل أي إعادة.
4. لا تعِد Command Tool يدويًا ما لم يؤكد السجل أن الأثر لم يحدث.
5. سجّل incident وقرار الاستعادة/التصحيح.

### ارتفاع AI latency أو التكلفة

1. قارن P95 وعدد التشغيلات بالنطاق السابق.
2. تحقق من timeout/fallback ونموذج routing.
3. خفّض traffic أو فعّل Safe Handoff؛ لا ترفع الميزانية تلقائيًا.
4. راقب failed tools وhandoff rate بعد التغيير.

### تراكم Handoff

1. عيّن موظفًا للمحادثات الأقدم أولًا.
2. تحقق من إشعار التحويل مرة واحدة ومن توقف البوت.
3. صعّد عند بلوغ ضعف حد الانتظار.
4. وثق النقص في التدريب أو التغطية.

### تنبيه مخزون

1. قارن balance مع سجل الحركات.
2. لا تعدل الرصيد مباشرة.
3. استخدم أمر receive/adjust مصرحًا مع سبب ومفتاح idempotency.
4. تحقق من اختفاء التنبيه وبقاء audit trail.

### اشتباه تسريب سر

1. عطّل ودوّر السر فورًا؛ لا تنتظر تأكيد الاستغلال.
2. أوقف التكامل المتأثر وراجع logs بالمعرّفات لا بالمحتوى.
3. شغّل `pnpm security:secrets` وراجع history في قناة الاستجابة للحوادث.
4. لا تعِد السر إلى مستودع أو feedback log.

## سجل التجربة والتصعيد

استخدم [قالب feedback](templates/PILOT_FEEDBACK_LOG.md). كل إدخال يحتاج severity وcorrelation ID ومسؤولًا وحالة، مع منع PII. أي حالة `P0/P1` أو فقد بيانات أو أثر مكرر تحول القرار تلقائيًا إلى **No-Go** حتى الإغلاق وإعادة الاختبار.
