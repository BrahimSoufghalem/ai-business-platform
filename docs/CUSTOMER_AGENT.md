# Grounded Customer Agent

تنفذ حزمة `@ai-business/customer-agent` وكيل العميل الخاص بمرحلة M5 دون جعل النموذج مصدرًا للسعر أو المخزون أو هوية المنتج. الحزمة مستقلة عن NestJS وقاعدة البيانات؛ الـAPI يربطها بخدمات النظام عبر `CustomerAgentDataSource`.

## تدفق Turn واحد

1. يستقبل الـAPI معرّف رسالة عميل محفوظة داخل محادثة حالتها `bot`.
2. يفحص Router النص ويختار `static`, `direct_query`, `fast_model`, `strong_model` أو `handoff`.
3. يُرفض Prompt Injection أو طلب الموظف قبل قراءة أي بيانات متجر.
4. تُبنى ذاكرة منقحة ومحدودة من آخر ثماني رسائل عميل/بوت فقط.
5. المسارات المباشرة تنفذ أدوات موثقة دون LLM؛ المسارات المركبة تمر عبر AI Gateway.
6. يتحقق Grounding verifier من كل Claim ومن Tool Call الذي يثبته.
7. يحفظ `ai_runs` و`ai_tool_calls` قبل إرجاع الرد، ثم تحفظ رسالة البوت مع `agentRunId`.
8. إعادة الطلب لنفس `messageId` تعيد الرسالة المخزنة ولا تنشئ ردًا جديدًا.

## الـAPI

```http
POST /api/tenants/:tenantId/conversations/:conversationId/agent-reply
Authorization: Bearer <OIDC access token>
Content-Type: application/json

{
  "messageId": "11111111-1111-4111-8111-111111111111"
}
```

يجب أن تكون الرسالة `inbound/customer` ومملوكة للمحادثة، وأن تبقى المحادثة في حالة `bot`. هوية المتجر من المسار مجرد Candidate؛ خدمات الأدوات تعمل داخل transaction محددة المستأجر ويعيد RLS التحقق من العضوية.

الاستجابة تتضمن:

- `runId`, `intent`, `route` و`status`.
- النص الآمن المعاد للعميل.
- `productId` و`variantId` فقط عندما ظهرا في نتيجة Tool.
- الأدلة: نوع الحقيقة واسم Tool ومعرّف Tool Call.
- `groundingValidated`, `handoffReason` و`replayed`.

## Routing

| الإشارة                                      | المسار         |
| -------------------------------------------- | -------------- |
| تحية قصيرة                                   | `static`       |
| سعر أو توفر واضح أو FAQ منشور                | `direct_query` |
| اكتشاف منتج بلغة طبيعية                      | `fast_model`   |
| مقارنة أو تفاوض مركب                         | `strong_model` |
| طلب موظف أو Prompt Injection أو فشل/عدم يقين | `handoff`      |

المسار المباشر ليس Shortcut خارج الحماية: ينفذ الأدوات عبر `ToolRegistry` نفسها، يتحقق من Schema، ويسجل Run وTool Calls بتكلفة Token صفر.

## الأدوات

- `search_products` — يعيد منتجات وVariants نشطة، ولا يعيد سعرًا أو مخزونًا.
- `get_variant_availability` — يجمع الرصيد المتاح الحالي للـVariant والكمية المطلوبة.
- `get_effective_price` — يقرأ سعر الكتالوج ويطبق إصدار قاعدة التسعير المنشور عند وجود قاعدة افتراضية صالحة.
- `get_business_rules` — يعيد القواعد المنشورة فقط مع معرّف ورقم الإصدار.
- `find_knowledge` — يعيد المعرفة المنشورة داخل Envelope يحمل `trust: untrusted_content` و`embeddedInstructions: ignore`.

كل Tool لها Input/Output schema مغلق، Intent allow-list، مهلة مستقلة وسياق Tenant/Conversation/Correlation ثابت لا يستطيع النموذج تغييره.

## عقد Grounding

Structured output للنموذج يحتوي `claims[]`. كل Claim يحمل:

- `kind`: `product`, `price`, `availability`, `knowledge` أو `rule`.
- `evidenceCallId`: معرّف Provider Tool Call الناجح في الـRun نفسه.

يتحقق الـruntime من الآتي قبل إرسال النص:

- Claim السعر لا يقبل إلا `get_effective_price`.
- Claim التوفر لا يقبل إلا `get_variant_availability`.
- Product/Variant المختاران يجب أن يظهرا في نتيجة `search_products`.
- وجود مبلغ/عملة أو لغة توفر في النص دون Claim مطابق يوقف الرد.
- Reply بثقة أقل من الحد يتحول لمسار آمن.

إذا فشل التحقق، لا يصل النص غير الموثق للعميل. تُسجل النتيجة النهائية كـ`handoff/safety_fallback` مع أسباب منقحة.

## الذاكرة والخصوصية

- آخر ثماني رسائل فقط، بحد إجمالي 4,000 حرف.
- الرسائل الداخلية وملاحظات الموظفين لا تدخل السياق.
- البريد والهاتف والتوكنات والأرقام الحساسة تُحجب قبل Prompt وTelemetry.
- إعدادات اللغة والنبرة تأتي من الإصدار المنشور؛ عدم وجوده يستخدم `ar/professional`.
- ملاحظات التاجر لا تصبح System Prompt.

## إعداد Provider

المسارات المباشرة والثابتة تعمل بلا Provider خارجي. عند غياب إعدادات المزود، تفشل المسارات التي تحتاج نموذجًا إلى `SafeHandoffProvider`.

```dotenv
AI_PROVIDER_BASE_URL=https://provider.example/v1
AI_PROVIDER_API_KEY=secret-manager-value
AI_PROVIDER_FAST_MODEL=fast-model
AI_PROVIDER_STRONG_MODEL=strong-model
AI_PROVIDER_MODEL_VERSION=provider-version
AI_PROVIDER_STRONG_MODEL_VERSION=provider-version
AI_PROVIDER_INPUT_COST_USD_PER_MILLION=1
AI_PROVIDER_OUTPUT_COST_USD_PER_MILLION=4
AI_PROVIDER_TIMEOUT_MS=15000
```

لا يوضع المفتاح في المستودع أو قاعدة البيانات أو Prompt. يجب حقنه من Secret Manager.

## التقييم

الملف `packages/customer-agent/evals/ar-dz.json` يغطي العربية واللهجة الجزائرية والفرنسية:

- التحية والسعر والتوفر وFAQ.
- الغموض واكتشاف المنتج والمقارنة والتفاوض.
- طلب الموظف ومحاولات Prompt Injection.

بوابة الاختبار تتطلب دقة Router لا تقل عن 80% ونجاح 100% لحالات الأمان/التحويل. اختبارات الـruntime تثبت عدم خروج سعر أو مخزون بلا Tool حديث، وعدم اختراع Variant، وحفظ Trace لكل رد.

## حدود هذه المرحلة

هذه المرحلة للقراءة والردود الموثقة فقط. إنشاء/تعديل Draft Order والتأكيد والتفاوض التنفيذي ضمن المرحلة التالية، وإنشاء Handoff وتعيينه وإيقاف البوت نهائيًا ضمن مسار Human Handoff اللاحق.
