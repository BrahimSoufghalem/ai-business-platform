'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useApi, useTenantPath } from '../../../../components/providers';
import { useAsyncData } from '../../../../lib/use-async-data';
import type { AttributeDefinition, ProductTypeView, ProductView } from '../../../../lib/api/types';
import { ApiError } from '../../../../lib/api/client';
import { Button } from '../../../../components/ui/button';
import { FormField } from '../../../../components/ui/form-field';
import { Input } from '../../../../components/ui/input';
import { Select } from '../../../../components/ui/select';
import { Textarea } from '../../../../components/ui/textarea';
import { Checkbox } from '../../../../components/ui/checkbox';
import { InlineAlert } from '../../../../components/ui/alert';
import { Icon } from '../../../../components/icons';
import { IconButton } from '../../../../components/ui/icon-button';
import { useToast } from '../../../../components/ui/toast';

interface VariantDraft {
  sku: string;
  name: string;
  priceOverride: string;
  attributes: Record<string, string>;
}

interface FormState {
  productTypeId: string;
  code: string;
  name: string;
  description: string;
  basePrice: string;
  currency: string;
  status: 'draft' | 'active';
  attributes: Record<string, unknown>;
  variants: VariantDraft[];
}

function toState(product: ProductView | null): FormState {
  if (!product) {
    return {
      productTypeId: '',
      code: '',
      name: '',
      description: '',
      basePrice: '',
      currency: 'DZD',
      status: 'draft',
      attributes: {},
      variants: [],
    };
  }
  return {
    productTypeId: product.productTypeId,
    code: product.code,
    name: product.name,
    description: product.description ?? '',
    basePrice: product.basePrice,
    currency: product.currency,
    status: product.status === 'active' ? 'active' : 'draft',
    attributes: { ...product.customAttributes },
    variants: product.variants.map((variant) => ({
      sku: variant.sku,
      name: variant.name ?? '',
      priceOverride: variant.priceOverride ?? '',
      attributes: Object.fromEntries(
        Object.entries(variant.attributes).map(([k, v]) => [k, String(v ?? '')]),
      ),
    })),
  };
}

