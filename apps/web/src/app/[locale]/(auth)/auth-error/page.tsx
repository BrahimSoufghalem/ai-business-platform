import { Suspense } from 'react';
import { AuthErrorContent } from './form';

export default function AuthErrorPage() {
  return (
    <Suspense>
      <AuthErrorContent />
    </Suspense>
  );
}
