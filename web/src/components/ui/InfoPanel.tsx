import type { PropsWithChildren, ReactNode } from 'react';
import styles from './InfoPanel.module.scss';

type InfoPanelVariant = 'solid' | 'dashed';

interface InfoPanelProps {
  title?: ReactNode;
  value?: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  variant?: InfoPanelVariant;
  className?: string;
  titleClassName?: string;
  valueClassName?: string;
  hintClassName?: string;
  actionsClassName?: string;
}

export function InfoPanel({
  title,
  value,
  hint,
  actions,
  variant = 'solid',
  className,
  titleClassName,
  valueClassName,
  hintClassName,
  actionsClassName,
  children,
}: PropsWithChildren<InfoPanelProps>) {
  return (
    <div
      className={[
        styles.panel,
        variant === 'dashed' ? styles.panelDashed : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {title ? (
        <div className={[styles.title, titleClassName].filter(Boolean).join(' ')}>
          {title}
        </div>
      ) : null}
      {value ? (
        <div className={[styles.value, valueClassName].filter(Boolean).join(' ')}>
          {value}
        </div>
      ) : null}
      {children}
      {hint ? (
        <div className={[styles.hint, hintClassName].filter(Boolean).join(' ')}>
          {hint}
        </div>
      ) : null}
      {actions ? (
        <div className={[styles.actions, actionsClassName].filter(Boolean).join(' ')}>
          {actions}
        </div>
      ) : null}
    </div>
  );
}
