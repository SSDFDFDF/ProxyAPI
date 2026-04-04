import type { ReactNode } from 'react';
import styles from './KeyValueList.module.scss';

export interface KeyValueListItem {
  key: string;
  label: ReactNode;
  value: ReactNode;
}

interface KeyValueListProps {
  items: KeyValueListItem[];
  className?: string;
}

export function KeyValueList({ items, className }: KeyValueListProps) {
  return (
    <div className={[styles.list, className].filter(Boolean).join(' ')}>
      {items.map((item) => (
        <div key={item.key} className={styles.item}>
          <span className={styles.label}>{item.label}</span>
          <span className={styles.value}>{item.value}</span>
        </div>
      ))}
    </div>
  );
}
