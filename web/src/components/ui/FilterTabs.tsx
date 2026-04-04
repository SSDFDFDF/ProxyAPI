import type { CSSProperties, ReactNode } from 'react';
import styles from './FilterTabs.module.scss';

export type FilterTabItem = {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  count?: number | null;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
  style?: CSSProperties;
  onClick: () => void;
};

type FilterTabsProps = {
  items: FilterTabItem[];
};

export function FilterTabs({ items }: FilterTabsProps) {
  return (
    <div className={styles.filterRail}>
      <div className={styles.filterTags}>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={[styles.filterTag, item.active ? styles.filterTagActive : '']
              .filter(Boolean)
              .join(' ')}
            style={item.style}
            title={item.title}
            aria-label={item.ariaLabel}
            disabled={item.disabled}
            onClick={item.onClick}
          >
            <span className={styles.filterTagLabel}>
              {item.icon ? <span className={styles.filterTagIconWrap}>{item.icon}</span> : null}
              <span className={styles.filterTagText}>{item.label}</span>
            </span>
            {item.count != null ? <span className={styles.filterTagCount}>{item.count}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}
