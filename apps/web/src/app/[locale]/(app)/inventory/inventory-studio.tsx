'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useApi, useStore, useTenantPath } from '../../../../components/providers';
import { useAsyncData } from '../../../../lib/use-async-data';
import { useQueryState } from '../../../../lib/use-query-state';
import { formatDateTime, formatNumber } from '../../../../lib/format';
import type {
  InventoryBalanceView,
  InventoryLocationView,
  InventoryMovementView,
  ProductView,
  StockReservationView,
} from '../../../../lib/api/types';
import { Link } from '../../../../i18n/navigation';
import { Tabs } from '../../../../components/ui/tabs';
import { PageHeader } from '../../../../components/ui/page-header';
import { Button } from '../../../../components/ui/button';
import { Select } from '../../../../components/ui/select';
import { Checkbox } from '../../../../components/ui/checkbox';
import { Badge, type BadgeTone } from '../../../../components/ui/badge';
import { DataTable, TableWrap, Td, Th } from '../../../../components/ui/data-table';
import { EmptyState } from '../../../../components/ui/empty-state';
import { ErrorState } from '../../../../components/ui/error-state';
import { Skeleton } from '../../../../components/ui/skeleton';
import { Dialog } from '../../../../components/ui/dialog';
import { FormField } from '../../../../components/ui/form-field';
import { Input } from '../../../../components/ui/input';
import { InlineAlert } from '../../../../components/ui/alert';
import { Icon } from '../../../../components/icons';
import { IconButton } from '../../../../components/ui/icon-button';
import { useToast } from '../../../../components/ui/toast';

const movementTone: Record<string, BadgeTone> = {
  receive: 'success',
  return: 'success',
  adjust: 'warning',
  reserve: 'info',
  release: 'neutral',
  sell: 'accent',
};

const reservationTone: Record<string, BadgeTone> = {
  active: 'info',
  released: 'neutral',
  committed: 'success',
  expired: 'warning',
};

interface VariantOption {
  variantId: string;
  label: string;
}

