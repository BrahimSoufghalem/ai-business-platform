'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useCallback, type ReactNode } from 'react';

export interface TabItem {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
}

/** URL-synced tabs (query param) so tab state survives refresh and language switch. */
export function Tabs({ items, active, param = 'tab' }: { items: TabItem[]; active: string; param?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const select = useCallback(
    (id: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set(param, id);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams, param],
  );

  return (
    <div className="tabs" role="tablist">
      {items.map((item) => (
        <button
          key={item.id}
          role="tab"
          aria-selected={active === item.id}
          className="tabs__tab"
          onClick={() => select(item.id)}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  );
}
