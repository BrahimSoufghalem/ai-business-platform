# Security & Privacy Baseline

## مبادئ

- أقل صلاحية، رفض افتراضي، وعزل المتجر في كل طبقة.
- لا ثقة بمحتوى العميل أو Webhook أو Knowledge document.
- لا كتابة تجارية مباشرة من نموذج AI.
- اجمع وخزّن أقل قدر لازم من البيانات الشخصية.

## ضوابط MVP الإلزامية

### الهوية والوصول

- MFA للحسابات الإدارية متى دعمه مزود الهوية.
- Session قصيرة ومعالجة آمنة للـrefresh tokens.
- Membership ودور فعالان لكل request.
- منع owner الأخير من حذف نفسه دون نقل الملكية.
- إعادة تحقق للأفعال الحساسة مستقبلًا مثل تغيير التكاملات أو التصدير.

### عزل البيانات

- `tenant_id` غير قابل للفراغ ويمر من Context موثوق.
- RLS أو آلية دفاع مماثلة، واختبارات سلبية لكل Repository/endpoint.
- منع IDs من متجر آخر في العلاقات حتى لو كان المستخدم يملك الكيان المحلي.
- مفاتيح Object Storage وCache وQueue namespaced بالمتجر.

### الأسرار والتكاملات

- الأسرار في Secret Manager، لا في DB كنص واضح ولا في المستودع.
- تشفير integration tokens at rest وتدويرها.
- التحقق من Webhook signature وtimestamp ومنع replay.
- Secret scanning في CI وقبل كل إصدار.

### AI وPrompt Injection

- فصل تعليمات النظام عن المحتوى المسترجع.
- Allow-list للأدوات وSchemas مغلقة الحقول.
- Authorization داخل Tool نفسها، وليس عبر Prompt.
- عدم تمرير بيانات متجر آخر أو بيانات شخصية غير لازمة.
- حفظ traces منقحة مع retention محدود.
- رفض Tool input قبل استدعاء Handler، والتحقق من Tool output قبل إعادته للنموذج.
- عدم إعادة محاولة Provider بعد نجاح Command Tool؛ الانتقال إلى Handoff لمنع تكرار الأثر.
- مفاتيح المزود تبقى داخل Adapter وتأتي من Secret Manager؛ لا تدخل Prompt أو Telemetry.
- Router يوقف طلبات كشف التعليمات/الأسرار قبل أي قراءة لبيانات المتجر.
- الذاكرة تستبعد الرسائل الداخلية وتحجب البريد والهاتف والتوكنات قبل Context وTrace.
- Price/availability language في الرد تُرفض ما لم تحمل Evidence من Tool المختصة في الـRun نفسه.
- Product/Variant IDs في Structured Output تُقبل فقط إذا ظهرت في نتيجة بحث موثقة.
- Handoff summary منقح ومحدود؛ لا يحتوي هاتفًا أو بريدًا أو عنوانًا كاملًا، وتصبح حقول مصدره وسياقه immutable.
- التحويل يوقف البوت ذريًا، ولا يرسل الموظف للعميل إلا بعد `claim` ومن حساب المستخدم المعيّن.
- مفتاح Idempotency وpartial unique index يمنعان تحويلين مفتوحين أو إشعارين لنفس Turn.

### الطلبات والمخزون

- Idempotency keys للأوامر الحساسة.
- Transactions وconstraints تمنع oversell والتكرار.
- Audit append-only للتعديلات اليدوية، الخصم، التأكيد والإلغاء.
- لا تعديل مباشر للرصد أو السعر التاريخي.
- لا تأكيد من كلمة عامة أو قرار نموذج؛ يجب أن تأتي الموافقة الصريحة من رسالة عميل واردة محفوظة.
- أي خصم يحتاج Pricing Decision مطابقًا وإصدار قاعدة منشورًا، وتعيد عملية التأكيد فحص السعر والمخزون والنسخة.
- تكرار التأكيد يعيد Order المرتبط ولا يكرر الطلب أو حجز المخزون.

## تصنيف البيانات

| التصنيف | أمثلة                       | السياسة الأولية                     |
| ------- | --------------------------- | ----------------------------------- |
| عام     | وصف منتج منشور              | يمكن إرساله للنموذج حسب الحاجة      |
| داخلي   | قواعد المتجر، مؤشرات الأداء | صلاحيات محددة؛ لا يظهر للعميل       |
| شخصي    | هاتف، عنوان، محادثة         | تقليل، تشفير، redaction وretention  |
| سري     | API keys، tokens            | Secret Manager فقط؛ لا prompts/logs |

## قبل Pilot حقيقي

- أكمل [Pilot Security Review](PILOT_SECURITY_REVIEW.md) لتدفقات sign-in وAI tools وتأكيد الطلب والنسخ.
- شغّل `pnpm pilot:gates` على commit المرشح ولا تقبل ثغرات production ذات مستوى high/critical.
- نفّذ backup/restore drill وسجّل RPO/RTO الفعليين.
- راجع Data retention وطلب الحذف/التصدير.
- تحقق من rate limits وabuse controls؛ المحدد داخل الذاكرة يعني نسخة API واحدة فقط.
- عيّن مسؤول incident وبديلًا ونفّذ تمرين tabletop من [Pilot Operations](PILOT_OPERATIONS.md).
- راجع شروط مزود AI ومكان معالجة البيانات وعدم استخدامها للتدريب.
- لا تدخل بيانات حقيقية قبل توقيع [Pilot Go/No-Go](PILOT_GO_NO_GO.md).