export function InventoryStudio() {
  const t = useTranslations('inventory');
  const tc = useTranslations('common');
  const locale = useLocale();
  const api = useApi();
  const tenant = useTenantPath();
  const store = useStore();
  const canWrite = store.role !== 'agent';
  const searchParams = useSearchParams();
  const { setParams } = useQueryState();
  const tab = searchParams.get('tab') ?? 'balances';
  const locationFilter = searchParams.get('location') ?? '';
  const lowOnly = searchParams.get('low') === '1';

  const [receiveOpen, setReceiveOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [reorderTarget, setReorderTarget] = useState<InventoryBalanceView | null>(null);

  const locationsQuery = useAsyncData<InventoryLocationView[]>(
    (signal) => api.get(tenant('/inventory/locations'), { signal }),
    [api, tenant],
  );

  const balancesQuery = useAsyncData<InventoryBalanceView[]>(
    (signal) => {
      const params = new URLSearchParams({ limit: '200' });
      if (locationFilter) params.set('locationId', locationFilter);
      if (lowOnly) params.set('lowStock', 'true');
      return api.get(tenant(`/inventory/balances?${params.toString()}`), { signal });
    },
    [api, tenant, locationFilter, lowOnly],
  );

  const movementsQuery = useAsyncData<InventoryMovementView[]>(
    (signal) => api.get(tenant('/inventory/movements?limit=200'), { signal }),
    [api, tenant],
  );

  const reservationsQuery = useAsyncData<StockReservationView[]>(
    (signal) => api.get(tenant('/inventory/reservations?limit=200'), { signal }),
    [api, tenant],
  );

  const productsQuery = useAsyncData<ProductView[]>(
    (signal) => api.get(tenant('/products?limit=100'), { signal }),
    [api, tenant],
  );

  const variantOptions = useMemo<VariantOption[]>(() => {
    const options: VariantOption[] = [];
    for (const product of productsQuery.data ?? []) {
      for (const variant of product.variants) {
        if (variant.status !== 'active') continue;
        options.push({
          variantId: variant.id,
          label: `${product.name} — ${variant.name ?? variant.sku} (${variant.sku})`,
        });
      }
    }
    return options;
  }, [productsQuery.data]);

  function reloadAll() {
    balancesQuery.reload();
    movementsQuery.reload();
    reservationsQuery.reload();
  }

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          canWrite ? (
            <>
              <Button
                variant="secondary"
                onClick={() => setLocationOpen(true)}
                icon={<Icon name="plus" size={16} />}
              >
                {t('addLocation')}
              </Button>
              <Button
                variant="secondary"
                onClick={() => setAdjustOpen(true)}
                icon={<Icon name="pencil" size={16} />}
              >
                {t('adjustStock')}
              </Button>
              <Button onClick={() => setReceiveOpen(true)} icon={<Icon name="plus" size={16} />}>
                {t('receiveStock')}
              </Button>
            </>
          ) : undefined
        }
      />

      <Tabs
        active={tab}
        items={[
          { id: 'balances', label: t('balances') },
          { id: 'movements', label: t('movements') },
          { id: 'reservations', label: t('reservations') },
          { id: 'locations', label: t('locations') },
        ]}
      />

      {tab === 'balances' ? (
        <>
          <div className="filter-bar">
            <Select
              aria-label={t('colLocation')}
              value={locationFilter}
              onChange={(e) => setParams({ location: e.target.value || null })}
            >
              <option value="">{t('allLocations')}</option>
              {(locationsQuery.data ?? []).map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name} ({location.code})
                </option>
              ))}
            </Select>
            <Checkbox
              label={t('lowStockOnly')}
              checked={lowOnly}
              onChange={(e) => setParams({ low: e.target.checked ? '1' : null })}
            />
          </div>

          {balancesQuery.loading ? (
            <div className="panel">
              <div className="panel__body">
                <Skeleton lines={6} height={18} />
              </div>
            </div>
          ) : balancesQuery.error ? (
            <ErrorState onRetry={balancesQuery.reload} />
          ) : (balancesQuery.data ?? []).length === 0 ? (
            <div className="panel">
              <EmptyState
                icon="box"
                title={t('emptyTitle')}
                body={t('emptyBody')}
                action={
                  canWrite ? (
                    <Button
                      onClick={() => setReceiveOpen(true)}
                      icon={<Icon name="plus" size={16} />}
                    >
                      {t('receiveStock')}
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <TableWrap>
              <DataTable
                caption={t('balances')}
                head={
                  <>
                    <Th>{t('colProduct')}</Th> <Th>{t('colLocation')}</Th>{' '}
                    <Th numeric>{t('colOnHand')}</Th> <Th numeric>{t('colReserved')}</Th>{' '}
                    <Th numeric>{t('colAvailable')}</Th> <Th numeric>{t('colReorderPoint')}</Th>{' '}
                    <Th>{t('colState')}</Th> <Th>{tc('lastUpdated')}</Th>
                  </>
                }
              >
                {canWrite ? (
                  <Th>
                    <span className="visually-hidden">{tc('actions')}</span>
                  </Th>
                ) : null}
                {(balancesQuery.data ?? []).map((balance) => (
                  <tr key={`${balance.locationId}-${balance.variantId}`}>
                    <Td ellipsis>
                      <Link href={`/products/${balance.productId}`} className="row-link">
                        <span className="cell-main" dir="auto">
                          {balance.productName}
                        </span>
                        {balance.variantName ? (
                          <span className="cell-sub" dir="auto">
                            {' '}
                            {balance.variantName}
                          </span>
                        ) : null}
                      </Link>
                      <span className="cell-sub num" translate="no">
                        {balance.sku}
                      </span>
                    </Td>
                    <Td>{balance.locationName}</Td>
                    <Td numeric>{formatNumber(balance.onHand, locale)}</Td>
                    <Td numeric>{formatNumber(balance.reserved, locale)}</Td>
                    <Td numeric>
                      <strong>{formatNumber(balance.available, locale)}</strong>
                    </Td>
                    <Td numeric>{formatNumber(balance.reorderPoint, locale)}</Td>
                    <Td>
                      {balance.available <= 0 ? (
                        <Badge tone="danger">{t('outOfStockBadge')}</Badge>
                      ) : balance.lowStock ? (
                        <Badge tone="warning">{t('lowStockBadge')}</Badge>
                      ) : (
                        <Badge tone="success">{t('okBadge')}</Badge>
                      )}
                    </Td>
                    <Td>
                      <span className="cell-sub">{formatDateTime(balance.updatedAt, locale)}</span>
                    </Td>
                    {canWrite ? (
                      <Td>
                        <IconButton
                          icon="pencil"
                          size="sm"
                          label={t('setReorder')}
                          onClick={() => setReorderTarget(balance)}
                        />
                      </Td>
                    ) : null}
                  </tr>
                ))}
              </DataTable>
            </TableWrap>
          )}
        </>
      ) : null}

      {tab === 'movements' ? (
        movementsQuery.loading ? (
          <div className="panel">
            <div className="panel__body">
              <Skeleton lines={6} height={18} />
            </div>
          </div>
        ) : movementsQuery.error ? (
          <ErrorState onRetry={movementsQuery.reload} />
        ) : (movementsQuery.data ?? []).length === 0 ? (
          <div className="panel">
            <EmptyState icon="box" title={t('movementsEmpty')} />
          </div>
        ) : (
          <TableWrap>
            <DataTable
              caption={t('movements')}
              head={
                <>
                  <Th>{t('colType')}</Th> <Th numeric>{t('colQty')}</Th>{' '}
                  <Th numeric>{t('colOnHand')}</Th> <Th numeric>{t('colReserved')}</Th>{' '}
                  <Th>{t('colReason')}</Th> <Th>{t('colDate')}</Th>
                </>
              }
            >
              {(movementsQuery.data ?? []).map((movement) => (
                <tr key={movement.id}>
                  <Td>
                    <Badge tone={movementTone[movement.type] ?? 'neutral'}>
                      {t(
                        `movement${movement.type === 'receive' ? 'Receive' : movement.type === 'adjust' ? 'Adjust' : movement.type === 'reserve' ? 'Reserve' : movement.type === 'release' ? 'Release' : movement.type === 'sell' ? 'Sell' : 'Return'}`,
                      )}
                    </Badge>
                  </Td>
                  <Td numeric>{formatNumber(movement.quantity, locale)}</Td>
                  <Td numeric>
                    {movement.onHandDelta > 0 ? '+' : ''}
                    {formatNumber(movement.onHandDelta, locale)} →{' '}
                    {formatNumber(movement.onHandAfter, locale)}
                  </Td>
                  <Td numeric>{formatNumber(movement.reservedAfter, locale)}</Td>
                  <Td ellipsis>
                    <span dir="auto">{movement.reason ?? '—'}</span>
                  </Td>
                  <Td>
                    <span className="cell-sub">{formatDateTime(movement.createdAt, locale)}</span>
                  </Td>
                </tr>
              ))}
            </DataTable>
          </TableWrap>
        )
      ) : null}

      {tab === 'reservations' ? (
        reservationsQuery.loading ? (
          <div className="panel">
            <div className="panel__body">
              <Skeleton lines={6} height={18} />
            </div>
          </div>
        ) : reservationsQuery.error ? (
          <ErrorState onRetry={reservationsQuery.reload} />
        ) : (reservationsQuery.data ?? []).length === 0 ? (
          <div className="panel">
            <EmptyState icon="box" title={t('reservationsEmpty')} />
          </div>
        ) : (
          <TableWrap>
            <DataTable
              caption={t('reservations')}
              head={
                <>
                  <Th>SKU</Th> <Th numeric>{t('colQty')}</Th> <Th>{tc('status')}</Th>{' '}
                  <Th>{t('colDate')}</Th>
                </>
              }
            >
              {(reservationsQuery.data ?? []).map((reservation) => (
                <tr key={reservation.id}>
                  <Td>
                    <span className="num" translate="no">
                      {reservation.sku}
                    </span>
                  </Td>
                  <Td numeric>{formatNumber(reservation.quantity, locale)}</Td>
                  <Td>
                    <Badge tone={reservationTone[reservation.status] ?? 'neutral'}>
                      {t(
                        `reservation${reservation.status === 'active' ? 'Active' : reservation.status === 'released' ? 'Released' : reservation.status === 'committed' ? 'Committed' : 'Expired'}`,
                      )}
                    </Badge>
                  </Td>
                  <Td>
                    <span className="cell-sub">
                      {formatDateTime(reservation.createdAt, locale)}
                    </span>
                  </Td>
                </tr>
              ))}
            </DataTable>
          </TableWrap>
        )
      ) : null}

      {tab === 'locations' ? (
        locationsQuery.loading ? (
          <div className="panel">
            <div className="panel__body">
              <Skeleton lines={4} height={18} />
            </div>
          </div>
        ) : locationsQuery.error ? (
          <ErrorState onRetry={locationsQuery.reload} />
        ) : (
          <TableWrap>
            <DataTable
              caption={t('locations')}
              head={
                <>
                  <Th>{t('locationCode')}</Th> <Th>{t('locationName')}</Th> <Th>{tc('status')}</Th>
                </>
              }
            >
              {(locationsQuery.data ?? []).map((location) => (
                <tr key={location.id}>
                  <Td>
                    <span className="num" translate="no">
                      {location.code}
                    </span>
                  </Td>
                  <Td>
                    {location.name}
                    {location.isDefault ? (
                      <>
                        {' '}
                        <Badge tone="accent">{t('defaultLocation')}</Badge>
                      </>
                    ) : null}
                  </Td>
                  <Td>
                    <Badge tone={location.status === 'active' ? 'success' : 'neutral'}>
                      {location.status === 'active' ? t('okBadge') : tc('archive')}
                    </Badge>
                  </Td>
                </tr>
              ))}
            </DataTable>
          </TableWrap>
        )
      ) : null}

      <StockMutationDialog
        kind="receive"
        open={receiveOpen}
        onClose={() => setReceiveOpen(false)}
        onDone={reloadAll}
        locations={locationsQuery.data ?? []}
        variants={variantOptions}
      />
      <StockMutationDialog
        kind="adjust"
        open={adjustOpen}
        onClose={() => setAdjustOpen(false)}
        onDone={reloadAll}
        locations={locationsQuery.data ?? []}
        variants={variantOptions}
      />
      <LocationDialog
        open={locationOpen}
        onClose={() => setLocationOpen(false)}
        onDone={() => locationsQuery.reload()}
      />
      <ReorderDialog
        target={reorderTarget}
        onClose={() => setReorderTarget(null)}
        onDone={() => balancesQuery.reload()}
      />
    </>
  );
}

