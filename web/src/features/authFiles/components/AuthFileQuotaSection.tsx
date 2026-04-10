import { useCallback, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ANTIGRAVITY_CONFIG,
  CLAUDE_CONFIG,
  CODEX_CONFIG,
  GEMINI_CLI_CONFIG,
  KIMI_CONFIG,
  getQuotaConfigByType,
  refreshQuotaForFiles,
} from '@/components/quota';
import { useNotificationStore, useQuotaStore } from '@/stores';
import type { useQuotaStore as UseQuotaStoreType } from '@/stores/useQuotaStore';
import type { AuthFileItem } from '@/types';
import { isDisabledAuthFile } from '@/utils/quota';
import {
  isRuntimeOnlyAuthFile,
  resolveQuotaErrorMessage,
  type QuotaProviderType,
} from '@/features/authFiles/constants';
import { QuotaProgressBar } from '@/features/authFiles/components/QuotaProgressBar';
import { useSessionScopeKey } from '@/stores/serverState/sessionScope';
import styles from '@/pages/AuthFilesPage.module.scss';

type QuotaStoreState = ReturnType<typeof UseQuotaStoreType.getState>;
type QuotaState = { status?: string; error?: string; errorStatus?: number } | undefined;

export type AuthFileQuotaSectionProps = {
  file: AuthFileItem;
  quotaType: QuotaProviderType;
  disableControls: boolean;
  includeDisabled?: boolean;
  compact?: boolean;
};

export function AuthFileQuotaSection(props: AuthFileQuotaSectionProps) {
  const { file, quotaType, disableControls, includeDisabled = false, compact = false } = props;
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const scopeKey = useSessionScopeKey();
  const emptyQuotaRef = useRef<QuotaState>(undefined);

  const quota = useQuotaStore((state) => {
    if (state.scopeKey !== scopeKey) {
      return emptyQuotaRef.current;
    }
    if (quotaType === 'antigravity') return state.antigravityQuota[file.name] as QuotaState;
    if (quotaType === 'claude') return state.claudeQuota[file.name] as QuotaState;
    if (quotaType === 'codex') return state.codexQuota[file.name] as QuotaState;
    if (quotaType === 'kimi') return state.kimiQuota[file.name] as QuotaState;
    return state.geminiCliQuota[file.name] as QuotaState;
  });
  const config = getQuotaConfigByType(quotaType);
  const isDisabled = isDisabledAuthFile(file);

  const refreshQuotaForFile = useCallback(async () => {
    if (disableControls) return;
    if (isRuntimeOnlyAuthFile(file)) return;
    if (!includeDisabled && isDisabled) return;
    if (quota?.status === 'loading') return;
    const [result] = await refreshQuotaForFiles([file], t);
    if (!result || result.status === 'skipped') return;
    if (result.status === 'success') {
      showNotification(t('auth_files.quota_refresh_success', { name: file.name }), 'success');
      return;
    }
    showNotification(
      t('auth_files.quota_refresh_failed', {
        name: file.name,
        message: result.error || t('common.unknown_error'),
      }),
      'error'
    );
  }, [disableControls, file, includeDisabled, isDisabled, quota?.status, showNotification, t]);

  if (!config) return null;

  const renderQuotaItems = () => {
    switch (config.type) {
      case 'claude':
        return CLAUDE_CONFIG.renderQuotaItems(quota as QuotaStoreState['claudeQuota'][string], t, {
          styles,
          QuotaProgressBar,
          variant: 'auth-file',
        }) as ReactNode;
      case 'antigravity':
        return ANTIGRAVITY_CONFIG.renderQuotaItems(
          quota as QuotaStoreState['antigravityQuota'][string],
          t,
          {
            styles,
            QuotaProgressBar,
            variant: 'auth-file',
          }
        ) as ReactNode;
      case 'codex':
        return CODEX_CONFIG.renderQuotaItems(quota as QuotaStoreState['codexQuota'][string], t, {
          styles,
          QuotaProgressBar,
          variant: 'auth-file',
        }) as ReactNode;
      case 'gemini-cli':
        return GEMINI_CLI_CONFIG.renderQuotaItems(
          quota as QuotaStoreState['geminiCliQuota'][string],
          t,
          {
            styles,
            QuotaProgressBar,
            variant: 'auth-file',
          }
        ) as ReactNode;
      case 'kimi':
        return KIMI_CONFIG.renderQuotaItems(quota as QuotaStoreState['kimiQuota'][string], t, {
          styles,
          QuotaProgressBar,
          variant: 'auth-file',
        }) as ReactNode;
      default:
        return null;
    }
  };

  const quotaStatus = quota?.status ?? 'idle';
  const canRefreshQuota =
    !disableControls && !isRuntimeOnlyAuthFile(file) && (includeDisabled || !isDisabled);
  const quotaErrorMessage = resolveQuotaErrorMessage(
    t,
    quota?.errorStatus,
    quota?.error || t('common.unknown_error')
  );

  return (
    <div className={`${styles.quotaSection} ${compact ? styles.quotaSectionCompact : ''}`}>
      {quotaStatus === 'loading' ? (
        <div className={styles.quotaMessage}>{t(`${config.i18nPrefix}.loading`)}</div>
      ) : quotaStatus === 'idle' ? (
        <button
          type="button"
          className={`${styles.quotaMessage} ${styles.quotaMessageAction}`}
          onClick={() => void refreshQuotaForFile()}
          disabled={!canRefreshQuota}
        >
          {t(`${config.i18nPrefix}.idle`)}
        </button>
      ) : quotaStatus === 'error' ? (
        <div className={styles.quotaError}>
          {t(`${config.i18nPrefix}.load_failed`, {
            message: quotaErrorMessage,
          })}
        </div>
      ) : quota ? (
        renderQuotaItems()
      ) : (
        <div className={styles.quotaMessage}>{t(`${config.i18nPrefix}.idle`)}</div>
      )}
    </div>
  );
}
