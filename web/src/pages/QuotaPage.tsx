/**
 * Quota management page - coordinates the three quota sections.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useAuthStore } from '@/stores';
import { authFilesApi, configFileApi } from '@/services/api';
import {
  QuotaSection,
  ANTIGRAVITY_CONFIG,
  CLAUDE_CONFIG,
  CODEX_CONFIG,
  GEMINI_CLI_CONFIG,
  KIMI_CONFIG
} from '@/components/quota';
import type { AuthFileItem } from '@/types';
import styles from './QuotaPage.module.scss';

const QUOTA_TABS = [
  { id: 'claude', label: 'Claude', config: CLAUDE_CONFIG },
  { id: 'antigravity', label: 'Antigravity', config: ANTIGRAVITY_CONFIG },
  { id: 'codex', label: 'Codex', config: CODEX_CONFIG },
  { id: 'gemini-cli', label: 'Gemini CLI', config: GEMINI_CLI_CONFIG },
  { id: 'kimi', label: 'Kimi', config: KIMI_CONFIG },
];

export function QuotaPage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);

  const [files, setFiles] = useState<AuthFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('claude');

  const quotaTabs = useMemo(
    () =>
      QUOTA_TABS.map((tab) => ({
        ...tab,
        count: files.filter((file) => tab.config.filterFn(file)).length,
      })),
    [files]
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
        <h1 className={styles.pageTitle}>{t('quota_management.title')}</h1>
        <p className={styles.description}>{t('quota_management.description')}</p>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      <div className={styles.filterSection}>
        <div className={styles.filterRail}>
          <div className={styles.filterTags}>
            {quotaTabs.map((tab) => (
              <button
                key={tab.id}
                className={[styles.filterTag, activeTab === tab.id ? styles.filterTagActive : ''].filter(Boolean).join(' ')}
                onClick={() => setActiveTab(tab.id)}
              >
                <span className={styles.filterTagLabel}>
                  <span className={styles.filterTagText}>{tab.label}</span>
                </span>
                <span className={styles.filterTagCount}>{tab.count}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {activeConfig && (
        <QuotaSection
          key={activeConfig.type}
          config={activeConfig as any}
          files={files}
          loading={loading}
          disabled={disableControls}
        />
      )}
    </div>
  );
}
