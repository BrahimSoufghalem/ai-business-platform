'use client';

import { useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useApi, useStore, useTenantPath } from '../../../../../components/providers';
import { useAsyncData } from '../../../../../lib/use-async-data';
import { formatDateTime, formatMoney } from '../../../../../lib/format';
import type { ProductTypeView, ProductView } from '../../../../../lib/api/types';
import { ApiError } from '../../../../../lib/api/client';
import { PageHeader } from '../../../../../components/ui/page-header';
import { Breadcrumbs } from '../../../../../components/ui/breadcrumbs';
import { Badge } from '../../../../../components/ui/badge';
import { Button } from '../../../../../components/ui/button';
import { DataTable, TableWrap, Td, Th } from '../../../../../components/ui/data-table';
import { Skeleton } from '../../../../../components/ui/skeleton';
import { ErrorState } from '../../../../../components/ui/error-state';
import { ConfirmDialog } from '../../../../../components/ui/confirm-dialog';
import { InlineAlert } from '../../../../../components/ui/alert';
import { Icon } from '../../../../../components/icons';
import { useToast } from '../../../../../components/ui/toast';
import { ProductForm } from '../product-form';

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_MEDIA_SIZE = 5 * 1024 * 1024;

function fileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read_failed'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const separator = result.indexOf(',');
      if (separator < 0) reject(new Error('read_failed'));
      else resolve(result.slice(separator + 1));
    };
    reader.readAsDataURL(file);
  });
}

