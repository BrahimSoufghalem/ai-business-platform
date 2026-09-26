'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from './button';
import { Dialog } from './dialog';
import { InlineAlert } from './alert';
import { ApiError } from '../../lib/api/client';

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel,
  danger,
}: ConfirmDialogProps) {
  const t = useTranslations('common');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  async function handleConfirm() {
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.status === 0
            ? t('connectionError')
            : caught.message
          : t('errorBody'),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <div className="dialog__body">{body}</div>
      {error ? <InlineAlert kind="error">{error}</InlineAlert> : null}
      <div className="dialog__actions">
        <Button variant="secondary" onClick={onClose} disabled={pending}>
          {t('cancel')}
        </Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={handleConfirm} loading={pending}>
          {confirmLabel ?? t('confirm')}
        </Button>
      </div>
    </Dialog>
  );
}
