# Contributing

## سير العمل

- فرع `main` قابل للنشر دائمًا.
- فروع قصيرة: `feat/<issue>-name`, `fix/<issue>-name`, `docs/<issue>-name`.
- Commits واضحة بأسلوب Conventional Commits عند الإمكان.
- كل PR يرتبط بـIssue ويشرح الأثر، الاختبارات، migrations والمخاطر.

## شروط الدمج

- CI أخضر وReviewer واحد على الأقل.
- لا أسرار أو بيانات عملاء في الكود/fixtures/logs.
- اختبارات tenant isolation لأي Query أو Command جديد.
- اختبارات transaction/idempotency لأوامر الطلب والمخزون.
- أي Tool جديدة للـAI لها Schema، authorization، audit، timeout واختبارات إساءة.
- تحديث الوثائق وOpenAPI عند تغيير السلوك.

## قواعد Domain

لا تتجاوز طبقة التطبيق للوصول المباشر للجداول من Controller أو AI provider. واجهة المستخدم لا تحسب السعر النهائي أو الرصيد الموثوق. كل كتابة حساسة تمر عبر Use Case باسم تجاري واضح.
