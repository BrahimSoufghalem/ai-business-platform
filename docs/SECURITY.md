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

### الطلبات والمخزون
- Idempotency keys للأوامر الحساسة.
- Transactions وconstraints تمنع oversell والتكرار.
- Audit append-only للتعديلات اليدوية، الخصم، التأكيد والإلغاء.
- لا تعديل مباشر للرصد أو السعر التاريخي.

## تصنيف البيانات

| التصنيف | أمثلة | السياسة الأولية |
|---|---|---|
| عام | وصف منتج منشور | يمكن إرساله للنموذج حسب الحاجة |
| داخلي | قواعد المتجر، مؤشرات الأداء | صلاحيات محددة؛ لا يظهر للعميل |
| شخصي | هاتف، عنوان، محادثة | تقليل، تشفير، redaction وretention |
| سري | API keys، tokens | Secret Manager فقط؛ لا prompts/logs |

## قبل Pilot حقيقي

- Threat modeling لتدفقات sign-in، webhook، AI tool calls، order confirm وexports.
- Dependency وcontainer scanning.
- Backup restore test.
- مراجعة Data retention وطلب الحذف/التصدير.
- Rate limits وabuse controls.
- Incident runbook ومسؤول واضح للاستجابة.
- مراجعة شروط مزود AI ومكان معالجة البيانات.
