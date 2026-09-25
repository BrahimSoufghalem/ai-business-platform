'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from './button';
import { Dialog } from './dialog';

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}

export function ConfirmDialog({ open, onClose, onConfirm, title, body, confirmLabel, danger }: ConfirmDialogProps) {
  const t = useTranslations('common');
  const [pending, setPending] = useState(false);

  async function handleConfirm() {
    setPending(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <div className="dialog__body">{body}</div>
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
