# Business Rules, Knowledge Base & Agent Settings

توفر هذه الوحدة إعدادات المتجر القابلة للإصدار مع دورة حياة موحدة:

```text
draft → published → superseded
```

لا يقرأ مسار التشغيل إلا الإصدار `published`. حفظ مسودة جديدة لا يغير السلوك المنشور، ونشرها يحول الإصدار المنشور السابق إلى `superseded` مع الاحتفاظ بسجل التغييرات.

جميع المسارات تحت:

```text
/api/tenants/:tenantId
```

وتتطلب OIDC Bearer token وعضوية فعالة داخل المتجر. يحتاج العرض التشغيلي إلى `configuration:read`، بينما تحتاج إدارة المسودات والنشر إلى `configuration:manage`.

## Business Rules

### نموذج سياسة السعر

القواعد Typed ولا تقبل تعليمات حرة أو كودًا قابلًا للتنفيذ:

```json
{
  "currency": "DZD",
  "negotiable": true,
  "minimumPrice": {
    "type": "percentage_of_list",
    "percentage": 85
  },
  "maxDiscountPercent": 10,
  "escalation": {
    "belowMinimum": "counter",
    "whenNotNegotiable": "handoff",
    "maxCounterOffers": 2
  }
}
```

يمكن أن تكون `minimumPrice` مبلغًا ثابتًا أيضًا:

```json
{
  "type": "fixed",
  "amount": "9000.00"
}
```

الحساب يتم بوحدات نقدية صغرى دون حسابات floating-point، ويعيد إحدى النتائج: `accept` أو `counter` أو `handoff` أو `reject`.

### المسارات

- `GET /rule-sets?limit=50` — القواعد مع المسودة والمنشور والسجل.
- `POST /rule-sets` — إنشاء Rule Set ومسودة `v1`.
- `GET /rule-sets/:ruleSetId` — المعاينة وسجل الإصدارات.
- `PUT /rule-sets/:ruleSetId/draft` — إنشاء مسودة immutable جديدة.
- `POST /rule-sets/:ruleSetId/versions/:versionId/publish` — نشر المسودة الحالية.
- `POST /rule-sets/:ruleSetId/evaluate-price` — اتخاذ قرار سعر بالإصدار المنشور فقط.

إنشاء Rule Set:

```json
{
  "key": "default-pricing",
  "name": "Default pricing policy",
  "description": "Default negotiation limits",
  "policy": {
    "currency": "DZD",
    "negotiable": true,
    "minimumPrice": {
      "type": "percentage_of_list",
      "percentage": 85
    },
    "maxDiscountPercent": 10,
    "escalation": {
      "belowMinimum": "counter",
      "whenNotNegotiable": "handoff",
      "maxCounterOffers": 2
    }
  },
  "changeNote": "Initial policy"
}
```

حفظ مسودة يتطلب نسخة التجميع الحالية لمنع الكتابة فوق تعديل متزامن:

```json
{
  "expectedSetVersion": 1,
  "policy": {
    "currency": "DZD",
    "negotiable": true,
    "minimumPrice": {
      "type": "fixed",
      "amount": "9000.00"
    },
    "maxDiscountPercent": 10,
    "escalation": {
      "belowMinimum": "handoff",
      "whenNotNegotiable": "reject",
      "maxCounterOffers": 1
    }
  },
  "changeNote": "Raise the minimum price"
}
```

طلب قرار السعر:

```json
{
  "currency": "DZD",
  "listPrice": "10000.00",
  "requestedPrice": "8500.00",
  "productId": null,
  "conversationId": null
}
```

كل قرار محفوظ يعيد ويلزم المراجع التالية:

```json
{
  "rule": {
    "ruleSetId": "uuid",
    "ruleVersionId": "uuid",
    "version": 2
  },
  "outcome": "counter",
  "decidedPrice": "9000.00"
}
```

قاعدة البيانات ترفض إنشاء قرار لا يشير إلى الإصدار المنشور لحظة القرار. السجل السابق يبقى صالحًا تاريخيًا بعد نشر إصدار أحدث.

