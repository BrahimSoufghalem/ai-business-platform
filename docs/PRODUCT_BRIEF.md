# AI Business Management Platform — ملخص المشروع

## 1. الفكرة

منصة SaaS للمحلات والتجار، خصوصًا من يعتمدون على Instagram / Facebook / WhatsApp، تجمع **إدارة المتجر + الطلبات + المخزون + العملاء + AI Agent** في نظام واحد.

الهدف ليس بيع Chatbot فقط، بل نظام يجعل التاجر أكثر تنظيمًا ويؤتمت خدمة العملاء والطلبات.

## 2. المشكلة

التاجر يدير المنتجات والأسعار والمخزون والطلبات وأسئلة العملاء وصفحات التواصل غالبًا بشكل يدوي؛ وهذا يسبب ضياع الطلبات، أخطاء المخزون، بطء الرد وتضييع الوقت.

## 3. المكونات الأساسية

### Shop / Multi-tenant

لكل محل مساحة وبيانات منفصلة: الحساب، المنتجات، المخزون، الطلبات، العملاء، القواعد، الموظفون والصلاحيات.

### Product Catalog

كل منتج له `Product ID` ثابت، مع الاسم، الوصف، السعر، السعر المخفض، الصور، المخزون، الألوان/المقاسات والـVariants والتصنيف والحالة.

### Inventory

المخزون هو **Source of Truth**، ويتغير فقط عبر عمليات النظام المصرح بها.

### Orders

حالات مثل:
`new → confirmed → preparing → shipped → delivered / cancelled`

### Customers

ملف لكل عميل يشمل معلومات الاتصال، المحادثات، الطلبات السابقة، العنوان وملاحظات المتجر.

## 4. AI Customer Agent

AI يتحدث مع العميل كموظف مبيعات، لكنه **لا يخترع معلومات**.

التدفق:

1. يفهم رسالة العميل.
2. يحدد المنتج/الـVariant.
3. يستدعي بيانات النظام.
4. يتحقق من السعر والمخزون والقواعد.
5. يصيغ الرد.
6. إذا أراد العميل الشراء، يجمع بيانات الطلب.
7. ينشئ Draft Order ويؤكده حسب قواعد المتجر.
8. إذا لم يفهم أو كانت الحالة خاصة → Human Handoff.

**القاعدة:** AI يفهم ويتواصل؛ Database + Tools تعطي الحقيقة وتنفذ العمليات.

لا يسمح للـAI بتغيير السعر أو المخزون أو الطلب مباشرة دون Tools وصلاحيات محددة.

## 5. التعرف على المنتج من Reel / Post

نربط:
`Content ID → Product ID`

مثال:
`Reel #500 → Product P1042`

إذا أرسل العميل Reel وكان سياق المنصة متاحًا، يستخدم النظام الربط لمعرفة المنتج.

إذا لم يكن متاحًا:

- Product Code / Screenshot كحل MVP.
- لاحقًا Vision + Visual Similarity للتعرف من الصور/الفيديو.

**لا نعتمد على تخمين AI في MVP.**

## 6. التفاوض

التاجر يحدد Business Rules:

- أقل سعر مسموح.
- أقصى خصم.
- المنتجات القابلة للتفاوض.
- متى يتحول العميل للموظف.

AI لا يتجاوز هذه القواعد.

## 7. AI والتكلفة

لا نرسل كل رسالة إلى LLM:

- سؤال ثابت/بيانات مباشرة → Database أو رد جاهز.
- فهم بسيط → نموذج سريع ورخيص.
- تفاوض أو حالة معقدة → نموذج أقوى عند الحاجة.
- عدم فهم → موظف.

نستخدم **AI Gateway** حتى لا يرتبط النظام بنموذج واحد:
`AI Gateway → DeepSeek / Gemini / Groq / نموذج آخر`

الاختيار يكون حسب **القوة + السعر + السرعة + الاستقرار**. DeepSeek منخفض التكلفة مرشح أساسي، مع إبقاء النظام قابلًا لتغيير النموذج مستقبلًا.

## 8. Dashboard

المبيعات، الطلبات، المنتجات، المخزون، العملاء، المحادثات، أداء AI والتنبيهات.

لاحقًا: **AI Business Analyst** لتحليل بيانات المتجر وشرح ما يحدث للتاجر.

## 9. التكاملات

الهدف النهائي:

- WhatsApp
- Instagram
- Facebook / Messenger

لكن لا نبني كل التكاملات في الـMVP دفعة واحدة.

## 10. إضافات مستقبلية

AI لوصف المنتجات والمحتوى، أفكار Reels، متابعة العملاء، حملات وإشعارات، تقارير متقدمة، وتخصيص المنصة حسب نوع النشاط.

## 11. نموذج الربح

**Setup Fee + Subscription**

مثال مبدئي:

- إعداد وتخصيص: 50,000–100,000+ DZD حسب المتجر.
- اشتراك شهري: 3,000–10,000 DZD حسب الخطة والاستخدام.

