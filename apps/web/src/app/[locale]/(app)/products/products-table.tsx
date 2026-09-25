'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useApi, useStore, useTenantPath } from '../../../../components/providers';
import { useAsyncData } from '../../../../lib/use-async-data';
import { useQueryState } from '../../../../lib/use-query-state';
import { useRouter } from 'next/navigation';
import { formatMoney, formatRelativeTime } from '../../../../lib/format';
import type { ProductTypeView, ProductView } from '../../../../lib/api/types';
import { Link } from '../../../../i18n/navigation';
import { SearchInput } from '../../../../components/ui/search-input';
import { Select } from '../../../../components/ui/select';
import { Badge, type BadgeTone } from '../../../../components/ui/badge';
import { DataTable, TableWrap, Td, Th } from '../../../../components/ui/data-table';
import { Pagination } from '../../../../components/ui/pagination';
import { PageHeader } from '../../../../components/ui/page-header';
import { EmptyState } from '../../../../components/ui/empty-state';
import { ErrorState } from '../../../../components/ui/error-state';
import { Skeleton } from '../../../../components/ui/skeleton';
import {
  MoreActionsDropdown,
  DropdownItem,
  DropdownSeparator,
} from '../../../../components/ui/dropdown';
import { ConfirmDialog } from '../../../../components/ui/confirm-dialog';
import { Icon } from '../../../../components/icons';
import { useToast } from '../../../../components/ui/toast';

const PAGE_SIZE = 20;

const statusTone: Record<string, BadgeTone> = {
  draft: 'neutral',
  active: 'success',
  archived: 'neutral',
};