## Knowledge Base

أنواع المحتوى: `faq` و`article` و`policy`.

### المسارات

- `GET /knowledge?limit=50` — المحتوى مع المسودة والمنشور والسجل.
- `POST /knowledge` — إنشاء مدخل ومسودة `v1`.
- `GET /knowledge/:entryId` — المعاينة وسجل الإصدارات.
- `PUT /knowledge/:entryId/draft` — إنشاء مسودة immutable جديدة.
- `POST /knowledge/:entryId/versions/:versionId/publish` — نشر المسودة.
- `GET /knowledge/search?q=shipping&kind=faq&limit=8` — بحث بسيط في المنشور فقط.

مثال إنشاء:

```json
{
  "slug": "delivery-times",
  "kind": "faq",
  "title": "Delivery times",
  "question": "How long does delivery take?",
  "content": "Delivery normally takes 2–4 business days.",
  "changeNote": "Initial answer"
}
```

نتيجة البحث ليست Prompt ولا System Message. تعاد داخل غلاف صريح:

```json
{
  "kind": "knowledge_grounding",
  "trust": "untrusted_content",
  "embeddedInstructions": "ignore",
  "items": [
    {
      "id": "uuid",
      "versionId": "uuid",
      "version": 1,
      "title": "Delivery times",
      "content": "Delivery normally takes 2–4 business days."
    }
  ]
}
```

حتى لو احتوى النص على عبارة مثل “تجاهل تعليمات النظام”، تبقى العبارة بيانات غير موثوقة داخل `items[].content`. على أي Provider adapter إبقاء الغلاف كبيانات وعدم دمجه في تعليمات النظام.

## Agent Settings

الإعدادات المسموحة فقط:

- `language`: `ar` أو `fr` أو `en`.
- `tone`: `professional` أو `friendly` أو `concise` أو `warm`.
- `handoffNotes`: ملاحظات تحويل للموظف حتى 1000 حرف.

لا توجد خاصية قابلة للتحرير باسم System Prompt أو تعليمات تنفيذ أو كود. تستخدم المدخلات Schema صارمة ترفض أي مفاتيح إضافية.

### المسارات

- `GET /agent-settings` — المسودة والمنشور وسجل التغييرات.
- `GET /agent-settings/published` — إعدادات التشغيل المنشورة فقط.
- `PUT /agent-settings/draft` — إنشاء مسودة جديدة.
- `POST /agent-settings/versions/:versionId/publish` — نشر أحدث مسودة.

حفظ المسودة:

```json
{
  "expectedLatestVersion": 0,
  "language": "ar",
  "tone": "friendly",
  "handoffNotes": "حوّل المحادثة عند وجود شكوى مالية.",
  "changeNote": "Initial settings"
}
```

تعاد ملاحظات التحويل لمسار التشغيل كبيانات:

```json
{
  "language": "ar",
  "tone": "friendly",
  "handoff": {
    "trust": "untrusted_content",
    "notes": "حوّل المحادثة عند وجود شكوى مالية."
  }
}
```

## الضمانات

- RLS وForeign Keys مركبة تمنع أي ربط بين متجرين.
- يوجد بحد أقصى Draft واحد وPublished واحد لكل كيان.
- محتوى كل Version immutable؛ التعديل ينشئ Version جديدًا.
- `expected*Version` يطبق optimistic concurrency ويرجع `409` عند التعارض.
- المسودات غير متاحة للبحث أو قرارات السعر أو إعدادات الوكيل التشغيلية.
- عمليات الإنشاء والحفظ والنشر وقرارات السعر تسجل `audit_events`.
- `pricing_decisions` append-only وتحفظ نسخة القاعدة الدقيقة و`correlation_id`.

## واجهة الإدارة

المسار `/settings/configuration` يوفر:

- محرر Typed لقواعد السعر.
- محرر FAQ/Knowledge.
- إعدادات اللغة والنبرة والتحويل الآمنة.
- Preview للإصدار المحدد.
- حالات واضحة للمسودة والمنشور.
- سجل إصدارات مع `changeNote` وتاريخ النشر.