export function ProductForm({ product }: { product: ProductView | null }) {
  const t = useTranslations('products');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const api = useApi();
  const tenant = useTenantPath();
  const { toast } = useToast();

  const [state, setState] = useState<FormState>(() => toState(product));
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const typesQuery = useAsyncData<ProductTypeView[]>(
    (signal) => api.get(tenant('/product-types'), { signal }),
    [api, tenant],
  );
  const types = useMemo(
    () => (typesQuery.data ?? []).filter((type) => type.status === 'active'),
    [typesQuery.data],
  );
  const selectedType = types.find((type) => type.id === state.productTypeId) ?? null;

  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setDirty(true);
    setState((current) => ({ ...current, [key]: value }));
  }

  function setAttribute(key: string, value: unknown) {
    setDirty(true);
    setState((current) => ({ ...current, attributes: { ...current.attributes, [key]: value } }));
  }

  function variantAttributes(definitions: AttributeDefinition[]): AttributeDefinition[] {
    return definitions.filter((definition) => definition.variantAxis);
  }

  function productAttributes(definitions: AttributeDefinition[]): AttributeDefinition[] {
    return definitions.filter((definition) => !definition.variantAxis);
  }

  function addVariant() {
    setDirty(true);
    setState((current) => ({
      ...current,
      variants: [...current.variants, { sku: '', name: '', priceOverride: '', attributes: {} }],
    }));
  }

  function updateVariant(index: number, patch: Partial<VariantDraft>) {
    setDirty(true);
    setState((current) => ({
      ...current,
      variants: current.variants.map((variant, i) =>
        i === index ? { ...variant, ...patch } : variant,
      ),
    }));
  }

  function removeVariant(index: number) {
    setDirty(true);
    setState((current) => ({
      ...current,
      variants: current.variants.filter((_, i) => i !== index),
    }));
  }

  async function submit(publishAfter: boolean) {
    if (pending) return;
    setFormError(null);
    setPending(true);
    try {
      const payload = {
        productTypeId: state.productTypeId,
        code: state.code.trim(),
        name: state.name.trim(),
        description: state.description.trim() || null,
        basePrice: state.basePrice.trim(),
        currency: state.currency.trim().toUpperCase(),
        status: state.status,
        customAttributes: state.attributes,
        variants: state.variants
          .filter((variant) => variant.sku.trim())
          .map((variant) => ({
            sku: variant.sku.trim(),
            name: variant.name.trim() || null,
            attributes: variant.attributes,
            priceOverride: variant.priceOverride.trim() || null,
            status: 'active' as const,
          })),
      };

      let saved: ProductView;
      if (product) {
        saved = await api.put<ProductView>(tenant(`/products/${product.id}`), {
          expectedVersion: product.version,
          productTypeId: payload.productTypeId,
          code: payload.code,
          name: payload.name,
          description: payload.description,
          basePrice: payload.basePrice,
          currency: payload.currency,
          customAttributes: payload.customAttributes,
          variants: payload.variants,
        });
        toast(t('updated'), 'success');
      } else {
        saved = await api.post<ProductView>(tenant('/products'), payload);
        toast(t('created'), 'success');
      }

      if (publishAfter && saved.status !== 'active') {
        saved = await api.post<ProductView>(tenant(`/products/${saved.id}/publish`), {});
        toast(t('published'), 'success');
      }

      setDirty(false);
      router.push(`/${locale}/products/${saved.id}`);
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setFormError(t('expectedVersionConflict'));
      } else if (error instanceof ApiError) {
        setFormError(error.message);
      } else {
        setFormError(tc('connectionError'));
      }
      setPending(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit(false);
  }

  const invalid =
    !state.productTypeId ||
    state.code.trim().length === 0 ||
    state.name.trim().length < 2 ||
    !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(state.basePrice.trim()) ||
    state.currency.trim().length !== 3;

  return (
    <form onSubmit={onSubmit} className="stack page-narrow">
      {formError ? <InlineAlert kind="error">{formError}</InlineAlert> : null}
      {typesQuery.error ? <InlineAlert kind="error">{t('loadTypesFailed')}</InlineAlert> : null}

      <section className="panel">
        <div className="panel__header">
          <h2 className="panel__title">{t('basicInfo')}</h2>
        </div>
        <div className="panel__body">
          <div className="form-grid">
            <FormField label={tc('name')} required>
              <Input
                value={state.name}
                onChange={(e) => update('name', e.target.value)}
                minLength={2}
                maxLength={160}
                required
              />
            </FormField>
            <FormField label={t('code')} required hint={t('codeHint')}>
              <Input
                value={state.code}
                onChange={(e) => update('code', e.target.value)}
                maxLength={64}
                required
                dir="ltr"
                style={{ textAlign: 'start' }}
              />
            </FormField>
            <FormField label={t('productType')} required>
              <Select
                value={state.productTypeId}
                onChange={(e) => update('productTypeId', e.target.value)}
                required
              >
                <option value="">{t('selectType')}</option>
                {types.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label={t('basePrice')} required>
              <Input
                value={state.basePrice}
                onChange={(e) => update('basePrice', e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                required
                dir="ltr"
                style={{ textAlign: 'end' }}
              />
            </FormField>
            <FormField label={tc('currency')} required>
              <Input
                value={state.currency}
                onChange={(e) => update('currency', e.target.value.toUpperCase())}
                maxLength={3}
                minLength={3}
                required
                dir="ltr"
                style={{ textAlign: 'start', width: 110 }}
              />
            </FormField>
            <FormField label={t('initialStatus')}>
              <Select
                value={state.status}
                onChange={(e) => update('status', e.target.value as 'draft' | 'active')}
              >
                <option value="draft">{t('statusDraft')}</option>
                <option value="active">{t('statusActive')}</option>
              </Select>
            </FormField>
            <FormField label={tc('description')} className="field--full">
              <Textarea
                value={state.description}
                onChange={(e) => update('description', e.target.value)}
                maxLength={5000}
                rows={4}
              />
            </FormField>
          </div>
        </div>
      </section>

      {selectedType && productAttributes(selectedType.attributes).length > 0 ? (
        <section className="panel">
          <div className="panel__header">
            <h2 className="panel__title">{t('attributesSection')}</h2>
          </div>
          <div className="panel__body">
            <div className="form-grid">
              {productAttributes(selectedType.attributes).map((definition) => (
                <AttributeInput
                  key={definition.key}
                  definition={definition}
                  value={state.attributes[definition.key]}
                  onChange={(value) => setAttribute(definition.key, value)}
                  label={t('attributeValue')}
                />
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel__header">
          <h2 className="panel__title">{t('variantsSection')}</h2>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={addVariant}
            icon={<Icon name="plus" size={15} />}
          >
            {t('addVariant')}
          </Button>
        </div>
        <div className="panel__body">
          {state.variants.length === 0 ? (
            <p className="meta-text">{t('noVariants')}</p>
          ) : (
            <div className="stack">
              {state.variants.map((variant, index) => (
                <div key={index} className="panel" style={{ background: 'var(--bg)' }}>
                  <div className="panel__body">
                    <div className="form-grid">
                      <FormField label={t('sku')} required>
                        <Input
                          value={variant.sku}
                          onChange={(e) => updateVariant(index, { sku: e.target.value })}
                          dir="ltr"
                          style={{ textAlign: 'start' }}
                          required
                        />
                      </FormField>
                      <FormField label={t('variantName')}>
                        <Input
                          value={variant.name}
                          onChange={(e) => updateVariant(index, { name: e.target.value })}
                        />
                      </FormField>
                      <FormField label={t('priceOverride')}>
                        <Input
                          value={variant.priceOverride}
                          onChange={(e) => updateVariant(index, { priceOverride: e.target.value })}
                          inputMode="decimal"
                          dir="ltr"
                          style={{ textAlign: 'end' }}
                        />
                      </FormField>
                      {selectedType
                        ? variantAttributes(selectedType.attributes).map((definition) => (
                            <FormField key={definition.key} label={definition.label}>
                              <Input
                                value={variant.attributes[definition.key] ?? ''}
                                onChange={(e) =>
                                  updateVariant(index, {
                                    attributes: {
                                      ...variant.attributes,
                                      [definition.key]: e.target.value,
                                    },
                                  })
                                }
                              />
                            </FormField>
                          ))
                        : null}
                    </div>
                    <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
                      <IconButton
                        icon="trash"
                        label={tc('delete')}
                        onClick={() => removeVariant(index)}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <div className="form-actions">
        <Button type="submit" variant="secondary" loading={pending} disabled={invalid}>
          {t('saveDraft')}
        </Button>
        <Button
          type="button"
          loading={pending}
          disabled={invalid}
          onClick={() => void submit(true)}
        >
          {product && product.status === 'active' ? tc('save') : t('createAndPublish')}
        </Button>
      </div>
    </form>
  );
}

function AttributeInput({
  definition,
  value,
  onChange,
  label,
}: {
  definition: AttributeDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  label: string;
}) {
  if (definition.dataType === 'boolean') {
    return (
      <Checkbox
        label={definition.label}
        checked={Boolean(value)}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  }
  if (definition.dataType === 'select') {
    return (
      <FormField label={definition.label} required={definition.required}>
        <Select
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value || undefined)}
        >
          <option value="">—</option>
          {definition.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      </FormField>
    );
  }
  return (
    <FormField label={definition.label} required={definition.required}>
      <Input
        value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''}
        inputMode={definition.dataType === 'number' ? 'decimal' : undefined}
        onChange={(e) =>
          onChange(definition.dataType === 'number' ? Number(e.target.value) : e.target.value)
        }
        aria-label={`${definition.label} ${label}`}
      />
    </FormField>
  );
}