export function ProductsTable() {
  const t = useTranslations('products');
  const tc = useTranslations('common');
  const locale = useLocale();
  const api = useApi();
  const tenant = useTenantPath();
  const store = useStore();
  const canWrite = store.role !== 'agent';
  const { toast } = useToast();
  const router = useRouter();
  const { searchParams, setParams } = useQueryState();

  const q = searchParams.get('q') ?? '';
  const status = searchParams.get('status') ?? '';
  const typeId = searchParams.get('type') ?? '';
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);

  const [searchInput, setSearchInput] = useState(q);
  const [pendingDelete, setPendingDelete] = useState<ProductView | null>(null);
  const [pendingPublish, setPendingPublish] = useState<ProductView | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ limit: '100' });
    if (q) params.set('q', q);
    if (status) params.set('status', status);
    if (typeId) params.set('productTypeId', typeId);
    return params.toString();
  }, [q, status, typeId]);

  const productsQuery = useAsyncData<ProductView[]>(
    (signal) => api.get(tenant(`/products?${queryString}`), { signal }),
    [api, queryString, tenant],
  );

  const typesQuery = useAsyncData<ProductTypeView[]>(
    (signal) => api.get(tenant('/product-types'), { signal }),
    [api, tenant],
  );

  const typeNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const type of typesQuery.data ?? []) map.set(type.id, type.name);
    return map;
  }, [typesQuery.data]);

  const paged = useMemo(() => {
    const all = productsQuery.data ?? [];
    const start = (page - 1) * PAGE_SIZE;
    return { rows: all.slice(start, start + PAGE_SIZE), total: all.length };
  }, [productsQuery.data, page]);

  function submitSearch(event: React.FormEvent) {
    event.preventDefault();
    setParams({ q: searchInput || null, page: null });
  }

  async function publishProduct(product: ProductView) {
    await api.post(tenant(`/products/${product.id}/publish`), {});
    toast(t('published'), 'success');
    productsQuery.reload();
  }

  async function deleteProduct(product: ProductView) {
    await api.delete(tenant(`/products/${product.id}`));
    toast(t('deleted'), 'success');
    productsQuery.reload();
  }

  function apiErrorMessage(error: string): string {
    return error === 'network' ? tc('connectionError') : error;
  }

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        count={productsQuery.data?.length}
        actions={
          canWrite ? (
            <Link href="/products/new" className="btn btn--primary">
              <Icon name="plus" size={16} />
              {t('addProduct')}
            </Link>
          ) : undefined
        }
      />

      <div className="filter-bar" role="search">
        <form onSubmit={submitSearch} style={{ display: 'contents' }}>
          <SearchInput
            placeholder={t('searchPlaceholder')}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onBlur={() => searchInput !== q && setParams({ q: searchInput || null, page: null })}
            aria-label={t('searchPlaceholder')}
          />
        </form>
        <Select
          aria-label={t('statusFilter')}
          value={status}
          onChange={(e) => setParams({ status: e.target.value || null, page: null })}
        >
          <option value="">{t('allStatuses')}</option>
          <option value="draft">{t('statusDraft')}</option>
          <option value="active">{t('statusActive')}</option>
          <option value="archived">{t('statusArchived')}</option>
        </Select>
        <Select
          aria-label={t('typeFilter')}
          value={typeId}
          onChange={(e) => setParams({ type: e.target.value || null, page: null })}
        >
          <option value="">{t('allTypes')}</option>
          {(typesQuery.data ?? []).map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
            </option>
          ))}
        </Select>
      </div>

      {productsQuery.loading ? (
        <div className="panel">
          <div className="panel__body">
            <Skeleton lines={6} height={18} />
          </div>
        </div>
      ) : productsQuery.error ? (
        <ErrorState body={apiErrorMessage(productsQuery.error)} onRetry={productsQuery.reload} />
      ) : paged.total === 0 ? (
        <div className="panel">
          {q || status || typeId ? (
            <EmptyState icon="search" title={tc('noResults')} body={tc('noResultsBody')} />
          ) : (
            <EmptyState
              icon="package"
              title={t('emptyTitle')}
              body={t('emptyBody')}
              action={
                canWrite ? (
                  <Link href="/products/new" className="btn btn--primary">
                    <Icon name="plus" size={16} />
                    {t('addProduct')}
                  </Link>
                ) : undefined
              }
            />
          )}
        </div>
      ) : (
        <>
          <TableWrap>
            <DataTable
              caption={t('title')}
              head={
                <>
                  <Th>{t('colProduct')}</Th> <Th>{t('colSku')}</Th> <Th>{t('colType')}</Th>{' '}
                  <Th numeric>{t('colVariants')}</Th> <Th numeric>{t('colPrice')}</Th>{' '}
                  <Th>{t('colStatus')}</Th> <Th>{t('colUpdated')}</Th>{' '}
                  <Th>
                    <span className="visually-hidden">{tc('actions')}</span>
                  </Th>
                </>
              }
            >
              {paged.rows.map((product) => (
                <tr key={product.id}>
                  <Td ellipsis>
                    <Link href={`/products/${product.id}`} className="row-link">
                      <span className="cell-main">{product.name}</span>
                      {product.media.length > 0 ? (
                        <span className="cell-sub">
                          {' '}
                          {t('mediaCount', { count: product.media.length })}
                        </span>
                      ) : null}
                    </Link>
                  </Td>
                  <Td>
                    <span translate="no" className="num">
                      {product.code}
                    </span>
                  </Td>
                  <Td>
                    <span className="cell-sub">{typeNames.get(product.productTypeId) ?? '—'}</span>
                  </Td>
                  <Td numeric>{product.variants.length > 0 ? product.variants.length : '—'}</Td>
                  <Td numeric>{formatMoney(product.basePrice, product.currency, locale)}</Td>
                  <Td>
                    <Badge tone={statusTone[product.status] ?? 'neutral'}>
                      {t(
                        `status${product.status === 'active' ? 'Active' : product.status === 'draft' ? 'Draft' : 'Archived'}`,
                      )}
                    </Badge>
                  </Td>
                  <Td>
                    <span className="cell-sub">
                      {formatRelativeTime(product.updatedAt, locale)}
                    </span>
                  </Td>
                  <Td>
                    {canWrite ? (
                      <MoreActionsDropdown label={tc('actions')}>
                        <DropdownItem
                          icon="pencil"
                          onClick={() => router.push(`/${locale}/products/${product.id}`)}
                        >
                          {tc('edit')}
                        </DropdownItem>
                        {product.status !== 'active' ? (
                          <DropdownItem icon="check" onClick={() => setPendingPublish(product)}>
                            {tc('publish')}
                          </DropdownItem>
                        ) : null}
                        <DropdownSeparator />
                        <DropdownItem icon="trash" danger onClick={() => setPendingDelete(product)}>
                          {tc('delete')}
                        </DropdownItem>
                      </MoreActionsDropdown>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </DataTable>
          </TableWrap>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={paged.total}
            onPageChange={(next) => setParams({ page: next > 1 ? String(next) : null })}
          />
        </>
      )}

      <ConfirmDialog
        open={pendingPublish !== null}
        onClose={() => setPendingPublish(null)}
        onConfirm={async () => {
          if (pendingPublish) await publishProduct(pendingPublish);
        }}
        title={t('publishTitle')}
        body={pendingPublish ? t('publishBody', { name: pendingPublish.name }) : ''}
        confirmLabel={t('publishConfirm')}
      />
      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (pendingDelete) await deleteProduct(pendingDelete);
        }}
        title={t('deleteTitle')}
        body={pendingDelete ? t('deleteBody', { name: pendingDelete.name }) : ''}
        confirmLabel={t('deleteConfirm')}
        danger
      />
    </>
  );
}
