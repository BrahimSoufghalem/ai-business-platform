/** Noxi brand lockup: accent mark plus the product wordmark. */
export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      N
    </span>
  );
}

export function BrandLockup() {
  return (
    <span className="brand-lockup">
      <BrandMark />
      <span translate="no">Noxi</span>
    </span>
  );
}
