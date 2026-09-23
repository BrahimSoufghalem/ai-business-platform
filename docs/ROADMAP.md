# MVP Roadmap

الخطة التالية تقدير أولي لفريق صغير (2–4 مهندسين مع Product/Design جزئي). تُضبط بعد اعتماد الـStack والنماذج الأولية. المدة المستهدفة: **12 أسبوعًا** للوصول إلى Pilot مضبوط، لا إلى منصة عامة كاملة.

## المسار الحرج

`Tenancy/Auth → Catalog Schema → Inventory → Orders → Rules/Knowledge → AI Tools → Draft/Confirm → Handoff → Pilot`

Dashboard يتطور بالتوازي فوق نفس Modules، ولا يسبق صحة العمليات الأساسية.

## المرحلة 0 — القرارات والتصميم (الأسبوع 1)

**المخرجات**

- اعتماد Stack والاستضافة ومزود الهوية.
- Wireframes للتدفقات الحرجة: إعداد متجر، منتج، تعديل مخزون، طلب، Inbox/Handoff.
- Threat model أولي وData classification.
- تعريف Pilot persona ومتجرين/ثلاثة محتملين.
- CI أولي، conventions وبيئات staging/production.

**بوابة الخروج**

- ADR معتمد، مخطط بيانات مراجع، وBacklog قابل للتنفيذ دون أسئلة كبيرة مفتوحة.

## المرحلة 1 — الأساس متعدد المتاجر (الأسبوعان 2–3)

**المخرجات**

- Monorepo، web/api/worker، migrations وCI.
- Authentication، Tenant context، memberships والأدوار الأساسية.
- Store settings وAudit framework.
- Dashboard shell وNavigation.
- اختبارات tenant isolation وauthorization.

**بوابة الخروج**

- مستخدمان من متجرين مختلفين لا يستطيعان عبور البيانات في API أو jobs أو الملفات.

## المرحلة 2 — Catalog ديناميكي (الأسبوعان 4–5)

**المخرجات**

- Product Types وAttribute Definitions.
- Templates أولية: General, Clothing, Shoes, Smartphone, Laptop, Headset.
- Products، Variants، media وvalidation.
- Content/Product mapping وProduct Code fallback.
- واجهات إنشاء وبحث ونشر منتج.

**بوابة الخروج**

- متجر واحد ينشر منتجات من ثلاثة أنواع مختلفة، مع Variants وقيم صحيحة وقابلة للبحث.

## المرحلة 3 — Inventory، Orders، Customers (الأسبوعان 6–7)

**المخرجات**

- Inventory ledger، balances، reservations وidempotency.
- Draft Orders، Orders، state machine وprice snapshots.
- Customer profiles، addresses وhistory.
- واجهات تشغيلية وتنبيهات انخفاض المخزون الأساسية.
- اختبارات concurrency والانتقالات.

**بوابة الخروج**

- رحلة شراء يدوية كاملة تعمل دون رصيد سالب أو انتقال حالة غير صالح.

## المرحلة 4 — القواعد والمعرفة وAI Gateway (الأسبوعان 8–9)

**المخرجات**

- Business Rules Typed ونشر بإصدارات.
- Knowledge Base / FAQ مع retrieval بسيط.
- AI Gateway، provider adapter أول وfallback adapter.
- Tool registry للقراءة، tracing، budgets وstructured outputs.
- Test console داخلي ومجموعة Evaluations أولى.

**بوابة الخروج**

- Agent يجيب عن السعر/التوفر/FAQ من Tools فقط، وتظهر التكلفة والمصدر في trace.

## المرحلة 5 — Customer Agent والطلب (الأسبوعان 10–11)

**المخرجات**

- Conversation runtime وصندوق محادثة داخلي.
- تحديد المنتج/Variant وجمع معلومات الطلب.
- Draft Order، ملخص وموافقة صريحة ثم confirm command.
- Negotiation ضمن الحدود.
- Human Handoff مع summary وassignment.
- Red-team tests للـprompt injection والفشل.

**بوابة الخروج**

- سيناريوهات الشراء الأساسية تنجح End-to-End، والاستثناءات المخطط لها تتحول للموظف.

## المرحلة 6 — Hardening وPilot (الأسبوع 12)

**حالة التنفيذ:** اكتملت الضوابط البرمجية الأساسية. تفعيل Pilot الحقيقي ينتظر الأدلة التشغيلية والتوقيع البشري على Go/No-Go.

**المخرجات**

- [x] Seed/import محدود وidempotent لبيانات متجر Pilot.
- [x] مراقبة، alerting، correlation trace، backup/restore وrunbooks.
- [x] مراجعة صلاحيات، rate limits، dependency/secret scanning وprivacy checklist.
- [x] Dashboard KPI: الطلبات، المبيعات، المخزون، handoff، latency وAI cost.
- [x] بوابات تقييم/red-team، دليل تدريب وfeedback log.
- [ ] تنفيذ التدريب والتجربة التشغيلية وتوقيع Go/No-Go على بيئة Pilot.

**بوابة الخروج**

- Go/No-Go checklist موقعة، لا توجد ثغرات حرجة، ويمكن استعادة البيانات وتشخيص رحلة كاملة.

## ما بعد نجاح Pilot

1. اختيار قناة واحدة فقط بناءً على بيانات العملاء: WhatsApp أو Instagram.
2. بناء Adapter وWebhook ingestion مع sandbox واختبارات idempotency.
3. Billing/Subscription وPlatform Admin.
4. Staff roles أدق وإشعارات.
5. Analytics وAI Business Analyst.
6. Vision/visual similarity وأدوات المحتوى بعد توفر بيانات كافية.

## المخاطر وخطط التخفيف

| الخطر                              | الأثر             | التخفيف                                                    |
| ---------------------------------- | ----------------- | ---------------------------------------------------------- |
| توسع النطاق مبكرًا                 | تأخر Pilot        | تثبيت MVP؛ أي قناة خارجية تحتاج قرار تغيير نطاق            |
| Dynamic attributes غير قابلة للبحث | تجربة ضعيفة       | تعريف `searchable` وفهارس انتقائية من Queries فعلية        |
| بيع زائد بسبب التزامن              | خسارة وثقة منخفضة | reservations ذرية، locks/constraints واختبارات concurrency |
| هلوسة أو تجاوز سعر                 | ضرر تجاري         | Tool-only truth، validation، eval gates وhandoff           |
| تكلفة AI غير متوقعة                | هامش سلبي         | routing، budgets، caching وقياس تكلفة لكل محادثة           |
| اعتماد قوي على Provider            | صعوبة التغيير     | AI Gateway وcontract tests لمزودين                         |
| تكاملات القنوات غير مستقرة         | فقد رسائل         | adapters، idempotency، retry queue وdead-letter handling   |
| بيانات شخصية في Logs               | خطر خصوصية        | redaction، retention قصير وصلاحيات دقيقة                   |

## Definition of Done لكل Feature

- Acceptance criteria واختبارات unit/integration مكتملة.
- tenant isolation وauthorization مغطّيان.
- migrations قابلة للنشر والرجوع أو لها خطة forward fix.
- observability وaudit للأفعال الحساسة.
- لا أسرار أو PII غير لازمة في logs/prompts.
- الوثائق وOpenAPI محدثة.
- UX للحالات الفارغة والفشل والتحميل.
