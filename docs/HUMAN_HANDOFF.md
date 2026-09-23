# Human Handoff

يوفر مسار التحويل البشري انتقالًا ذريًا وآمنًا من البوت إلى صندوق الموظفين، مع ملخص سياق منقح، ملكية واضحة للمحادثة وقياسات انتظار وحل. لا يواصل البوت الرد بالتوازي مع الموظف.

## متى يحدث التحويل؟

الأسباب المنظمة المخزنة هي:

- `explicit_customer_request`
- `low_confidence`
- `safety_risk`
- `tool_failure`
- `pricing_policy`
- `order_exception`
- `unsupported_request`
- `manual`

عندما يعيد Customer Agent نتيجة `handoff`، ينفذ الـAPI أمر `request_human_handoff` مرة واحدة داخل معاملة واحدة:

1. يتحقق من أن المحادثة ما زالت في `bot` وأن AI Run المرتبط انتهى بـ`handoff`.
2. ينشئ سجل `handoffs` بحالة `pending` ومفتاح Idempotency.
3. يحفظ إشعارًا مناسبًا للعميل ويربطه بالسجل.
4. ينقل المحادثة من `bot` إلى `needs_human` ويوقف ردود البوت.
5. يضيف إشعارًا داخليًا للموظف ويسجل Command Tool وAudit event.

إعادة الرسالة نفسها تعيد سجل التحويل والإشعار نفسيهما ولا تنشئ تحويلًا أو ردًا ثانيًا.

## ملخص السياق الآمن

الملخص Structured وimmutable، ويحتوي فقط ما يحتاجه الموظف للبدء:

- Intent وسبب التحويل.
- آخر طلب للعميل بعد redaction وبحد أقصى 500 حرف.
- اسم العميل و`contactHint` محجوب.
- المنتج المرتبط، إن وجد.
- وجود هاتف/عنوان كقيم Boolean، وعدد بنود المسودة.
- معرفات وحالة Draft أو Order المرتبطين.

لا يحفظ الملخص الهاتف أو البريد أو العنوان الكامل. تبقى القيم الأصلية في سجلات العميل المحمية ولا تدخل إشعار التحويل.

## دورة الحياة والملكية

```text
pending --claim--> active --return to bot / close--> resolved
   ^                   |
   +------release------+
```

- يوجد تحويل مفتوح واحد فقط (`pending` أو `active`) لكل محادثة.
- `claim` يربط التحويل والمحادثة بالمستخدم الحالي ويسجل `first_claimed_at`.
- `release` متاح للموظف المعيّن فقط، يعيد المحادثة إلى `needs_human` ويحافظ على وقت الاستلام الأول.
- العودة إلى `bot` تحل التحويل بسبب `returned_to_bot`.
- إغلاق المحادثة يحله بسبب `conversation_closed`.
- الموظف لا يرسل ردًا للعميل إلا إذا كانت المحادثة `human` ومملوكة له.
- البوت لا يرسل عندما تكون المحادثة `needs_human` أو `human`.

## واجهات الـAPI

كل المسارات تتطلب OIDC Bearer token وعضوية فعالة في المتجر.

| Method | Path                                               | الغرض                                  |
| ------ | -------------------------------------------------- | -------------------------------------- |
| `POST` | `/conversations/:conversationId/claim`             | استلام المحادثة والتحويل المفتوح       |
| `POST` | `/conversations/:conversationId/release`           | تحرير الملكية وإعادتها إلى الطابور     |
| `POST` | `/conversations/:conversationId/status`            | إعادة البوت أو إغلاق المحادثة          |
| `GET`  | `/conversations/handoff-metrics`                   | أعداد الطابور ومتوسطات الاستجابة والحل |
| `GET`  | `/conversations` و`/conversations/:conversationId` | `activeHandoff` والسجل الكامل          |

بادئة المسارات هي `/api/tenants/:tenantId`.

### الاستلام

```json
{
  "expectedVersion": 3
}
```

### التحرير

```json
{
  "expectedVersion": 4,
  "reason": "نهاية المناوبة"
}
```

### إعادة البوت

```json
{
  "expectedVersion": 5,
  "targetStatus": "bot",
  "reason": "تم حل الاستثناء ويمكن متابعة التدفق الآلي"
}
```

تستخدم العمليات `expectedVersion` لمنع الكتابة المتزامنة. الردود الناجحة تعيد Conversation View المحدثة.

## القياسات

يعيد Endpoint القياسات:

- `pending`, `active`, `resolved`.
- `averageFirstResponseSeconds`: من طلب التحويل إلى أول استلام.
- `averageResolutionSeconds`: من طلب التحويل إلى الحل.

كل Handoff View يعيد كذلك `currentWaitSeconds`, `firstResponseSeconds` و`resolutionSeconds`. يعرض `/inbox` الطابور والملخص المنقح وأزرار الاستلام والتحرير والعودة للبوت.

## ضوابط قاعدة البيانات

- RLS يعزل `handoffs` حسب `tenant_id` والعضوية الفعالة.
- العلاقات المركبة تمنع ربط Conversation أو Message أو AI Run أو Assignee من متجر آخر.
- Partial unique index يمنع تحويلين مفتوحين للمحادثة نفسها.
- Trigger يمنع تعديل المصدر والسبب والـIntent والملخص ومفتاح Idempotency بعد الإنشاء.
- اختبارات التكامل تثبت العزل، عدم تكرار التحويل، توقف البوت، حصرية ملكية الموظف ومسار claim/release/resolve.
