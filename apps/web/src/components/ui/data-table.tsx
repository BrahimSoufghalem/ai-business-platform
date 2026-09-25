import type { ReactNode } from 'react';

export function TableWrap({ children, label }: { children: ReactNode; label?: string | undefined }) {
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label={label}>
      {children}
    </div>
  );
}

export interface DataTableProps {
  caption?: string;
  head: ReactNode;
  children: ReactNode;
}

export function DataTable({ caption, head, children }: DataTableProps) {
  return (
    <table className="data-table">
      {caption ? <caption>{caption}</caption> : null}
      <thead>
        <tr>{head}</tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

export function Th({ children, numeric, scope = 'col' }: { children?: ReactNode; numeric?: boolean; scope?: 'col' | 'row' }) {
  return (
    <th scope={scope} className={numeric ? 'cell-num' : undefined}>
      {children}
    </th>
  );
}

export function Td({
  children,
  numeric,
  ellipsis,
  colSpan,
}: {
  children?: ReactNode;
  numeric?: boolean;
  ellipsis?: boolean;
  colSpan?: number;
}) {
  return (
    <td className={[numeric ? 'cell-num' : '', ellipsis ? 'cell-ellipsis' : ''].filter(Boolean).join(' ')} colSpan={colSpan}>
      {children}
    </td>
  );
}
