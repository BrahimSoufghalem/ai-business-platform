# Data Model — Conceptual

## قواعد عامة

- كل كيان يخص متجرًا يحمل `tenant_id` غير قابل للفراغ.
- المعرفات داخلية وعشوائية، بينما Product Code قابل للعرض ويكون فريدًا داخل المتجر.
- الحذف الافتراضي Soft Delete للبيانات التشغيلية؛ السجلات المحاسبية والتدقيق لا تحذف عاديًا.
- timestamps تحفظ UTC، وتعرض حسب Timezone المتجر.
- حقول JSONB تُتحقق من Schema وتملك `schema_version` عند الحاجة.

## الكيانات

| الكيان                   | أهم الحقول                                                                     | ملاحظات                             |
| ------------------------ | ------------------------------------------------------------------------------ | ----------------------------------- |
| tenants                  | id, name, locale, timezone, status                                             | المتجر/المستأجر                     |
| users                    | id, identity_provider_id                                                       | هوية عالمية                         |
| memberships              | tenant_id, user_id, role, status                                               | مصدر الصلاحيات                      |
| product_types            | tenant_id, name, slug, template_key                                            | نوع مخصص أو مستنسخ من Template      |
| attribute_definitions    | product_type_id, key, label, data_type, required, variant_axis                 | تعريف قابل للتخصيص                  |
| products                 | tenant_id, product_type_id, code, name, description, status, custom_attributes | الحقول المشتركة + القيم الديناميكية |
| product_variants         | product_id, sku, attributes, price_override, status                            | توليفة قابلة للبيع                  |
| product_media            | product_id, object_key, sort_order                                             | صور وملفات                          |
| content_product_links    | tenant_id, channel, external_content_id, product_id                            | Reel/Post/Product mapping           |
| inventory_locations      | tenant_id, code, name, is_default                                              | موقع افتراضي واحد لكل متجر          |
| inventory_movements      | tenant_id, location_id, variant_id, deltas, idempotency_key                    | Ledger append-only                  |
| inventory_balances       | tenant_id, location_id, variant_id, on_hand, reserved, reorder_point           | Projection ذري                      |
| stock_reservations       | tenant_id, location_id, variant_id, quantity, status, reference                | active → released/committed         |
| customers                | tenant_id, name, status, metadata, version                                     | ملف موحد وOptimistic updates        |
| customer_contacts        | customer_id, type, value, normalized_value, is_primary                         | Dedup آمن داخل المتجر               |
| customer_addresses       | customer_id, label, address fields, is_default                                 | Snapshot لاحقًا داخل الطلب          |
| customer_notes           | customer_id, body, author_id                                                   | ملاحظات append-only                 |
| conversations            | tenant_id, customer_id, channel, status, assigned_to, entity links             | سياق وصندوق الموظف                  |
| messages                 | conversation_id, direction, sender_type, content, external_id, fingerprint     | Idempotent وappend-only             |
| conversation_transitions | conversation_id, from_status, to_status, actor                                 | تاريخ الحالات append-only           |
| draft_orders             | tenant_id, status, version, customer/address data, totals                      | قابل للتعديل قبل التأكيد            |
| draft_order_items        | draft_order_id, variant_id, location_id, quantity, quoted_price                | عرض مشتق من الكتالوج                |
| orders                   | tenant_id, source_draft_order_id, number, status, totals, address_snapshot     | سجل مؤكد                            |
| order_items              | order_id, variant_id, reservation_id, product/price snapshots, quantity        | Snapshot تاريخي                     |
| order_commands           | tenant_id, order_id, type, idempotency_key, fingerprint                        | سجل أوامر قابل لإعادة المحاولة      |
| order_transitions        | tenant_id, order_id, from_status, to_status, actor                             | تاريخ انتقالات append-only          |
| business_rules           | tenant_id, key, value, version, status                                         | قواعد Typed ومنشورة                 |
| knowledge_entries        | tenant_id, title, content, status, version                                     | FAQ ومعرفة المتجر                   |
| ai_runs                  | tenant_id, conversation_id, model, prompt_version, usage, outcome              | مراقبة وتكلفة                       |
| ai_tool_calls            | ai_run_id, tool, safe_input, result_status, latency                            | لا تحفظ أسرارًا                     |
| handoffs                 | conversation_id, reason, summary, assigned_to, resolved_at                     | مسار الموظف                         |
| audit_events             | tenant_id, actor, action, entity, before/after metadata                        | Append-only                         |
| outbox_events            | tenant_id, type, payload, published_at                                         | ضمان الأحداث                        |

## علاقات مختصرة

```mermaid
erDiagram
  TENANT ||--o{ MEMBERSHIP : has
  TENANT ||--o{ PRODUCT_TYPE : configures
  PRODUCT_TYPE ||--o{ ATTRIBUTE_DEFINITION : defines
  PRODUCT_TYPE ||--o{ PRODUCT : classifies
  PRODUCT ||--o{ PRODUCT_VARIANT : has
  PRODUCT_VARIANT ||--o{ INVENTORY_MOVEMENT : tracked_by
  CUSTOMER ||--o{ CONVERSATION : starts
  CONVERSATION ||--o{ MESSAGE : contains
  CUSTOMER ||--o{ CUSTOMER_CONTACT : has
  CUSTOMER ||--o{ CUSTOMER_ADDRESS : has
  CONVERSATION }o--o| PRODUCT : may_reference
  CONVERSATION }o--o| DRAFT_ORDER : may_reference
  CONVERSATION }o--o| ORDER : may_reference
  DRAFT_ORDER ||--o{ DRAFT_ORDER_ITEM : contains
  ORDER ||--o{ ORDER_ITEM : contains
  CUSTOMER ||--o{ ORDER : places
  CONVERSATION ||--o{ AI_RUN : produces
  AI_RUN ||--o{ AI_TOOL_CALL : invokes
```

## مثال خصائص ديناميكية

```json
{
  "productType": "smartphone",
  "attributes": {
    "storage_gb": 256,
    "ram_gb": 8,
    "color": "black",
    "warranty_months": 12
  }
}
```

تعريف النوع يحدد أن `storage_gb` رقم مطلوب، وأن `color` خيار مسموح وربما Variant axis. أي مفتاح مجهول أو نوع قيمة خاطئ يُرفض قبل الحفظ.

## ثوابت Domain

1. `available = on_hand - reserved` ولا يكون سالبًا افتراضيًا.
2. مجموع Order Items والخصومات والشحن يطابق Order total مع قواعد rounding ثابتة.
3. السعر التاريخي في Order Item لا يتغير عند تعديل Product لاحقًا.
4. انتقال الحالة يحدث مرة واحدة وبـIdempotency key.
5. AI لا يكتب في الجداول؛ يستدعي Application Commands مسجلة كـTools.
6. كل relation بين كيانات تشغيلية تتحقق من تطابق `tenant_id`.
7. Content ID لا يحدد منتجًا إلا داخل tenant + channel الصحيحين.

## فهارس أولية

- `(tenant_id, status)` للطلبات والمحادثات والمنتجات.
- unique `(tenant_id, code)` و`(tenant_id, sku)` بحسب السياسة.
- unique `(tenant_id, conversation_id, external_id)` للرسائل الخارجية.
- unique `(tenant_id, normalized_value)` لاتصالات العملاء.
- GIN انتقائي على `custom_attributes` بعد قياس Queries الحقيقية، لا افتراضيًا لكل شيء.
