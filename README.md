# AI Business Platform

منصة SaaS متعددة المتاجر تجمع إدارة المنتجات والمخزون والطلبات والعملاء مع وكيل AI لخدمة العملاء، مع إبقاء النظام وقواعد العمل مصدر الحقيقة الوحيد.

> **الحالة الحالية:** تنفيذ MVP جارٍ. اكتملت طبقات الأساس والكتالوج والمخزون والطلبات والعملاء والمحادثات والقواعد والمعرفة وAI Gateway، وأضيف Grounded Customer Agent داخلي مع Router وأدوات قراءة وذاكرة محدودة واختبارات عربية.

## مبادئ المنتج

1. **System of Record أولًا:** قاعدة البيانات والخدمات المصرّح بها تحدد السعر والمخزون وحالة الطلب.
2. **Configuration First:** Core ثابت، بينما أنواع المنتجات والخصائص والقواعد وحقول الطلب قابلة للتهيئة لكل متجر.
3. **Tenant Isolation by Default:** كل سجل وعملية وصلاحية ومؤشر مراقبة مرتبط بمتجر محدد.
4. **AI لا ينفذ مباشرة:** الوكيل يفهم ويصوغ الردود، أما القراءة والكتابة فتتم عبر Tools محددة ومتحقق منها.
5. **Modular Monolith للـMVP:** سرعة بناء وتشغيل أعلى مع حدود Modules واضحة تسمح بالفصل لاحقًا.
6. **Human Handoff مسار أساسي:** عدم اليقين أو الاستثناءات أو تجاوز السياسة تنتقل للموظف، ولا تُحل بالتخمين.

## نطاق MVP

- الحسابات، المتاجر، العزل متعدد المستأجرين والصلاحيات الأساسية.
- Dashboard تشغيلي أولي.
- منتجات ديناميكية، Product Types، Attributes وVariants.
- مخزون قائم على سجل حركات وعمليات حجز آمنة.
- طلبات بحالات وانتقالات مضبوطة.
- ملفات العملاء وسجل المحادثات والطلبات.
- Business Rules وKnowledge Base / FAQ.
- AI Gateway قابل لتبديل المزود والنموذج.
- AI Customer Agent داخلي مع Tool Calling، إنشاء Draft Order، التأكيد حسب القواعد، وHuman Handoff.
- بيئة محادثة داخلية/اختبارية قبل ربط قنوات التواصل الخارجية.

### خارج MVP

WhatsApp وInstagram وMessenger الإنتاجية، الفوترة والاشتراكات، AI Business Analyst، أدوات المحتوى، الأتمتة المتقدمة، والتعرف البصري على المنتجات.

## خريطة الوثائق

| الوثيقة                                                          | الغرض                                         |
| ---------------------------------------------------------------- | --------------------------------------------- |
| [Product brief](docs/PRODUCT_BRIEF.md)                           | الملخص الأصلي ومتطلبات صاحب الفكرة            |
| [Product scope](docs/PRODUCT_SCOPE.md)                           | النطاق، المستخدمون، المتطلبات ومعايير النجاح  |
| [Architecture](docs/ARCHITECTURE.md)                             | التصميم المقترح وحدود النظام والتدفقات        |
| [Data model](docs/DATA_MODEL.md)                                 | الكيانات والعلاقات والثوابت الحرجة            |
| [Inventory API](docs/INVENTORY_API.md)                           | الحركات والأرصدة والحجوزات ومنع overselling   |
| [Orders API](docs/ORDERS_API.md)                                 | Drafts والتأكيد والحالات وSnapshots التاريخية |
| [Customers & Conversations](docs/CUSTOMERS_CONVERSATIONS_API.md) | الملفات الموحدة والرسائل والصندوق الداخلي     |
| [Rules & Knowledge](docs/RULES_KNOWLEDGE_API.md)                 | قواعد السعر والمعرفة وإعدادات الوكيل بإصدارات |
| [AI Gateway](docs/AI_GATEWAY.md)                                 | المزودون وRouting والأدوات والميزانية والتتبع |
| [Grounded Customer Agent](docs/CUSTOMER_AGENT.md)                | runtime والـGrounding والذاكرة والتقييم       |
| [AI agent design](docs/AI_AGENT.md)                              | السياق الديناميكي، الأدوات، الحماية والتقييم  |
| [Roadmap](docs/ROADMAP.md)                                       | خطة تنفيذ MVP على مراحل ومسار حرج             |
| [Security & privacy](docs/SECURITY.md)                           | ضوابط العزل والوصول والأسرار والتدقيق         |
| [ADR-0001](docs/adr/0001-proposed-stack.md)                      | Stack مقترح يحتاج اعتمادًا قبل بدء التنفيذ    |
| [Contributing](CONTRIBUTING.md)                                  | طريقة العمل وجودة الـPRs                      |

