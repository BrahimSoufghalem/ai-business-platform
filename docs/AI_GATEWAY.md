# AI Gateway

حزمة `@ai-business/ai-gateway` هي الحد الوحيد بين التطبيق ومزوّدي النماذج. الـDomain والـTools لا تستورد SDK خاصًا بمزوّد، وتتعامل فقط مع عقود موحدة.

## مسار التشغيل

```text
طلب Typed
→ Prompt Registry
→ Route selection
→ Provider adapter
→ Tool allow-list + schema validation
→ Structured output validation
→ نتيجة أو Human Handoff
→ Redacted telemetry
```

تعيد كل Run:

- `provider`, `model`, `modelVersion`.
- `promptVersion`, `routingVersion`.
- `latencyMs`.
- `inputTokens`, `outputTokens`.
- `estimatedCostUsd`.
- نتيجة `completed` أو `handoff`.
- محاولات المزود وTool calls وحالة fallback.

## Provider contract

ينفذ أي Adapter الواجهة `AiProvider`:

```ts
interface AiProvider {
  readonly name: string;
  complete(request: AiProviderRequest, signal: AbortSignal): Promise<AiProviderResponse>;
}
```

المتوفر حاليًا:

- `OpenAiCompatibleProvider`: Adapter HTTP متوافق مع Chat Completions وJSON Schema وFunction Tools. مفتاح المزود يبقى داخل الـAdapter ولا يظهر في request أو trace.
- `SafeHandoffProvider`: fallback حتمي لا يخمّن جوابًا، ويعيد Handoff آمنًا.

تغيير المزود أو النموذج يتم بتغيير Routes وAdapters فقط، من دون تغيير Domain أو Tool handlers.

## Prompt وModel versioning

`PromptRegistry` يقبل تعليمات نظام ثابتة من الكود:

```ts
const prompts = new PromptRegistry();
prompts.register({
  id: 'customer-reply',
  task: 'compose',
  version: 'v1',
  systemInstruction: 'Return a grounded customer reply.',
});
```

المفتاح `(task, version)` immutable ولا يمكن تسجيله مرة أخرى. إعدادات التاجر المنشورة مثل اللغة والنبرة تظل بيانات مدخلة، وليست System Prompt.

كل Route يحمل:

- `routingVersion`.
- `model` و`modelVersion`.
- المهام وIntents المدعومة.
- سرعة وجودة وأولوية.
- تكلفة مليون Input/Output tokens.
- Timeout وعدد المحاولات.

## Routing والميزانية

يدعم الطلب `routingPreference`:

- `cost`: الأقل تكلفة أولًا.
- `speed`: النموذج الأسرع أولًا.
- `quality`: الجودة الأعلى أولًا.
- `balanced`: الأولوية والسرعة والتكلفة معًا.

قبل كل استدعاء يحسب Gateway أسوأ تكلفة متوقعة من Input estimate و`maximumOutputTokens`. Route لا يدخل التنفيذ إذا تجاوز `maximumCostUsd`. بعد كل استجابة تجمع Tokens والتكلفة الفعلية المقدرة، ويتوقف Run قبل أي استدعاء إضافي إذا نفدت الميزانية.

## Structured outputs

يقدم المستدعي:

- Validator يطبق `safeParse`؛ Zod متوافق مباشرة مع العقد.
- JSON Schema يرسل للمزوّد.
- اسم ثابت للـSchema.

لا تعاد نتيجة `completed` إلا بعد نجاح Validation المحلي. JSON غير صالح أو Output خارج الـSchema يؤدي إلى retry محدود، ثم fallback أو Handoff.

## Tool Registry

كل Tool تسجل مع:

- `kind`: `read` أو `command`.
- `allowedIntents`.
- Input validator وOutput validator.
- Input JSON Schema.
- Timeout مستقل.
- Handler تطبيق مصرح به.

```ts
tools.register({
  name: 'get_effective_price',
  description: 'Read the current validated price.',
  kind: 'read',
  allowedIntents: ['pricing'],
  inputSchema,
  outputSchema,
  inputJsonSchema,
  async execute(input, context) {
    return pricingService.read(input, context);
  },
});
```

التنفيذ يرفض افتراضيًا إذا:

- الاسم غير مسجل.
- Intent غير مسموح.
- الاسم خارج `allowedToolNames` الخاصة بالـRun.
- Input لا يطابق Schema.

لهذا لا يصل Tool call غير صالح إلى Handler أو write path. Output غير صالح يسجل كفشل ولا يعود للنموذج. بعد نجاح Command Tool لا يعيد Gateway المحاولة أو ينتقل لمزوّد آخر عند فشل لاحق، لتجنب تكرار الأثر؛ يتحول مباشرة إلى Handoff. يجب أن تبقى Command handlers نفسها idempotent.

## Reliability

- Timeout مستقل لكل Provider call ولكل Tool.
- Retries محدودة لكل Route.
- Circuit breaker لكل `(provider, model)`.
- Route fallback مستقل.
- حد `maximumToolCalls`.
- Budget preflight وتجميع تكلفة كل المحاولات.
- أي فشل غير قابل للاسترداد ينتج Handoff واضحًا، لا جوابًا مخمّنًا.

## Telemetry وRedaction

ينشئ Gateway `AiRunTraceRecord` واحدًا لكل Run. `redactAiTelemetry`:

- يحجب مفاتيح credentials وtokens وcookies.
- يحجب البريد والهاتف والعنوان وحقول الاتصال.
- يحجب Bearer/JWT داخل النص.
- يحد عمق وحجم النص والمصفوفات.
- يحول القيم إلى JSON-safe ويمنع cycles.

لا يحفظ System Prompt أو API key. تحفظ نسخة الـPrompt فقط.

الجداول:

- `ai_runs`: المزود والنموذج والإصدارات والزمن والاستخدام والتكلفة والنتيجة ومحاولات منقحة.
- `ai_tool_calls`: الأداة والنوع والحالة والزمن وInput/Output منقحين.

الجداول Tenant-scoped وRLS وappend-only لدور التشغيل. `persistAiRunTrace(transaction, run)` يعيد تطبيق Redaction دفاعيًا ويحفظ Run وTool calls في معاملة واحدة.

## مثال تركيب

```ts
const gateway = new RoutedAiGateway({
  providers: [
    new OpenAiCompatibleProvider({
      baseUrl: process.env.AI_PROVIDER_BASE_URL!,
      apiKey: process.env.AI_PROVIDER_API_KEY!,
    }),
    new SafeHandoffProvider(),
  ],
  routes,
  prompts,
  tools,
  traceSink: {
    record: (run) =>
      withTenantTransaction(database, contextFor(run), (tx) => persistAiRunTrace(tx, run)),
  },
});
```

المفاتيح تأتي من Secret Manager أو متغيرات البيئة في Runtime، ولا تحفظ في قاعدة البيانات أو المستودع.

## Contract tests

تغطي الاختبارات:

- استبدال Provider مع بقاء Tool contract والنتيجة Typed.
- Routing حسب التكلفة أو السرعة.
- Retries وCircuit breaker وfallback.
- Timeout.
- Budget Handoff.
- رفض Structured output غير صالح.
- منع Tool input غير صالح من الوصول للـHandler.
- عدم تكرار Command بعد احتمال الكتابة.
- Redaction.
- Mapping الخاص بـOpenAI-compatible adapter.
