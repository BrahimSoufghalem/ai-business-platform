'use client';

import { useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useApi, useTenantPath } from '../../../../components/providers';
import { useAsyncData } from '../../../../lib/use-async-data';
import { formatDate } from '../../../../lib/format';
import type {
  AttributeDataType,
  ProductTypeTemplateView,
  ProductTypeView,
} from '../../../../lib/api/types';
import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import { DataTable, TableWrap, Td, Th } from '../../../../components/ui/data-table';
import { Dialog } from '../../../../components/ui/dialog';
import { ConfirmDialog } from '../../../../components/ui/confirm-dialog';
import { EmptyState } from '../../../../components/ui/empty-state';
import { ErrorState } from '../../../../components/ui/error-state';
import { FormField } from '../../../../components/ui/form-field';
import { Icon } from '../../../../components/icons';
import { InlineAlert } from '../../../../components/ui/alert';
import { Input } from '../../../../components/ui/input';
import { Select } from '../../../../components/ui/select';
import { Skeleton } from '../../../../components/ui/skeleton';
import { Textarea } from '../../../../components/ui/textarea';
import { Checkbox } from '../../../../components/ui/checkbox';
import { useToast } from '../../../../components/ui/toast';

interface AttributeDraft {
  key: string;
  label: string;
  dataType: AttributeDataType;
  required: boolean;
  variantAxis: boolean;
  options: string;
}

const emptyAttribute: AttributeDraft = {
  key: '',
  label: '',
  dataType: 'text',
  required: false,
  variantAxis: false,
  options: '',
};

export function ProductTypesStudio() {
  const t = useTranslations('productTypes');
  const tc = useTranslations('common');
  const locale = useLocale();
  const api = useApi();
  const tenant = useTenantPath();
  const { toast } = useToast();

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProductTypeView | null>(null);

  const typesQuery = useAsyncData<ProductTypeView[]>(
    (signal) => api.get(tenant('/product-types'), { signal }),
    [api, tenant],
  );
  const templatesQuery = useAsyncData<ProductTypeTemplateView[]>(
    (signal) => api.get('/product-type-templates', { signal }),
    [api],
  );

  async function remove(target: ProductTypeView) {
    await api.delete(tenant(`/product-types/${target.id}`));
    toast(t('deleted'), 'success');
    typesQuery.reload();
  }

  return (
    <>
      <div className="filter-bar" style={{ justifyContent: 'flex-end' }}>
        <Button onClick={() => setCreateOpen(true)} icon={<Icon name="plus" size={16} />}>
          {t('addType')}
        </Button>
      </div>

      {typesQuery.loading ? (
        <div className="panel">
          <div className="panel__body">
            <Skeleton lines={4} height={18} />
          </div>
        </div>
      ) : typesQuery.error ? (
        <ErrorState onRetry={typesQuery.reload} />
      ) : (typesQuery.data ?? []).length === 0 ? (
        <div className="panel">
          <EmptyState
            icon="package"
            title={t('emptyTitle')}
            body={t('emptyBody')}
            action={
              <Button onClick={() => setCreateOpen(true)} icon={<Icon name="plus" size={16} />}>
                {t('addType')}
              </Button>
            }
          />
        </div>
      ) : (
        <TableWrap>
          <DataTable
            caption={t('title')}
            head={
              <>
                <Th>{t('typeName')}</Th> <Th>{t('slug')}</Th> <Th numeric>{t('attributes')}</Th>{' '}
                <Th>{tc('status')}</Th> <Th>{tc('createdAt')}</Th>{' '}
                <Th>
                  <span className="visually-hidden">{tc('actions')}</span>
                </Th>
              </>
            }
          >
            {(typesQuery.data ?? []).map((type) => (
              <tr key={type.id}>
                <Td ellipsis>
                  <span className="cell-main" dir="auto">
                    {type.name}
                  </span>
                  {type.description ? (
                    <div className="cell-sub" dir="auto">
                      {type.description}
                    </div>
                  ) : null}
                </Td>
                <Td>
                  <span className="num" translate="no">
                    {type.slug}
                  </span>
                </Td>
                <Td numeric>{type.attributes.length}</Td>
                <Td>
                  <Badge tone={type.status === 'active' ? 'success' : 'neutral'}>
                    {type.status === 'active' ? t('active') : t('archived')}
                  </Badge>
                </Td>
                <Td>
                  <span className="cell-sub">{formatDate(type.createdAt, locale)}</span>
                </Td>
                <Td>
                  <Button
                    variant="danger-secondary"
                    size="sm"
                    onClick={() => setDeleteTarget(type)}
                  >
                    {tc('delete')}
                  </Button>
                </Td>
              </tr>
            ))}
          </DataTable>
        </TableWrap>
      )}

      <ProductTypeCreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onDone={() => typesQuery.reload()}
        templates={templatesQuery.data ?? []}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (deleteTarget) await remove(deleteTarget);
        }}
        title={t('deleteTitle')}
        body={t('deleteBody')}
        confirmLabel={tc('delete')}
        danger
      />
    </>
  );
}