ابدأ بعدد قليل من المتاجر كتجربة 15–30 يومًا، ثم اشتراك شهري.

لا نبيع AI فقط؛ نبيع:
**إدارة متجر + مخزون + طلبات + عملاء + رد آلي ذكي.**

## 12. ترتيب البناء

1. Multi-tenant / حساب المتجر
2. Dashboard
3. Products
4. Inventory
5. Orders
6. Customers
7. ربط الأنظمة
8. Business Rules
9. AI Owner Assistant
10. AI Knowledge Base
11. AI Customer Agent
12. تحويل المحادثة إلى Order
13. Human Handoff
14. WhatsApp / Instagram / Messenger
15. Notifications
16. Analytics
17. AI Business Analyst
18. AI Content Tools
19. Billing / Subscription
20. Platform Admin
21. Staff Roles
22. Advanced Automation

### MVP

ابدأ بـ **1 → 13** فقط، ثم أضف التكاملات والتحليلات.

## 13. المبدأ المعماري

**النظام هو مصدر الحقيقة، والـAI طبقة للفهم والتواصل.**

النتيجة: دقة أعلى، تكلفة أقل، تحكم أفضل، وإمكانية تغيير نموذج AI دون إعادة بناء المنصة.

## 14. Dynamic Product Types & Custom Attributes

المنصة **لا تفترض أن المتجر ينتمي إلى نوع واحد فقط**. المتجر قد يبيع هواتف + حواسيب + سماعات، أو ملابس + أحذية + حقائب، إلخ.

لذلك:

- لكل منتج `Product Type` خاص به.
- لكل نوع مجموعة خصائص (`Attributes`) مناسبة له.
- توجد قوالب جاهزة نوفّرها كبداية، مثل: Clothing, Shoes, Smartphone, Laptop, Headset, Furniture, Auto Parts, General Product.
- القوالب **قابلة للتخصيص بالكامل**: التاجر يستطيع إضافة، تعديل أو حذف أي Attribute.
- يستطيع التاجر أيضًا إنشاء `Custom Product Type` جديد بخصائص من اختياره، حتى لو لم يكن موجودًا ضمن القوالب الجاهزة.

مثال متجر متعدد المنتجات:

```text
Store
├── iPhone 15       → Smartphone → Storage, RAM, Color, Warranty
├── Laptop          → Laptop     → RAM, Storage, CPU, Warranty
├── Headset         → Headset    → Connection, Microphone, Color
└── T-shirt         → Clothing   → Size, Color, Material
```

### Product Schema

نستخدم حقولًا أساسية مشتركة لكل المنتجات:
`name, description, price, images, stock, status, ...`

ثم خصائص ديناميكية حسب نوع المنتج:
`custom_attributes = { ... }`

هذا يمنع قاعدة البيانات من أن تصبح مرتبطة بمجال واحد، ويسمح بإضافة أنواع ومنتجات جديدة دون إعادة بناء الـCore System.

## 15. Dynamic AI Agent Configuration

الـAI Agent أيضًا **لا يعتمد على Prompt ثابت خاص بنوع متجر واحد**.

يُبنى سياق الـAI ديناميكيًا من:

```text
Base AI Instructions
        +
Store Information
        +
Product Types & Attributes
        +
Business Rules
        +
Knowledge Base / FAQ
        +
Current Product & Inventory Data
        +
Conversation Context
```

وبالتالي يستطيع نفس الـAI Agent التعامل داخل المتجر نفسه مع منتجات مختلفة تمامًا.

مثال:

- إذا كان المنتج `Shoes` وله `Size` و`Color`، يعرف الـAI أن سؤال العميل عن المقاس/اللون مرتبط بالـVariant المناسب.
- إذا كان المنتج `Laptop` وله `RAM` و`Storage`، يعرف الـAI أن هذه خصائص مختلفة ويستخدمها عند البحث والرد.

### قاعدة مهمة

**لا نكتب Agent منفصلًا لكل مجال. نبني Agent واحدًا قابلًا للتكوين، وتأتي معرفة المنتج وسلوكه من الـSchema والقواعد والبيانات الفعلية للمتجر.**

## 16. Configuration First Architecture

هذه الفكرة يجب أن تدخل في الـArchitecture من البداية، وليست إضافة تجميلية لاحقة.

المبدأ:

> **Core ثابت + Configuration قابلة للتخصيص.**

الـCore يحتوي على المنطق المشترك: Products, Inventory, Orders, Customers, AI Tools, Authentication, Permissions...

أما ما يختلف من متجر لآخر فيكون Configurable:

- Product Types
- Product Attributes
- Variants
- Business Rules
- AI Instructions
- FAQ / Knowledge
- Order Fields
- Customer Fields
- Negotiation Rules

بهذا يمكن للمنصة أن تبدأ بقوالب جاهزة لتسهيل الاستخدام، مع الحفاظ على حرية التاجر في تعديلها أو إنشاء إعدادات جديدة بالكامل.