export function ProductDetails() {
  const t = useTranslations('products');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const api = useApi();
  const tenant = useTenantPath();
  const store = useStore();
  const { toast } = useToast();
  const canWrite = store.role !== 'agent';

  const [editing, setEditing] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const query = useAsyncData<ProductView>(
    (signal) => api.get(tenant(`/products/${params.id}`), { signal }),
    [api, tenant, params.id],
  );
  const product = query.data;
  const typesQuery = useAsyncData<ProductTypeView[]>(
    (signal) => api.get(tenant('/product-types'), { signal }),
    [api, tenant],
  );
  const attributeLabels = useMemo(() => {
    const selected = typesQuery.data?.find((type) => type.id === product?.productTypeId);
    return new Map(selected?.attributes.map((definition) => [definition.key, definition.label]));
  }, [product?.productTypeId, typesQuery.data]);

  async function publish() {
    if (!product) return;
    await api.post(tenant(`/products/${product.id}/publish`), {});
    toast(t('published'), 'success');
    query.reload();
  }

  async function archive() {
    if (!product) return;
    await api.delete(tenant(`/products/${product.id}`));
    toast(t('archived'), 'success');
    router.push(`/${locale}/products`);
  }

  async function restore() {
    if (!product) return;
    const restored = await api.post<ProductView>(tenant(`/products/${product.id}/restore`), {});
    query.setData(restored);
    toast(t('restored'), 'success');
  }

  async function uploadFile(file: File) {
    if (!product || !ACCEPTED_TYPES.includes(file.type)) {
      setUploadError(t('mediaInvalidType'));
      return;
    }
    if (file.size > MAX_MEDIA_SIZE) {
      setUploadError(t('mediaTooLarge'));
      return;
    }
    setUploadError(null);
    setUploading(true);
    try {
      await api.post(tenant(`/products/${product.id}/media/upload`), {
        filename: file.name,
        contentType: file.type,
        altText: product.name,
        sortOrder: product.media.length,
        dataBase64: await fileAsBase64(file),
      });
      toast(t('mediaUploaded'), 'success');
      query.reload();
    } catch (caught) {
      setUploadError(
        caught instanceof ApiError
          ? caught.status === 0
            ? tc('connectionError')
            : caught.message
          : t('mediaFailed'),
      );
    } finally {
      setUploading(false);
    }
  }

  if (query.loading) {
    return (
      <div className="stack">
        <Skeleton height={36} width="40%" />
        <Skeleton lines={5} height={18} />
      </div>
    );
  }

  if (query.error || !product) {
    return <ErrorState onRetry={query.reload} />;
  }

  if (editing && canWrite) {
    return (
      <>
        <PageHeader
          title={t('editProduct')}
          breadcrumb={
            <Breadcrumbs
              items={[
                { label: t('title'), href: '/products' },
                { label: product.name, href: `/products/${product.id}` },
                { label: tc('edit') },
              ]}
            />
          }
        />
        <ProductForm product={product} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={product.name}
        breadcrumb={
          <Breadcrumbs
            items={[{ label: t('title'), href: '/products' }, { label: product.name }]}
          />
        }
        actions={
          canWrite ? (
            <>
              {product.status === 'draft' ? (
                <Button
                  variant="secondary"
                  onClick={() => setConfirmPublish(true)}
                  icon={<Icon name="check" size={16} />}
                >
                  {tc('publish')}
                </Button>
              ) : null}
              {product.status === 'archived' ? (
                <Button
                  variant="secondary"
                  onClick={() => setConfirmRestore(true)}
                  icon={<Icon name="refresh" size={16} />}
                >
                  {t('restore')}
                </Button>
              ) : (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => setEditing(true)}
                    icon={<Icon name="pencil" size={16} />}
                  >
                    {tc('edit')}
                  </Button>
                  <Button
                    variant="danger-secondary"
                    onClick={() => setConfirmArchive(true)}
                    icon={<Icon name="box" size={16} />}
                  >
                    {tc('archive')}
                  </Button>
                </>
              )}
            </>
          ) : undefined
        }
      />

      <div className="stack">
        <section className="panel">
          <div className="panel__header">
            <h2 className="panel__title">{t('basicInfo')}</h2>
            <Badge
              tone={
                product.status === 'active'
                  ? 'success'
                  : product.status === 'draft'
                    ? 'neutral'
                    : 'warning'
              }
            >
              {product.status === 'active'
                ? t('statusActive')
                : product.status === 'draft'
                  ? t('statusDraft')
                  : t('statusArchived')}
            </Badge>
          </div>
          <div className="panel__body">
            <dl className="detail-list">
              <dt>{t('code')}</dt>
              <dd className="num" translate="no">
                {product.code}
              </dd>
              <dt>{t('basePrice')}</dt>
              <dd className="num">{formatMoney(product.basePrice, product.currency, locale)}</dd>
              <dt>{tc('description')}</dt>
              <dd dir="auto">{product.description ?? '—'}</dd>
              <dt>{tc('createdAt')}</dt>
              <dd>{formatDateTime(product.createdAt, locale)}</dd>
              <dt>{tc('updatedAt')}</dt>
              <dd>{formatDateTime(product.updatedAt, locale)}</dd>
            </dl>
            {Object.keys(product.customAttributes).length > 0 ? (
              <>
                <h3 style={{ marginBlock: '16px 8px' }}>{t('attributesSection')}</h3>
                <dl className="detail-list">
                  {Object.entries(product.customAttributes).map(([key, value]) => (
                    <div key={key} style={{ display: 'contents' }}>
                      <dt>{attributeLabels.get(key) ?? key}</dt>
                      <dd dir="auto">{String(value)}</dd>
                    </div>
                  ))}
                </dl>
              </>
            ) : null}
          </div>
        </section>

        <section className="panel">
          <div className="panel__header">
            <h2 className="panel__title">{t('variantsSection')}</h2>
          </div>
          {product.variants.length === 0 ? (
            <div className="panel__body">
              <p className="meta-text">{t('noVariants')}</p>
            </div>
          ) : (
            <div className="panel__body panel__body--flush">
              <TableWrap>
                <DataTable
                  head={
                    <>
                      <Th>{t('sku')}</Th> <Th>{t('variantName')}</Th>{' '}
                      <Th>{t('attributesSection')}</Th> <Th numeric>{t('priceOverride')}</Th>{' '}
                      <Th>{tc('status')}</Th>
                    </>
                  }
                >
                  {product.variants.map((variant) => (
                    <tr key={variant.id}>
                      <Td>
                        <span className="num" translate="no">
                          {variant.sku}
                        </span>
                      </Td>
                      <Td ellipsis>{variant.name ?? '—'}</Td>
                      <Td ellipsis>
                        <span className="cell-sub" dir="auto">
                          {Object.entries(variant.attributes)
                            .map(([k, v]) => `${attributeLabels.get(k) ?? k}: ${String(v)}`)
                            .join(' · ') || '—'}
                        </span>
                      </Td>
                      <Td numeric>
                        {variant.priceOverride
                          ? formatMoney(variant.priceOverride, product.currency, locale)
                          : '—'}
                      </Td>
                      <Td>
                        <Badge tone={variant.status === 'active' ? 'success' : 'neutral'}>
                          {variant.status === 'active' ? t('statusActive') : t('statusArchived')}
                        </Badge>
                      </Td>
                    </tr>
                  ))}
                </DataTable>
              </TableWrap>
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel__header">
            <h2 className="panel__title">{t('mediaSection')}</h2>
            {canWrite ? (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept={ACCEPTED_TYPES.join(',')}
                  className="visually-hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void uploadFile(file);
                    e.target.value = '';
                  }}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  loading={uploading}
                  onClick={() => fileRef.current?.click()}
                  icon={<Icon name="upload" size={15} />}
                >
                  {tc('add')}
                </Button>
              </>
            ) : null}
          </div>
          <div className="panel__body">
            {uploadError ? <InlineAlert kind="error">{uploadError}</InlineAlert> : null}
            {product.media.length === 0 ? (
              <p className="meta-text">{t('noMedia')}</p>
            ) : (
              <ul style={{ display: 'grid', gap: 8 }}>
                {product.media.map((media) => (
                  <li key={media.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Icon name="image" size={18} />
                    <span dir="auto" style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                      {media.originalFilename}
                    </span>
                    <Badge
                      tone={
                        media.status === 'ready'
                          ? 'success'
                          : media.status === 'pending'
                            ? 'warning'
                            : 'danger'
                      }
                    >
                      {media.status === 'ready'
                        ? t('mediaReady')
                        : media.status === 'pending'
                          ? t('mediaPending')
                          : t('mediaFailed')}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={confirmPublish}
        onClose={() => setConfirmPublish(false)}
        onConfirm={publish}
        title={t('publishTitle')}
        body={t('publishBody', { name: product.name })}
        confirmLabel={t('publishConfirm')}
      />
      <ConfirmDialog
        open={confirmArchive}
        onClose={() => setConfirmArchive(false)}
        onConfirm={archive}
        title={t('archiveTitle')}
        body={t('archiveBody', { name: product.name })}
        confirmLabel={t('archiveConfirm')}
        danger
      />
      <ConfirmDialog
        open={confirmRestore}
        onClose={() => setConfirmRestore(false)}
        onConfirm={restore}
        title={t('restoreTitle')}
        body={t('restoreBody', { name: product.name })}
        confirmLabel={t('restore')}
      />
    </>
  );
}