function StockMutationDialog({
  kind,
  open,
  onClose,
  onDone,
  locations,
  variants,
}: {
  kind: 'receive' | 'adjust';
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  locations: InventoryLocationView[];
  variants: VariantOption[];
}) {
  const t = useTranslations('inventory');
  const tc = useTranslations('common');
  const api = useApi();
  const tenant = useTenantPath();
  const { toast } = useToast();
  const [locationId, setLocationId] = useState('');
  const [variantId, setVariantId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const activeLocations = locations.filter((location) => location.status === 'active');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      const qty = Number(quantity);
      if (kind === 'receive') {
        await api.post(tenant('/inventory/receive'), {
          locationId,
          variantId,
          quantity: qty,
          reason: reason.trim() || undefined,
          idempotencyKey: crypto.randomUUID(),
        });
        toast(t('received'), 'success');
      } else {
        await api.post(tenant('/inventory/adjust'), {
          locationId,
          variantId,
          quantityDelta: qty,
          reason: reason.trim(),
          idempotencyKey: crypto.randomUUID(),
        });
        toast(t('adjusted'), 'success');
      }
      onClose();
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : tc('errorBody'));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={kind === 'receive' ? t('receiveTitle') : t('adjustTitle')}
    >
      {error ? <InlineAlert kind="error">{error}</InlineAlert> : null}
      <form onSubmit={submit} className="stack mt-4">
        <FormField label={t('location')} required>
          <Select value={locationId} onChange={(e) => setLocationId(e.target.value)} required>
            <option value="">{t('selectLocation')}</option>
            {activeLocations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name} ({location.code})
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={t('selectVariant')} required>
          <Select value={variantId} onChange={(e) => setVariantId(e.target.value)} required>
            <option value="">—</option>
            {variants.map((variant) => (
              <option key={variant.variantId} value={variant.variantId}>
                {variant.label}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField
          label={kind === 'receive' ? t('colQty') : t('quantityDeltaLabel')}
          required
          hint={t('quantityHint')}
        >
          <Input
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            required
            min={kind === 'receive' ? 1 : undefined}
            step={1}
            dir="ltr"
            style={{ textAlign: 'end' }}
          />
        </FormField>
        <FormField label={t('reason')} hint={t('reasonHint')} required={kind === 'adjust'}>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            required={kind === 'adjust'}
            minLength={kind === 'adjust' ? 3 : undefined}
          />
        </FormField>
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
            {tc('cancel')}
          </Button>
          <Button type="submit" loading={pending}>
            {kind === 'receive' ? t('submitReceive') : t('submitAdjust')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function LocationDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('inventory');
  const tc = useTranslations('common');
  const api = useApi();
  const tenant = useTenantPath();
  const { toast } = useToast();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      await api.post(tenant('/inventory/locations'), {
        code: code.trim(),
        name: name.trim(),
        isDefault,
      });
      toast(t('locationCreated'), 'success');
      onClose();
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : tc('errorBody'));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t('addLocation')}>
      {error ? <InlineAlert kind="error">{error}</InlineAlert> : null}
      <form onSubmit={submit} className="stack mt-4">
        <FormField label={t('locationCode')} required>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            maxLength={32}
            dir="ltr"
            style={{ textAlign: 'start' }}
          />
        </FormField>
        <FormField label={t('locationName')} required>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            minLength={2}
            maxLength={120}
          />
        </FormField>
        <Checkbox
          label={t('defaultLocation')}
          checked={isDefault}
          onChange={(e) => setIsDefault(e.target.checked)}
        />
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
            {tc('cancel')}
          </Button>
          <Button type="submit" loading={pending}>
            {t('addLocation')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ReorderDialog({
  target,
  onClose,
  onDone,
}: {
  target: InventoryBalanceView | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('inventory');
  const tc = useTranslations('common');
  const api = useApi();
  const tenant = useTenantPath();
  const { toast } = useToast();
  const [value, setValue] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (target) setValue(String(target.reorderPoint));
  }, [target]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target || pending) return;
    setPending(true);
    setError(null);
    try {
      await api.put(tenant('/inventory/balances/reorder-point'), {
        locationId: target.locationId,
        variantId: target.variantId,
        reorderPoint: Number(value),
      });
      toast(t('reorderUpdated'), 'success');
      onClose();
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : tc('errorBody'));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={target !== null} onClose={onClose} title={t('setReorder')}>
      {target ? (
        <p className="meta-text" dir="auto">
          {target.productName} — {target.locationName}
        </p>
      ) : null}
      {error ? <InlineAlert kind="error">{error}</InlineAlert> : null}
      <form onSubmit={submit} className="stack mt-4">
        <FormField label={t('colReorderPoint')} required>
          <Input
            type="number"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            min={0}
            step={1}
            required
            dir="ltr"
            style={{ textAlign: 'end' }}
          />
        </FormField>
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
            {tc('cancel')}
          </Button>
          <Button type="submit" loading={pending}>
            {t('setReorder')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
