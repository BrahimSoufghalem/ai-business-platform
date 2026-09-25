'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useApi, useTenantPath } from '../../../../components/providers';
import { useAsyncData } from '../../../../lib/use-async-data';
import { useQueryState } from '../../../../lib/use-query-state';
import { formatMoney, formatRelativeTime } from '../../../../lib/format';
import type { OrderStatus, OrderView } from '../../../../lib/api/types';
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

const PAGE_SIZE = 20;

export const orderStatusTone: Record<OrderStatus, BadgeTone> = {
  new: 'info',
  confirmed: 'accent',
  preparing: 'warning',
  shipped: 'accent',
  delivered: 'success',
  cancelled: 'neutral',
};

export const orderStatusKey: Record<OrderStatus, string> = {
  new: 'statusNew',
  confirmed: 'statusConfirmed',
  preparing: 'statusPreparing',
  shipped: 'statusShipped',
  delivered: 'statusDelivered',
  cancelled: 'statusCancelled',
};

export function OrdersTable() {
  const t = useTranslations('orders');
  const tc = useTranslations('common');
  const locale = useLocale();
  const api = useApi();
  const tenant = useTenantPath();
  const { searchParams, setParams } = useQueryState();

  const q = searchParams.get('q') ?? '';
  const status = searchParams.get('status') ?? '';
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const [searchInput, setSearchInput] = useState(q);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ limit: '100' });
    if (q) params.set('q', q);
    if (status) params.set('status', status);
    return params.toString();
  }, [q, status]);

  const query = useAsyncData<OrderView[]>((signal) => api.get(tenant(`/orders?${queryString}`), { signal }), [api, queryString, tenant]);

  const paged = useMemo(() => {
    const all = query.data ?? [];
    const start = (page - 1) * PAGE_SIZE;
    return { rows: all.slice(start, start + PAGE_SIZE), total: all.length };
  }, [query.data, page]);

  const statuses: OrderStatus[] = ['new', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled'];

  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} count={query.data?.length} />

      <div className="filter-bar" role="search">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setParams({ q: searchInput || null, page: null });
          }}
          style={{ display: 'contents' }}
        >
          <SearchInput
            placeholder={t('searchPlaceholder')}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label={t('searchPlaceholder')}
          />
        </form>
        <Select aria-label={t('colStatus')} value={status} onChange={(e) => setParams({ status: e.target.value || null, page: null })}>
          <option value="">{tc('all')}</option>
          {statuses.map((value) => (
            <option key={value} value={value}>
              {t(orderStatusKey[value])}
            </option>
          ))}
        </Select>
      </div>

      {query.loading ? (
        <div className="panel"><div className="panel__body"><Skeleton lines={6} height={18} /></div></div>
      ) : query.error ? (
        <ErrorState onRetry={query.reload} />
      ) : paged.total === 0 ? (
        <div className="panel">
          {q || status ? (
            <EmptyState icon="search" title={tc('noResults')} body={tc('noResultsBody')} />
          ) : (
            <EmptyState icon="shopping-bag" title={t('emptyTitle')} body={t('emptyBody')} />
          )}
        </div>
      ) : (
        <>
          <TableWrap>
            <DataTable caption={t('title')} head={<><Th>{t('colNumber')}</Th> <Th>{t('colCustomer')}</Th> <Th>{t('colStatus')}</Th> <Th numeric>{t('colItems')}</Th> <Th numeric>{t('colTotal')}</Th> <Th>{t('colCreated')}</Th></>}>{paged.rows.map((order) => (
                <tr key={order.id}>
                  <Td>
                    <Link href={`/orders/${order.id}`} className="row-link">
                      <span className="cell-main num" translate="no">{order.number}</span>
                    </Link>
                  </Td>
                  <Td ellipsis>
                    <span dir="auto">{order.customerName}</span>
                  </Td>
                  <Td>
                    <Badge tone={orderStatusTone[order.status]}>{t(orderStatusKey[order.status])}</Badge>
                  </Td>
                  <Td numeric>{order.items.length}</Td>
                  <Td numeric>{formatMoney(order.total, order.currency, locale)}</Td>
                  <Td>
                    <span className="cell-sub">{formatRelativeTime(order.createdAt, locale)}</span>
                  </Td>
                </tr>
              ))}
            </DataTable>
          </TableWrap>
          <Pagination page={page} pageSize={PAGE_SIZE} total={paged.total} onPageChange={(next) => setParams({ page: next > 1 ? String(next) : null })} />
        </>
      )}
    </>
  );
}
