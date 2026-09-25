export function Skeleton({ height, width, lines = 0 }: { height?: number; width?: string; lines?: number }) {
  if (lines > 1) {
    return (
      <div role="status" aria-hidden="true" style={{ display: 'grid', gap: 10 }}>
        {Array.from({ length: lines }, (_, i) => (
          <div key={i} className="skeleton" style={{ height: height ?? 14, width: i === lines - 1 ? '60%' : '100%' }} />
        ))}
      </div>
    );
  }
  return <div className="skeleton" role="status" aria-hidden="true" style={{ height: height ?? 16, width: width ?? '100%' }} />;
}
