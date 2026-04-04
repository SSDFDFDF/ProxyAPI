import type { PropsWithChildren } from 'react';
import styles from './PageFilterSection.module.scss';

interface PageFilterSectionProps {
  className?: string;
}

export function PageFilterSection({
  className,
  children,
}: PropsWithChildren<PageFilterSectionProps>) {
  return (
    <div className={[styles.filterSection, className].filter(Boolean).join(' ')}>
      {children}
    </div>
  );
}
