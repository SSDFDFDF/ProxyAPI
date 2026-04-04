import type { PropsWithChildren, ReactNode } from 'react';
import { Card } from '@/components/ui/Card';
import styles from './SectionCard.module.scss';

interface SectionCardProps {
  title: ReactNode;
  icon?: ReactNode;
  iconSrc?: string;
  iconAlt?: string;
  extra?: ReactNode;
  className?: string;
}

export function SectionCard({
  title,
  icon,
  iconSrc,
  iconAlt = '',
  extra,
  className,
  children,
}: PropsWithChildren<SectionCardProps>) {
  const iconNode =
    icon ??
    (iconSrc ? <img src={iconSrc} alt={iconAlt} className={styles.cardTitleIcon} /> : null);

  return (
    <Card
      className={className}
      title={
        <span className={styles.cardTitle}>
          {iconNode}
          <span>{title}</span>
        </span>
      }
      extra={extra}
    >
      {children}
    </Card>
  );
}
