'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useApi, useTenantPath } from '../../../../components/providers';
import { useAsyncData } from '../../../../lib/use-async-data';
import { useQueryState } from '../../../../lib/use-query-state';
import { formatDate } from '../../../../lib/format';
import type { CustomerSummaryView } from '../../../../lib/api/types';
import { Link } from '../../../../i18n/navigation';
import { SearchInput } from '../../../../components/ui/search-input';
import { Select } from '../../../../components/ui/select';
import { Badge } from '../../../../components/ui/badge';
import { DataTable, TableWrap, Td, Th } from '../../../../components/ui/data-table';
import { Pagination } from '../../../../components/ui/pagination';
import { PageHeader } from '../../../../components/ui/page-header';
import { EmptyState } from '../../../../components/ui/empty-state';
import { ErrorState } from '../../../../components/ui/error-state';
import { Skeleton } from '../../../../components/ui/skeleton';
import { Icon } from '../../../../components/icons';
import { CustomerCreateDialog } from './customer-create-dialog';
import { useStore } from '../../../../components/providers';

const PAGE_SIZE = 20;

export function CustomersTable() {
  const t = useTranslations('customers');
  const tc = useTranslations('common');
  const locale = useLocale();
  const api = useApi();
  const tenant = useTenantPath();
  const store = useStore();
  const canWrite = store.role !== 'agent' || true; // customers:manage granted to all roles
  const { searchParams, setParams } = useQueryState();
  const [createOpen, setCreateOpen] = useState(false);

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

  const query = useAsyncData<CustomerSummaryView[]>((signal) => api.get(tenant(`/customers?${queryString}`), { signal }), [api, queryString, tenant]);

  const paged = useMemo(() => {
    const all = query.data ?? [];
    const start = (page - 1) * PAGE_SIZE;
    return { rows: all.slice(start, start + PAGE_SIZE), total: all.length };
  }, [query.data, page]);

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        count={query.data?.length}
        actions={
          canWrite ? (
            <button type="button" className="btn btn--primary" onClick={() => setCreateOpen(true)}>
              <Icon name="plus" size={16} />
              {t('addCustomer')}
            </button>
          ) : undefined
        }
      />

      <div className="filter-bar" role="search">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setParams({ q: searchInput || null, page: null });
          }}
          style={{ display: 'contents' }}
        >
          <SearchInput placeholder={t('searchPlaceholder')} value={searchInput} onChange={(e) => setSearchInput(e.target.value)} aria-label={t('searchPlaceholder')} />
        </form>
        <Select aria-label={tc('status')} value={status} onChange={(e) => setParams({ status: e.target.value || null, page: null })}>
          <option value="">{tc('all')}</option>
          <option value="active">{t('statusActive')}</option>
          <option value="archived">{t('statusArchived')}</option>
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
            <EmptyState
              icon="users"
              title={t('emptyTitle')}
              body={t('emptyBody')}
              action={
                <button type="button" className="btn btn--primary" onClick={() => setCreateOpen(true)}>
                  <Icon name="plus" size={16} />
                  {t('addCustomer')}
                </button>
              }
            />
          )}
        </div>
      ) : (
        <>
          <TableWrap>
            <DataTable caption={t('title')} head={<><Th>{t('colName')}</Th> <Th>{t('colContact')}</Th> <Th numeric>{t('colOrders')}</Th> <Th numeric>{t('colConversations')}</Th> <Th>{t('colStatus')}</Th> <Th>{t('colAdded')}</Th></>}>{paged.rows.map((customer) => (
                <tr key={customer.id}>
                  <Td ellipsis>
                    <Link href={`/customers/${customer.id}`} className="row-link">
                      <span className="cell-main" dir="auto">{customer.name}</span>
                    </Link>
                  </Td>
                  <Td ellipsis>
                    <span className="cell-sub" dir="auto">
                      {customer.contacts[0] ? `${customer.contacts[0].type}: ${customer.contacts[0].maskedValue}` : '—'}
                    </span>
                  </Td>
                  <Td numeric>{customer.orderCount}</Td>
                  <Td numeric>{customer.conversationCount}</Td>
                  <Td>
                    <Badge tone={customer.status === 'active' ? 'success' : 'neutral'}>
                      {customer.status === 'active' ? t('statusActive') : t('statusArchived')}
                    </Badge>
                  </Td>
                  <Td>
                    <span className="cell-sub">{formatDate(customer.createdAt, locale)}</span>
                  </Td>
                </tr>
              ))}
            </DataTable>
          </TableWrap>
          <Pagination page={page} pageSize={PAGE_SIZE} total={paged.total} onPageChange={(next) => setParams({ page: next > 1 ? String(next) : null })} />
        </>
      )}

      <CustomerCreateDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => query.reload()} />
    </>
  );
}
