# AI Business Platform

منصة SaaS متعددة المتاجر تجمع إدارة المنتجات والمخزون والطلبات والعملاء مع وكيل AI لخدمة العملاء، مع إبقاء النظام وقواعد العمل مصدر الحقيقة الوحيد.

> **الحالة الحالية:** مستودع تخطيط لـ MVP v0.1. لا يحتوي بعد على كود إنتاجي.

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

| الوثيقة                                     | الغرض                                        |
| ------------------------------------------- | -------------------------------------------- |
| [Product brief](docs/PRODUCT_BRIEF.md)      | الملخص الأصلي ومتطلبات صاحب الفكرة           |
| [Product scope](docs/PRODUCT_SCOPE.md)      | النطاق، المستخدمون، المتطلبات ومعايير النجاح |
| [Architecture](docs/ARCHITECTURE.md)        | التصميم المقترح وحدود النظام والتدفقات       |
| [Data model](docs/DATA_MODEL.md)            | الكيانات والعلاقات والثوابت الحرجة           |
| [AI agent design](docs/AI_AGENT.md)         | السياق الديناميكي، الأدوات، الحماية والتقييم |
| [Roadmap](docs/ROADMAP.md)                  | خطة تنفيذ MVP على مراحل ومسار حرج            |
| [Security & privacy](docs/SECURITY.md)      | ضوابط العزل والوصول والأسرار والتدقيق        |
| [ADR-0001](docs/adr/0001-proposed-stack.md) | Stack مقترح يحتاج اعتمادًا قبل بدء التنفيذ   |
| [Contributing](CONTRIBUTING.md)             | طريقة العمل وجودة الـPRs                     |

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
