# ADR-0001: MVP Stack, Pilot Hosting and Data Policy

- **الحالة:** Accepted
- **التاريخ:** 2026-09-21
- **النطاق:** Pilot محدود في منطقة أوروبية

## القرار

### التطبيق والبيانات

- Monorepo: pnpm + Turborepo.
- اللغة: TypeScript.
- Web: Next.js + React على Vercel.
- API: NestJS مع Fastify adapter على Vercel Functions في منطقة أوروبية قريبة من قاعدة البيانات.
- Database: PostgreSQL وDrizzle وRLS على مشروع Supabase أوروبي.
- Identity: Supabase Auth عبر OIDC/JWKS؛ يبقى API محايدًا للمزود.
- Object storage: Supabase Storage عبر S3-compatible API.
- Queue: PostgreSQL queue باستخدام claim ذري و`SKIP LOCKED`، دون Redis في Pilot.
- Worker: تشغيل مجدول ومحدود عبر Vercel؛ أي job طويل أو حساس للـlatency يحتاج قرارًا لإضافة container دائم.

### AI

- المزود الأساسي: endpoint متوافق مع OpenAI عبر `ai-gateway`.
- Fallback: `SafeHandoffProvider` دون نموذج خارجي.
- سقف Pilot: **20 USD شهريًا**.
- إنذار عند 75%، وإيقاف الاستدعاء الخارجي عند 100% مع التحويل للمسارات الحتمية أو الموظف.
- لا يُرفع السقف دون موافقة مالك المنتج ومراجعة تكلفة كل محادثة.

### الاحتفاظ والخصوصية

| البيانات                 | المدة     | الإجراء بعد المدة                         |
| ------------------------ | --------- | ----------------------------------------- |
| المحادثات وبيانات العميل | 30 يومًا  | حذف آمن ما لم يوجد التزام قانوني موثق     |
| AI runs وtool traces     | 30 يومًا  | حذف المدخلات والمخرجات والـmetadata       |
| النسخ الاحتياطية         | 30 يومًا  | حذف تلقائي من التخزين المشفر              |
| Audit events             | 180 يومًا | حذف وفق job موثق مع الحفاظ على أقل بيانات |

- EU data residency لمشروعي Supabase.
- لا تُنسخ بيانات production إلى staging.
- يبدأ Pilot ببيانات اصطناعية؛ البيانات الحقيقية تنتظر retention job ومسار الحذف/التصدير وGo/No-Go.

## البيئات والأسرار

| البند    | Staging                                | Production                              |
| -------- | -------------------------------------- | --------------------------------------- |
| Vercel   | مشروع منفصل وdomain داخلي              | مشروع منفصل وdomain الإنتاج             |
| Supabase | مشروع EU مستقل ببيانات اصطناعية        | مشروع EU مستقل ونسخ يومية               |
| الهوية   | مستخدمون تجريبيون ومفاتيح منفصلة       | MFA للإدارة ومفاتيح production          |
| AI       | سقف صغير ومحتوى اصطناعي                | سقف 20 USD وSafe Handoff                |
| الأسرار  | Vercel encrypted environment variables | نفس الآلية، دون مشاركة القيم مع staging |

- `.env` محلي فقط، و`.env.example` أسماء بلا قيم حقيقية.
- مفاتيح Supabase وAI وS3 تُخزن في Vercel encrypted environment variables.
- GitHub يحتفظ فقط بأسرار النشر الضرورية وبصلاحية أقل ما يمكن.
- تدوير أي سر مشتبه به قبل التحقيق، وعدم وضعه في logs أو feedback.

## التكلفة المستهدفة

- Staging على الخطط المجانية/المنخفضة وببيانات اصطناعية.
- سقف production للبنية الأساسية: **60 USD شهريًا** قبل الضرائب والنطاق والـegress.
- سقف AI: **20 USD شهريًا**.
- سقف Pilot التشغيلي المستهدف: **80 USD شهريًا**؛ تجاوزه يحتاج قرارًا موثقًا.
- الأسعار الفعلية تُراجع قبل التفعيل لأن خطط المزودين قابلة للتغيير.

## لماذا

- Supabase يجمع PostgreSQL/Auth/Storage ويقلل عدد الخدمات وتكلفة التشغيل.
- Vercel هو المسار الأبسط للواجهة والـAPI محدود الحمل.
- PostgreSQL queue تتجنب Redis وخدمة إضافية قبل وجود حمل يبررها.
- Adapter داخلي للهوية والتخزين وAI يمنع قفل الـCore على المزود.
- الاحتفاظ القصير يقلل مخاطر بيانات العملاء في Pilot.

## بدائل مؤجلة

- AWS Cognito/RDS/ECS/S3: تحكم أكبر، لكن تشغيل وتكلفة أعلى لفريق صغير.
- Railway + Clerk: نشر backend أبسط، لكن يضيف مزودين وفاتورة وهوية منفصلة.
- Redis/BullMQ: يُعتمد عند الحاجة إلى workers دائمة أو retries/scheduling أعلى.
- Microservices أو NoSQL: لا تبررها أحمال Pilot ولا متطلبات المعاملات.

## القيود وبوابات إعادة القرار

يُعاد فتح ADR عند أي من الآتي:

- الحاجة إلى worker دائم أو jobs تتجاوز حدود Vercel.
- توسع API أفقيًا؛ عندها ينتقل rate limiter والـqueue coordination إلى مخزن مشترك.
- متطلبات data residency خارج EU.
- تجاوز سقف التكلفة شهرين متتاليين.
- حاجة AI إلى مزود غير متوافق مع العقد الحالي.

## نتيجة القرار

لا يوجد قرار معماري حرج يمنع Bootstrap أو Pilot الاصطناعي. قبل بيانات حقيقية يجب إكمال retention automation، إعداد البيئتين فعليًا، وتجربة Go/No-Go.
