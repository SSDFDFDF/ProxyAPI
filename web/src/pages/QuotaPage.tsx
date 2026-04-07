/**
 * Quota management page - coordinates the three quota sections.
 */

import { useCallback, type CSSProperties, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { PageFilterSection } from '@/components/ui/PageFilterSection';
import { FilterTabs, type FilterTabItem } from '@/components/ui/FilterTabs';
import { PageTitleBlock } from '@/components/ui/PageTitleBlock';
import { IconEye, IconEyeOff } from '@/components/ui/icons';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useAuthStore, useThemeStore } from '@/stores';
import { authFilesApi, configFileApi } from '@/services/api';
import {
  QuotaSection,
  ANTIGRAVITY_CONFIG,
  CLAUDE_CONFIG,
  CODEX_CONFIG,
  GEMINI_CLI_CONFIG,
  KIMI_CONFIG,
} from '@/components/quota';
import type { AuthFileItem } from '@/types';
import {
  getAuthFileIcon,
  getTypeColor,
  type ResolvedTheme,
} from '@/features/authFiles/constants';
import { isDisabledAuthFile } from '@/utils/quota';
import styles from './QuotaPage.module.scss';

const QUOTA_TABS = [
  { id: 'claude', label: 'Claude', config: CLAUDE_CONFIG },
  { id: 'antigravity', label: 'Antigravity', config: ANTIGRAVITY_CONFIG },
  { id: 'codex', label: 'Codex', config: CODEX_CONFIG },
  { id: 'gemini-cli', label: 'Gemini CLI', config: GEMINI_CLI_CONFIG },
  { id: 'kimi', label: 'Kimi', config: KIMI_CONFIG },
];

const shouldIncludeInQuota = (
  file: AuthFileItem,
  includeDisabled: boolean,
  matchFile: (file: AuthFileItem) => boolean
) => matchFile(file) && (includeDisabled || !isDisabledAuthFile(file));

export function QuotaPage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const resolvedTheme: ResolvedTheme = useThemeStore((state) => state.resolvedTheme);

  const [files, setFiles] = useState<AuthFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('claude');
  const [includeDisabled, setIncludeDisabled] = useState(false);

  const quotaTabs = useMemo(
    () =>
      QUOTA_TABS.map((tab) => ({
        ...tab,
        count: files.filter((file) =>
          shouldIncludeInQuota(file, includeDisabled, tab.config.matchesFile)
        ).length,
      })),
    [files, includeDisabled]
  );
  const quotaTabItems = useMemo<FilterTabItem[]>(
    () =>
      quotaTabs.map((tab) => {
        const iconSrc = getAuthFileIcon(tab.id, resolvedTheme);
        const color = getTypeColor(tab.id, resolvedTheme);
        const buttonStyle = {
          '--filter-color': color.text,
          '--filter-surface': color.bg,
          '--filter-active-text': resolvedTheme === 'dark' ? '#111827' : '#ffffff',
        } as CSSProperties;

        return {
          id: tab.id,
          label: tab.label,
          active: activeTab === tab.id,
          count: tab.count,
          style: buttonStyle,
          icon: iconSrc ? (
            <img src={iconSrc} alt="" className={styles.filterTagIcon} />
          ) : (
            <span className={styles.filterTagIconFallback}>
              {tab.label.slice(0, 1).toUpperCase()}
            </span>
          ),
          onClick: () => setActiveTab(tab.id),
        };
      }),
    [activeTab, quotaTabs, resolvedTheme]
  );

  const activeConfig = quotaTabs.find((tab) => tab.id === activeTab)?.config;

  const disableControls = connectionStatus !== 'connected';

  const loadConfig = useCallback(async () => {
    try {
      await configFileApi.fetchConfigYaml();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError((prev) => prev || errorMessage);
    }
  }, [t]);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await authFilesApi.list();
      setFiles(data?.files || []);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [t]);

  const handleHeaderRefresh = useCallback(async () => {
    await Promise.all([loadConfig(), loadFiles()]);
  }, [loadConfig, loadFiles]);

  useHeaderRefresh(handleHeaderRefresh);

  useEffect(() => {
    loadFiles();
    loadConfig();
  }, [loadFiles, loadConfig]);

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <PageTitleBlock
          title={t('quota_management.title')}
          description={t('quota_management.description')}
          count={files.length}
          className={styles.pageHeaderCopy}
        />

        <div className={styles.pageHeaderActions}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setIncludeDisabled((prev) => !prev)}
            className={`${styles.includeDisabledButton} ${
              includeDisabled ? styles.includeDisabledButtonActive : ''
            }`}
            aria-pressed={includeDisabled}
            title={t('quota_management.include_disabled')}
          >
            <>
              {includeDisabled ? <IconEye size={16} /> : <IconEyeOff size={16} />}
              {t('quota_management.include_disabled')}
            </>
          </Button>
        </div>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      <PageFilterSection className={styles.filterSection}>
        <FilterTabs items={quotaTabItems} />
      </PageFilterSection>

      {activeConfig && (
        <QuotaSection
          key={activeConfig.type}
          config={activeConfig as any}
          files={files}
          loading={loading}
          disabled={disableControls}
          includeDisabled={includeDisabled}
        />
      )}
    </div>
  );
}