## الشكل المقترح للمستودع بعد اعتماد الـStack

```text
apps/
├── web/          # لوحة التاجر وصندوق المحادثات
├── api/          # API وUse Cases
└── worker/       # Jobs، Webhooks، AI runs والإشعارات
packages/
├── domain/       # كيانات وقواعد العمل
├── db/           # Schema، migrations وtenant helpers
├── ai-gateway/   # Routing، providers، tools وguardrails
├── customer-agent/ # Intent router، grounded runtime وevaluations
├── integrations/ # Adapters للقنوات الخارجية
├── config/       # Product schemas وbusiness rules
└── shared/       # أنواع وأدوات مشتركة
```

## البداية المقترحة

1. اعتماد القرارات المفتوحة في [ADR-0001](docs/adr/0001-proposed-stack.md).
2. تنفيذ Issues حسب ترتيبها ومسارها الحرج.
3. عدم دمج أي Write Path قبل وجود tenant check، authorization، validation وaudit event.
4. إطلاق Pilot على 2–3 متاجر ببيانات اختبار، ثم متجر حقيقي واحد، قبل توسيع القنوات.

## Development status

Implementation started on the foundation layer. The first external Pilot channel is **Instagram**, but live integration remains blocked until tenancy, conversations, orders, and handoff are ready.

### Local quick start

```bash
cp .env.example .env
pnpm install
docker compose up -d postgres
pnpm db:migrate
pnpm dev
```

See [Development](docs/DEVELOPMENT.md) and [ADR-0002](docs/adr/0002-instagram-first-pilot-channel.md).

### Foundation security gates

- OIDC verification is provider-neutral and validates issuer, audience, expiry and signature.
- Tenant-scoped transactions set both the candidate tenant and verified identity subject.
- PostgreSQL RLS verifies active membership; supplying another tenant ID is insufficient.
- GitHub CI applies migrations to a real PostgreSQL service and runs cross-tenant integration tests.

- [API foundation](docs/API.md): protected tenant provisioning, membership listing, RLS reads and audit access.

- [Dynamic Product Types API](docs/PRODUCT_TYPES_API.md): templates, custom schemas, optimistic versions, RBAC and RLS.

- [Products & Variants API](docs/PRODUCTS_API.md): validated products, variants, revisions, signed media, search and Instagram content mapping.

- [Inventory API](docs/INVENTORY_API.md): append-only ledger, atomic balances, reservations, idempotency and low-stock alerts.

- [Orders API](docs/ORDERS_API.md): editable drafts, explicit approval, atomic stock reservation, state transitions and immutable price snapshots.

- [Customers & Conversations API](docs/CUSTOMERS_CONVERSATIONS_API.md): normalized contacts, tenant-safe deduplication, customer history, idempotent messages and the internal employee inbox.

- [Business Rules, Knowledge & Agent Settings](docs/RULES_KNOWLEDGE_API.md): typed pricing decisions, immutable draft/published versions, untrusted knowledge grounding and safe runtime settings.

- [AI Gateway](docs/AI_GATEWAY.md): provider-neutral adapters, task/cost/speed routing, validated tools and outputs, retries, circuit breaking, budgets, handoff and redacted run telemetry.

- [Grounded Customer Agent](docs/CUSTOMER_AGENT.md): deterministic/direct/model routing, store-scoped read tools, variant clarification, bounded memory, prompt-injection blocking, evidence validation and Arabic evaluation cases.
