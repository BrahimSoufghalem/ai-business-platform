import { Suspense } from 'react';
import { ConfirmEmailContent } from './form';

export default function ConfirmEmailPage() {
  return (
    <Suspense>
      <ConfirmEmailContent />
    </Suspense>
  );
}
