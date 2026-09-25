'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useApi, useTenantPath } from '../../../../components/providers';
import type { CustomerView } from '../../../../lib/api/types';
import { Dialog } from '../../../../components/ui/dialog';
import { Button } from '../../../../components/ui/button';
import { FormField } from '../../../../components/ui/form-field';
import { Input } from '../../../../components/ui/input';
import { Select } from '../../../../components/ui/select';
import { InlineAlert } from '../../../../components/ui/alert';
import { useToast } from '../../../../components/ui/toast';

export function CustomerCreateDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (customer: CustomerView) => void;
}) {
  const t = useTranslations('customers');
  const tc = useTranslations('common');
  const api = useApi();
  const tenant = useTenantPath();
  const { toast } = useToast();

  const [name, setName] = useState('');
  const [contactType, setContactType] = useState<'phone' | 'email' | 'whatsapp' | 'instagram'>('phone');
  const [contactValue, setContactValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      const customer = await api.post<CustomerView>(tenant('/customers'), {
        name: name.trim(),
        contacts: [{ type: contactType, value: contactValue.trim(), isPrimary: true }],
      });
      toast(t('created'), 'success');
      setName('');
      setContactValue('');
      onClose();
      onCreated(customer);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : tc('errorBody'));
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t('addCustomer')}>
      {error ? <InlineAlert kind="error">{error}</InlineAlert> : null}
      <form onSubmit={submit} className="stack mt-4">
        <FormField label={tc('name')} required>
          <Input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={160} />
        </FormField>
        <div className="form-grid">
          <FormField label={t('contactInfo')} required>
            <Select value={contactType} onChange={(e) => setContactType(e.target.value as typeof contactType)}>
              <option value="phone">{t('contactTypes.phone')}</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="instagram">Instagram</option>
              <option value="email">{t('contactTypes.email')}</option>
            </Select>
          </FormField>
          <FormField label={t('contactValue')} required>
            <Input
              value={contactValue}
              onChange={(e) => setContactValue(e.target.value)}
              required
              dir="ltr"
              style={{ textAlign: 'start' }}
            />
          </FormField>
        </div>
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
            {tc('cancel')}
          </Button>
          <Button type="submit" loading={pending}>
            {t('addCustomer')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
