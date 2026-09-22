# Customers & Conversations API

توفر هذه الوحدة ملف عميل موحدًا وصندوق محادثات داخليًا، مع عزل كامل حسب المتجر. كل المسارات تبدأ بـ`/api/tenants/:tenantId` وتتطلب OIDC Bearer token وعضوية نشطة.

## ملفات العملاء

| Method | Path                           | الغرض                                                   |
| ------ | ------------------------------ | ------------------------------------------------------- |
| `GET`  | `/customers`                   | بحث بالاسم أو الاتصال المطبّع مع `status`, `q`, `limit` |
| `POST` | `/customers`                   | إنشاء ملف أو إعادة الملف الموجود عند اكتشاف اتصال مطابق |
| `GET`  | `/customers/:customerId`       | الملف والعناوين والملاحظات والطلبات والمحادثات السابقة  |
| `PUT`  | `/customers/:customerId`       | تحديث Optimistic باستخدام `expectedVersion`             |
| `POST` | `/customers/:customerId/notes` | إضافة ملاحظة داخلية append-only                         |

### مثال إنشاء

```json
{
  "name": "سارة بن علي",
  "contacts": [
    { "type": "phone", "value": "0555 12 34 56", "isPrimary": true },
    { "type": "email", "value": "sara@example.com" }
  ],
  "addresses": [
    {
      "label": "المنزل",
      "line1": "10 شارع ديدوش مراد",
      "city": "الجزائر",
      "countryCode": "DZ",
      "isDefault": true
    }
  ],
  "metadata": { "segment": "pilot" }
}
```

تُطبّع الهواتف إلى E.164، والبريد وInstagram إلى lowercase. يمنع القيد الفريد `(tenant, normalized_value)` وجود ملفين لنفس الاتصال داخل المتجر، بما في ذلك استعمال الرقم نفسه كـPhone وWhatsApp، لكنه يسمح بنفس الاتصال في متجر آخر. إذا وجد `POST` اتصالًا مطابقًا يعيد الملف الموجود مع `deduplicated: true`. لا تُعاد قيمة الاتصال الخام من API القراءة؛ تظهر قيمة محجوبة فقط.

## المحادثات

| Method | Path                                         | الغرض                                                                   |
| ------ | -------------------------------------------- | ----------------------------------------------------------------------- |
| `GET`  | `/conversations`                             | صندوق مرتب بالأولوية مع `status`, `channel`, `assignment`, `q`, `limit` |
| `POST` | `/conversations`                             | بدء محادثة وربطها بالعميل والسجلات الاختيارية                           |
| `GET`  | `/conversations/:conversationId`             | السياق والرسائل وتاريخ الحالات                                          |
| `POST` | `/conversations/:conversationId/messages`    | إضافة رسالة idempotent عند وجود `externalId`                            |
| `POST` | `/conversations/:conversationId/claim`       | استلام الموظف للمحادثة                                                  |
| `POST` | `/conversations/:conversationId/status`      | تغيير الحالة أو الإغلاق/إعادة الفتح                                     |
| `PUT`  | `/conversations/:conversationId/links`       | ربط عميل أو منتج أو Draft أو Order                                      |
| `POST` | `/conversations/:conversationId/agent-reply` | تشغيل Grounded Agent لرسالة inbound محفوظة                              |

القنوات المتاحة الآن: `internal`, `instagram`, `whatsapp`, `web`, `email`. قناة `internal` مخصصة للاختبار قبل تشغيل Webhooks الخارجية.

### مثال محادثة اختبار

```json
{
  "customerId": "11111111-1111-4111-8111-111111111111",
  "channel": "internal",
  "externalThreadId": "test-thread-42",
  "status": "needs_human",
  "subject": "استفسار عن توفر منتج",
  "productId": "22222222-2222-4222-8222-222222222222",
  "initialMessage": {
    "direction": "inbound",
    "senderType": "customer",
    "externalId": "test-message-1",
    "content": "هل هذا المنتج متوفر؟"
  }
}
```

### Idempotency الرسائل

- المفتاح الفريد هو `(tenant_id, conversation_id, external_id)`.
- إعادة نفس `externalId` ونفس payload تعيد الرسالة الحالية مع `replayed: true`.
- استعمال المفتاح نفسه مع محتوى مختلف يرجع `409 Conflict`.
- الرسائل وتاريخ الحالات append-only بالنسبة إلى دور التشغيل.
- `agent-reply` يقبل `messageId`؛ إعادة الرسالة نفسها تعيد رد البوت المخزن مع `replayed: true`.
- كل رد Agent يحمل `runId` وأدلة Tool Calls، ولا يعمل عندما تكون المحادثة بيد موظف.

## الحالات والتعيين

الحالات هي:

```text
bot ↔ needs_human ↔ human → closed
bot → human
closed → bot | needs_human
```

`claim` يحول المحادثة إلى `human` ويربطها بالمستخدم الحالي. يمنع استلام محادثة مرتبطة بموظف آخر. تستخدم أوامر الاستلام والحالة والروابط `expectedVersion` لمنع الكتابة فوق تعديل متزامن.

## الخصوصية والتدقيق

- القائمة والواجهة تعرضان `contactHint` محجوبًا بدل الهاتف أو البريد الكامل.
- رمز الدخول في `/inbox` يبقى في ذاكرة الصفحة ولا يُخزن في Local Storage.
- لا تسجل Audit metadata محتوى الرسالة أو قيم الاتصال أو External IDs.
- عمليات الإنشاء والتحديث والاستلام والحالة والروابط والرسائل الناجحة تُسجل في `audit_events`.
- RLS يفرض `tenant_id` وعضوية نشطة على العملاء والاتصالات والعناوين والملاحظات والمحادثات والرسائل.

## الصندوق الداخلي

المسار `/inbox` في تطبيق الويب يوفر:

- فلترة حسب الحالة وإبراز `needs_human`.
- عرض اسم العميل وقيمة اتصال محجوبة وآخر رسالة.
- قراءة السياق والروابط والسجل.
- استلام المحادثة، الرد، الإغلاق وإعادة الفتح.
- حالات تحميل وفشل وفراغ، وتصميم متجاوب للشاشات الصغيرة.

للتطوير المحلي:

```dotenv
WEB_ORIGIN=http://localhost:3000
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001/api
```
