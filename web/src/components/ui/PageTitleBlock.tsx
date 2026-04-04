import type { ElementType, ReactNode } from 'react';
import styles from './PageTitleBlock.module.scss';

type CountValue = number | string | null | undefined;

interface TitleWithCountProps {
  title: ReactNode;
  count?: CountValue;
  as?: ElementType;
  className?: string;
  titleClassName?: string;
}

interface PageTitleBlockProps {
  title: ReactNode;
  description?: ReactNode;
  count?: CountValue;
  className?: string;
}

const shouldRenderCount = (count: CountValue) => count !== null && count !== undefined;

export function TitleWithCount({
  title,
  count,
  as: TitleTag = 'span',
  className,
  titleClassName,
}: TitleWithCountProps) {
  return (
    <div className={[styles.titleRow, className].filter(Boolean).join(' ')}>
      <TitleTag className={titleClassName}>{title}</TitleTag>
      {shouldRenderCount(count) ? <span className={styles.countBadge}>{count}</span> : null}
    </div>
  );
}

export function PageTitleBlock({ title, description, count, className }: PageTitleBlockProps) {
  return (
    <div className={[styles.pageHeader, className].filter(Boolean).join(' ')}>
      <TitleWithCount
        title={title}
        count={count}
        as="h1"
        titleClassName={styles.pageTitle}
      />
      {description ? <p className={styles.description}>{description}</p> : null}
    </div>
  );
}
