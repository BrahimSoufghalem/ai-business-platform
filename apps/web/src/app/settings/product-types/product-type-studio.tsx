'use client';

import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

type TemplateKey = 'general' | 'clothing' | 'shoes' | 'smartphone' | 'laptop' | 'headset';
type AttributeDataType = 'text' | 'number' | 'boolean' | 'select' | 'multi_select';

interface AttributeDefinition {
  key: string;
  label: string;
  dataType: AttributeDataType;
  required: boolean;
  searchable: boolean;
  variantAxis: boolean;
  options: string[];
  position: number;
}

interface ProductTypeTemplate {
  key: TemplateKey;
  name: string;
  attributes: AttributeDefinition[];
}

interface ProductTypeView {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  templateKey: TemplateKey | null;
  schemaVersion: number;
  status: 'active' | 'archived';
  attributes: AttributeDefinition[];
  createdAt: string;
  updatedAt: string;
}

interface AttributeDraft {
  localId: string;
  key: string;
  label: string;
  dataType: AttributeDataType;
  required: boolean;
  searchable: boolean;
  variantAxis: boolean;
  optionsText: string;
}

interface ProductTypeDraft {
  name: string;
  slug: string;
  description: string;
  templateKey: TemplateKey | null;
  attributes: AttributeDraft[];
}

const templateLabels: Record<TemplateKey, string> = {
  general: 'منتج عام',
  clothing: 'ملابس',
  shoes: 'أحذية',
  smartphone: 'هاتف ذكي',
  laptop: 'حاسوب محمول',
  headset: 'سماعة',
};

const dataTypeLabels: Record<AttributeDataType, string> = {
  text: 'نص',
  number: 'رقم',
  boolean: 'نعم / لا',
  select: 'اختيار واحد',
  multi_select: 'اختيارات متعددة',
};

const emptyDraft: ProductTypeDraft = {
  name: '',
  slug: '',
  description: '',
  templateKey: null,
  attributes: [],
};

let localAttributeSequence = 0;

function localAttributeId(): string {
  localAttributeSequence += 1;
  return `attribute-${localAttributeSequence}`;
}

function toAttributeDraft(attribute: AttributeDefinition): AttributeDraft {
  return {
    localId: localAttributeId(),
    key: attribute.key,
    label: attribute.label,
    dataType: attribute.dataType,
    required: attribute.required,
    searchable: attribute.searchable,
    variantAxis: attribute.variantAxis,
    optionsText: attribute.options.join(', '),
  };
}

function toDraft(productType: ProductTypeView): ProductTypeDraft {
  return {
    name: productType.name,
    slug: productType.slug,
    description: productType.description ?? '',
    templateKey: productType.templateKey,
    attributes: productType.attributes.map(toAttributeDraft),
  };
}

function attributePayload(attribute: AttributeDraft) {
  const supportsOptions = attribute.dataType === 'select' || attribute.dataType === 'multi_select';
  return {
    key: attribute.key.trim(),
    label: attribute.label.trim(),
    dataType: attribute.dataType,
    required: attribute.required,
    searchable: attribute.searchable,
    variantAxis: attribute.variantAxis,
    options: supportsOptions
      ? attribute.optionsText
          .split(',')
          .map((option) => option.trim())
          .filter(Boolean)
      : [],
  };
}