function ProductTypeCreateDialog({
  open,
  onClose,
  onDone,
  templates,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  templates: ProductTypeTemplateView[];
}) {
  const t = useTranslations('productTypes');
  const tc = useTranslations('common');
  const api = useApi();
  const tenant = useTenantPath();
  const { toast } = useToast();

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [templateKey, setTemplateKey] = useState('general');
  const [attributes, setAttributes] = useState<AttributeDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function applyTemplate(nextKey: string) {
    setTemplateKey(nextKey);
    const template = templates.find((item) => item.key === nextKey);
    if (template) {
      setAttributes(
        template.attributes.map((attribute) => ({
          key: attribute.key,
          label: attribute.label,
          dataType: attribute.dataType,
          required: attribute.required ?? false,
          variantAxis: attribute.variantAxis ?? false,
          options: (attribute.options ?? []).join(', '),
        })),
      );
    } else {
      setAttributes([]);
    }
  }

  function updateAttribute(index: number, patch: Partial<AttributeDraft>) {
    setAttributes((current) =>
      current.map((attribute, i) => (i === index ? { ...attribute, ...patch } : attribute)),
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      await api.post(tenant('/product-types'), {
        name: name.trim(),
        slug: slug.trim(),
        description: description.trim() || null,
        templateKey: templateKey === 'general' ? undefined : templateKey,
        attributes: attributes
          .filter((attribute) => attribute.key.trim() && attribute.label.trim())
          .map((attribute) => ({
            key: attribute.key.trim(),
            label: attribute.label.trim(),
            dataType: attribute.dataType,
            required: attribute.required,
            variantAxis: attribute.variantAxis,
            ...(attribute.dataType === 'select' || attribute.dataType === 'multi_select'
              ? {
                  options: attribute.options
                    .split(',')
                    .map((option) => option.trim())
                    .filter(Boolean),
                }
              : {}),
          })),
      });
      toast(t('created'), 'success');
      setName('');
      setSlug('');
      setDescription('');
      setAttributes([]);
      onClose();
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : tc('errorBody'));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t('addType')} wide>
      {error ? <InlineAlert kind="error">{error}</InlineAlert> : null}
      <form onSubmit={submit} className="stack mt-4">
        <div className="form-grid">
          <FormField label={t('typeName')} required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
              maxLength={80}
            />
          </FormField>
          <FormField label={t('slug')} required hint={t('slugHint')}>
            <Input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              required
              pattern="[a-z][a-z0-9-]{0,63}"
              dir="ltr"
              style={{ textAlign: 'start' }}
            />
          </FormField>
        </div>
        <FormField label={tc('description')}>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            maxLength={500}
          />
        </FormField>
        <FormField label={t('template')}>
          <Select value={templateKey} onChange={(e) => applyTemplate(e.target.value)}>
            <option value="general">{t('custom')}</option>
            {templates
              .filter((template) => template.key !== 'general')
              .map((template) => (
                <option key={template.key} value={template.key} translate="no">
                  {template.name}
                </option>
              ))}
          </Select>
        </FormField>

        <div className="field">
          <span className="field__label">{t('attributes')}</span>
          {attributes.length === 0 ? <p className="field__hint">{t('emptyBody')}</p> : null}
          <div className="stack">
            {attributes.map((attribute, index) => (
              <div key={index} className="panel" style={{ background: 'var(--bg)' }}>
                <div className="panel__body">
                  <div className="form-grid">
                    <FormField label={t('attrKey')} required>
                      <Input
                        value={attribute.key}
                        onChange={(e) => updateAttribute(index, { key: e.target.value })}
                        dir="ltr"
                        style={{ textAlign: 'start' }}
                        required
                      />
                    </FormField>
                    <FormField label={t('attrLabel')} required>
                      <Input
                        value={attribute.label}
                        onChange={(e) => updateAttribute(index, { label: e.target.value })}
                        required
                      />
                    </FormField>
                    <FormField label={t('attrType')} required>
                      <Select
                        value={attribute.dataType}
                        onChange={(e) =>
                          updateAttribute(index, { dataType: e.target.value as AttributeDataType })
                        }
                      >
                        <option value="text">text</option>
                        <option value="number">number</option>
                        <option value="boolean">boolean</option>
                        <option value="select">select</option>
                        <option value="multi_select">multi_select</option>
                      </Select>
                    </FormField>
                    {attribute.dataType === 'select' || attribute.dataType === 'multi_select' ? (
                      <FormField label={t('attrOptions')} required>
                        <Input
                          value={attribute.options}
                          onChange={(e) => updateAttribute(index, { options: e.target.value })}
                          required
                          dir="auto"
                        />
                      </FormField>
                    ) : null}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      gap: 16,
                      marginTop: 8,
                      alignItems: 'center',
                      flexWrap: 'wrap',
                    }}
                  >
                    <Checkbox
                      label={t('attrRequired')}
                      checked={attribute.required}
                      onChange={(e) => updateAttribute(index, { required: e.target.checked })}
                    />
                    <Checkbox
                      label={t('attrVariantAxis')}
                      checked={attribute.variantAxis}
                      onChange={(e) => updateAttribute(index, { variantAxis: e.target.checked })}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setAttributes((current) => current.filter((_, i) => i !== index))
                      }
                      style={{ marginInlineStart: 'auto' }}
                    >
                      {tc('delete')}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setAttributes((current) => [...current, { ...emptyAttribute }])}
              icon={<Icon name="plus" size={15} />}
            >
              {t('addAttribute')}
            </Button>
          </div>
        </div>

        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
            {tc('cancel')}
          </Button>
          <Button type="submit" loading={pending}>
            {t('addType')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
