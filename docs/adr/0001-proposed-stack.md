# ADR-0001: Proposed MVP Stack

- **الحالة:** Proposed
- **التاريخ:** 2026-09-21

## السياق

نحتاج سرعة بناء لـMVP متعدد المتاجر، Types مشتركة بين الواجهة وAPI، معاملات قوية للمخزون والطلبات، Worker للمهام، وقابلية تبديل مزود AI دون تعقيد Microservices مبكر.

## المقترح

- **Monorepo:** pnpm + Turborepo.
- **Language:** TypeScript end-to-end.
- **Web:** Next.js + React.
- **API:** NestJS أو Fastify بطبقة Application/Domain مستقلة عن Framework.
- **Database:** PostgreSQL مع migrations وRLS؛ اختيار ORM بين Drizzle وPrisma بعد Spike صغير.
- **Jobs/Queue:** PostgreSQL-backed queue أولًا أو Redis/BullMQ إذا تطلب الحمل/الاستضافة.
- **Object Storage:** S3-compatible.
- **Contracts:** OpenAPI + runtime schema validation.
- **AI:** حزمة `ai-gateway` داخلية مع Provider adapters وstructured outputs.
- **Testing:** unit + integration على PostgreSQL حقيقي + Playwright للرحلات الحرجة.
- **Observability:** OpenTelemetry، structured logs وerror tracking.
- **Deployment:** managed platform للـweb/api/worker وmanaged PostgreSQL في مرحلة Pilot.

## لماذا

- فريق صغير يستطيع مشاركة الأنواع والأدوات بسرعة.
- PostgreSQL مناسب للمعاملات، JSONB والـRLS.
- Modular Monolith يقلل عمليات النشر والتشغيل مع حدود واضحة.
- Adapters تمنع قفل المنصة على مزود AI أو قناة واحدة.

## بدائل مستبعدة الآن

- Microservices كاملة: تكلفة تشغيل وتنسيق غير مبررة قبل وجود حمل.
- قاعدة NoSQL كأساس: تعقّد سلامة الطلبات والمخزون والتقارير.
- Prompt يكتب SQL/CRUD مباشرة: غير آمن وغير قابل للتدقيق.

## قرارات يجب حسمها في الأسبوع 1

1. NestJS أم Fastify مباشرة؟
2. Drizzle أم Prisma؟
3. مزود الهوية والاستضافة والمنطقة الجغرافية.
4. Queue مبنية على PostgreSQL أم Redis.
5. أول مزود AI ومزود fallback وحدود الميزانية.
6. سياسة تخزين المحادثات والبيانات الشخصية في Pilot.