export function ProductTypeStudio() {
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';
  const [tenantInput, setTenantInput] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [connection, setConnection] = useState<{ tenantId: string; token: string } | null>(null);
  const [templates, setTemplates] = useState<ProductTypeTemplate[]>([]);
  const [productTypes, setProductTypes] = useState<ProductTypeView[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProductTypeDraft>(emptyDraft);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [archiveArmed, setArchiveArmed] = useState(false);

  const selected = useMemo(
    () => productTypes.find((productType) => productType.id === selectedId) ?? null,
    [productTypes, selectedId],
  );
  const variantAxisCount = draft.attributes.filter((attribute) => attribute.variantAxis).length;

  const request = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      if (!connection) throw new Error('أدخل بيانات الاتصال أولًا.');
      const response = await fetch(`${apiBaseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${connection.token}`,
          'Content-Type': 'application/json',
          'X-Correlation-Id': crypto.randomUUID(),
          ...init?.headers,
        },
        cache: 'no-store',
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          message?: string | string[];
          issues?: { path?: string; message?: string }[];
        } | null;
        const message = Array.isArray(body?.message) ? body.message.join('، ') : body?.message;
        const issues = body?.issues
          ?.map((issue) => [issue.path, issue.message].filter(Boolean).join(': '))
          .filter(Boolean)
          .join('، ');
        throw new Error(
          [message, issues].filter(Boolean).join(' — ') || `فشل الطلب (${response.status}).`,
        );
      }
      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    },
    [apiBaseUrl, connection],
  );

  const refresh = useCallback(
    async (preferredId?: string): Promise<void> => {
      if (!connection) return;
      setPending(true);
      setError(null);
      try {
        const [loadedTemplates, loadedTypes] = await Promise.all([
          request<ProductTypeTemplate[]>('/product-type-templates'),
          request<ProductTypeView[]>(`/tenants/${connection.tenantId}/product-types`),
        ]);
        setTemplates(loadedTemplates);
        setProductTypes(loadedTypes);
        const next =
          loadedTypes.find((productType) => productType.id === preferredId) ??
          loadedTypes.find((productType) => productType.status === 'active') ??
          loadedTypes[0] ??
          null;
        setSelectedId(next?.id ?? null);
        setDraft(next ? toDraft(next) : { ...emptyDraft, attributes: [] });
        setArchiveArmed(false);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'تعذّر تحميل أنواع المنتجات.');
      } finally {
        setPending(false);
      }
    },
    [connection, request],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function connect(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setError(null);
    if (!/^[0-9a-f-]{36}$/iu.test(tenantInput.trim()) || tokenInput.trim().length < 10) {
      setError('تحقق من معرّف المتجر ورمز الدخول.');
      return;
    }
    setConnection({ tenantId: tenantInput.trim(), token: tokenInput.trim() });
    setTokenInput('');
  }

  function edit(productType: ProductTypeView): void {
    setSelectedId(productType.id);
    setDraft(toDraft(productType));
    setArchiveArmed(false);
    setError(null);
    setNotice(null);
  }

  function createCustom(): void {
    setSelectedId(null);
    setDraft({ ...emptyDraft, attributes: [] });
    setArchiveArmed(false);
    setError(null);
    setNotice('نوع جديد مخصص؛ أضف الخصائص التي يحتاجها متجرك.');
  }

  function useTemplate(template: ProductTypeTemplate): void {
    setSelectedId(null);
    setDraft({
      name: templateLabels[template.key],
      slug: template.key,
      description: '',
      templateKey: template.key,
      attributes: template.attributes.map(toAttributeDraft),
    });
    setArchiveArmed(false);
    setError(null);
    setNotice(`تم تحميل قالب ${templateLabels[template.key]}. يمكنك تعديله قبل الحفظ.`);
  }

  function updateAttribute(localId: string, patch: Partial<AttributeDraft>): void {
    setDraft((current) => ({
      ...current,
      attributes: current.attributes.map((attribute) =>
        attribute.localId === localId ? { ...attribute, ...patch } : attribute,
      ),
    }));
  }

  function changeDataType(attribute: AttributeDraft, dataType: AttributeDataType): void {
    const supportsAxis = dataType === 'text' || dataType === 'number' || dataType === 'select';
    const supportsOptions = dataType === 'select' || dataType === 'multi_select';
    updateAttribute(attribute.localId, {
      dataType,
      variantAxis: supportsAxis ? attribute.variantAxis : false,
      optionsText: supportsOptions ? attribute.optionsText : '',
    });
  }

  function addAttribute(): void {
    if (draft.attributes.length >= 50) {
      setError('الحد الأقصى هو 50 خاصية.');
      return;
    }
    setDraft((current) => ({
      ...current,
      attributes: [
        ...current.attributes,
        {
          localId: localAttributeId(),
          key: '',
          label: '',
          dataType: 'text',
          required: false,
          searchable: false,
          variantAxis: false,
          optionsText: '',
        },
      ],
    }));
  }

  function removeAttribute(localId: string): void {
    setDraft((current) => ({
      ...current,
      attributes: current.attributes.filter((attribute) => attribute.localId !== localId),
    }));
  }

  function moveAttribute(index: number, offset: -1 | 1): void {
    const target = index + offset;
    if (target < 0 || target >= draft.attributes.length) return;
    setDraft((current) => {
      const attributes = [...current.attributes];
      const [moved] = attributes.splice(index, 1);
      if (!moved) return current;
      attributes.splice(target, 0, moved);
      return { ...current, attributes };
    });
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!connection || selected?.status === 'archived') return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const input = {
        name: draft.name.trim(),
        slug: draft.slug.trim(),
        description: draft.description.trim() || null,
        attributes: draft.attributes.map(attributePayload),
      };
      const saved = selected
        ? await request<ProductTypeView>(
            `/tenants/${connection.tenantId}/product-types/${selected.id}`,
            {
              method: 'PUT',
              body: JSON.stringify({
                ...input,
                expectedSchemaVersion: selected.schemaVersion,
              }),
            },
          )
        : await request<ProductTypeView>(`/tenants/${connection.tenantId}/product-types`, {
            method: 'POST',
            body: JSON.stringify({
              ...input,
              ...(draft.templateKey ? { templateKey: draft.templateKey } : {}),
            }),
          });
      setNotice(
        selected ? `حُفظ إصدار المخطط ${saved.schemaVersion}.` : `أُنشئ نوع المنتج ${saved.name}.`,
      );
      await refresh(saved.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'تعذّر حفظ نوع المنتج.');
    } finally {
      setPending(false);
    }
  }

  async function archive(): Promise<void> {
    if (!connection || !selected || selected.status === 'archived') return;
    if (!archiveArmed) {
      setArchiveArmed(true);
      setNotice('اضغط تأكيد الأرشفة مرة ثانية. المنتجات الحالية لن تُحذف.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      await request<void>(`/tenants/${connection.tenantId}/product-types/${selected.id}`, {
        method: 'DELETE',
      });
      setNotice('تمت أرشفة نوع المنتج دون حذف البيانات التاريخية.');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'تعذّرت أرشفة نوع المنتج.');
    } finally {
      setPending(false);
    }
  }

  if (!connection) {
    return (
      <main className="operations-login">
        <form className="connect-card" onSubmit={connect}>
          <span className="eyebrow">CATALOG STUDIO</span>
          <h1>أنواع المنتجات</h1>
          <p>أنشئ مخططات مختلفة للهاتف والملابس وغيرها. يبقى رمز الدخول في ذاكرة الصفحة فقط.</p>
          <label>
            معرّف المتجر
            <input
              dir="ltr"
              autoComplete="off"
              value={tenantInput}
              onChange={(event) => setTenantInput(event.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
            />
          </label>
          <label>
            رمز الدخول
            <input
              dir="ltr"
              type="password"
              autoComplete="off"
              value={tokenInput}
              onChange={(event) => setTokenInput(event.target.value)}
              placeholder="Bearer token"
            />
          </label>
          {error ? <p className="error-banner">{error}</p> : null}
          <button type="submit">فتح استوديو الكتالوج</button>
          <a href="/">العودة إلى الرئيسية</a>
        </form>
      </main>
    );
  }

  return (
    <main className="config-shell product-type-shell">
      <header className="config-header">
        <div>
          <span className="eyebrow">DYNAMIC CATALOG</span>
          <h1>أنواع المنتجات</h1>
          <p>أضف نوعًا أو خاصية دون migration أو تغيير النظام الأساسي.</p>
        </div>
        <div className="product-type-header-actions">
          <a className="ghost-link" href="/settings/configuration">
            القواعد والمعرفة
          </a>
          <button
            className="ghost-button"
            type="button"
            disabled={pending}
            onClick={() => void refresh(selectedId ?? undefined)}
          >
            {pending ? 'جارٍ التحديث…' : 'تحديث'}
          </button>
        </div>
      </header>

      <section className="template-panel" aria-labelledby="template-title">
        <header>
          <div>
            <span className="eyebrow">STARTER TEMPLATES</span>
            <h2 id="template-title">ابدأ بقالب</h2>
          </div>
          <small>القالب يُنسخ ويمكن تعديله بالكامل.</small>
        </header>
        <div className="template-grid">
          {templates.map((template) => (
            <button type="button" key={template.key} onClick={() => useTemplate(template)}>
              <b>{templateLabels[template.key]}</b>
              <span>{template.attributes.length} خصائص</span>
            </button>
          ))}
        </div>
      </section>

      {error ? <p className="error-banner product-type-banner">{error}</p> : null}
      {notice ? <p className="notice-banner">{notice}</p> : null}

      <section className="config-grid product-type-grid">
        <aside className="config-list product-type-list">
          <button className="new-record" type="button" onClick={createCustom}>
            + نوع مخصص
          </button>
          {productTypes.map((productType) => (
            <button
              className={productType.id === selectedId ? 'selected' : ''}
              type="button"
              key={productType.id}
              onClick={() => edit(productType)}
            >
              <b>{productType.name}</b>
              <span dir="ltr">{productType.slug}</span>
              <small>
                v{productType.schemaVersion} · {productType.attributes.length} خصائص ·{' '}
                {productType.status === 'active' ? 'نشط' : 'مؤرشف'}
              </small>
            </button>
          ))}
          {productTypes.length === 0 ? (
            <p className="product-type-empty">
              لا توجد أنواع بعد. اختر قالبًا أو أنشئ نوعًا مخصصًا.
            </p>
          ) : null}
        </aside>

        <section className="config-editor product-type-editor">
          <form className="config-form" onSubmit={(event) => void save(event)}>
            <div className="form-title">
              <div>
                <h2>{selected ? selected.name : 'نوع منتج جديد'}</h2>
                <p>
                  {selected
                    ? `إصدار المخطط ${selected.schemaVersion} · ${selected.status === 'active' ? 'نشط' : 'مؤرشف'}`
                    : draft.templateKey
                      ? `مبني على قالب ${templateLabels[draft.templateKey]}`
                      : 'مخطط مخصص بالكامل'}
                </p>
              </div>
              {selected?.status === 'active' ? (
                <button
                  className={archiveArmed ? 'archive-button armed' : 'archive-button'}
                  type="button"
                  disabled={pending}
                  onClick={() => void archive()}
                >
                  {archiveArmed ? 'تأكيد الأرشفة' : 'أرشفة'}
                </button>
              ) : null}
            </div>

            <div className="form-columns">
              <label>
                الاسم
                <input
                  required
                  minLength={2}
                  maxLength={80}
                  disabled={selected?.status === 'archived'}
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </label>
              <label>
                Slug
                <input
                  required
                  dir="ltr"
                  pattern="[a-z][a-z0-9-]{0,63}"
                  disabled={selected?.status === 'archived'}
                  value={draft.slug}
                  onChange={(event) => setDraft({ ...draft, slug: event.target.value })}
                  placeholder="smartphones"
                />
              </label>
            </div>
            <label>
              الوصف
              <textarea
                maxLength={500}
                disabled={selected?.status === 'archived'}
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                placeholder="وصف داخلي اختياري لهذا النوع"
              />
            </label>

            <section className="attribute-builder">
              <header>
                <div>
                  <h3>الخصائص الديناميكية</h3>
                  <p>
                    {draft.attributes.length}/50 خاصية · {variantAxisCount}/3 محاور Variant
                  </p>
                </div>
                <button
                  type="button"
                  disabled={pending || selected?.status === 'archived'}
                  onClick={addAttribute}
                >
                  + إضافة خاصية
                </button>
              </header>

              <div className="attribute-list">
                {draft.attributes.map((attribute, index) => {
                  const supportsOptions =
                    attribute.dataType === 'select' || attribute.dataType === 'multi_select';
                  const supportsAxis =
                    attribute.dataType === 'text' ||
                    attribute.dataType === 'number' ||
                    attribute.dataType === 'select';
                  return (
                    <article className="attribute-card" key={attribute.localId}>
                      <header>
                        <b>خاصية {index + 1}</b>
                        <div>
                          <button
                            type="button"
                            aria-label="نقل الخاصية للأعلى"
                            disabled={index === 0 || selected?.status === 'archived'}
                            onClick={() => moveAttribute(index, -1)}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            aria-label="نقل الخاصية للأسفل"
                            disabled={
                              index === draft.attributes.length - 1 ||
                              selected?.status === 'archived'
                            }
                            onClick={() => moveAttribute(index, 1)}
                          >
                            ↓
                          </button>
                          <button
                            className="remove-attribute"
                            type="button"
                            disabled={selected?.status === 'archived'}
                            onClick={() => removeAttribute(attribute.localId)}
                          >
                            حذف
                          </button>
                        </div>
                      </header>
                      <div className="attribute-fields">
                        <label>
                          المفتاح
                          <input
                            required
                            dir="ltr"
                            pattern="[a-z][a-z0-9_]{0,63}"
                            disabled={selected?.status === 'archived'}
                            value={attribute.key}
                            onChange={(event) =>
                              updateAttribute(attribute.localId, {
                                key: event.target.value.toLowerCase().replace(/[\s-]+/gu, '_'),
                              })
                            }
                            placeholder="storage"
                          />
                        </label>
                        <label>
                          الاسم الظاهر
                          <input
                            required
                            maxLength={80}
                            disabled={selected?.status === 'archived'}
                            value={attribute.label}
                            onChange={(event) =>
                              updateAttribute(attribute.localId, { label: event.target.value })
                            }
                            placeholder="السعة"
                          />
                        </label>
                        <label>
                          نوع القيمة
                          <select
                            disabled={selected?.status === 'archived'}
                            value={attribute.dataType}
                            onChange={(event) =>
                              changeDataType(attribute, event.target.value as AttributeDataType)
                            }
                          >
                            {(Object.keys(dataTypeLabels) as AttributeDataType[]).map(
                              (dataType) => (
                                <option key={dataType} value={dataType}>
                                  {dataTypeLabels[dataType]}
                                </option>
                              ),
                            )}
                          </select>
                        </label>
                      </div>
                      <div className="attribute-flags">
                        <label>
                          <input
                            type="checkbox"
                            disabled={selected?.status === 'archived'}
                            checked={attribute.required}
                            onChange={(event) =>
                              updateAttribute(attribute.localId, {
                                required: event.target.checked,
                              })
                            }
                          />
                          مطلوب
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            disabled={selected?.status === 'archived'}
                            checked={attribute.searchable}
                            onChange={(event) =>
                              updateAttribute(attribute.localId, {
                                searchable: event.target.checked,
                              })
                            }
                          />
                          قابل للبحث
                        </label>
                        <label title={supportsAxis ? undefined : 'هذا النوع لا يصلح كمحور Variant'}>
                          <input
                            type="checkbox"
                            disabled={!supportsAxis || selected?.status === 'archived'}
                            checked={attribute.variantAxis}
                            onChange={(event) =>
                              updateAttribute(attribute.localId, {
                                variantAxis: event.target.checked,
                              })
                            }
                          />
                          محور Variant
                        </label>
                      </div>
                      {supportsOptions ? (
                        <label>
                          الخيارات — افصل بفاصلة
                          <input
                            required
                            dir="ltr"
                            disabled={selected?.status === 'archived'}
                            value={attribute.optionsText}
                            onChange={(event) =>
                              updateAttribute(attribute.localId, {
                                optionsText: event.target.value,
                              })
                            }
                            placeholder="64 GB, 128 GB, 256 GB"
                          />
                        </label>
                      ) : null}
                    </article>
                  );
                })}
                {draft.attributes.length === 0 ? (
                  <p className="attribute-empty">
                    لا توجد خصائص. النوع العام صالح، أو أضف خصائص حسب منتجاتك.
                  </p>
                ) : null}
              </div>
            </section>

            <button type="submit" disabled={pending || selected?.status === 'archived'}>
              {pending ? 'جارٍ الحفظ…' : selected ? 'حفظ إصدار جديد' : 'إنشاء نوع المنتج'}
            </button>
          </form>
        </section>
      </section>
    </main>
  );
}
