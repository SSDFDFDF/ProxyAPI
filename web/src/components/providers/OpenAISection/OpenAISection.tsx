import { Fragment, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { SectionCard } from '@/components/ui/SectionCard';
import { IconCheck, IconX } from '@/components/ui/icons';
import iconOpenaiLight from '@/assets/icons/openai-light.svg';
import iconOpenaiDark from '@/assets/icons/openai-dark.svg';
import type { OpenAIProviderConfig } from '@/types';
import { maskApiKey } from '@/utils/format';
import {
  buildCandidateUsageSourceIds,
  calculateStatusBarData,
  type KeyStats,
  type UsageDetail,
} from '@/utils/usage';
import { ProviderList } from '../ProviderList';
import { ProviderStatusBar } from '../ProviderStatusBar';
import styles from '../ProviderSectionShared.module.scss';
import { getOpenAIProviderStats, getStatsBySource } from '../utils';

type DetailModalType = 'keys' | 'models';

interface OpenAISectionProps {
  configs: OpenAIProviderConfig[];
  keyStats: KeyStats;
  usageDetails: UsageDetail[];
  loading: boolean;
  disableControls: boolean;
  isSwitching: boolean;
  resolvedTheme: string;
  onAdd: () => void;
  onEdit: (index: number) => void;
  onDelete: (index: number) => void;
}

export function OpenAISection({
  configs,
  keyStats,
  usageDetails,
  loading,
  disableControls,
  isSwitching,
  resolvedTheme,
  onAdd,
  onEdit,
  onDelete,
}: OpenAISectionProps) {
  const { t } = useTranslation();
  const actionsDisabled = disableControls || loading || isSwitching;
  const [selectedDetail, setSelectedDetail] = useState<{
    providerIndex: number;
    type: DetailModalType;
  } | null>(null);

  const statusBarCache = useMemo(() => {
    const cache = new Map<string, ReturnType<typeof calculateStatusBarData>>();

    configs.forEach((provider) => {
      const sourceIds = new Set<string>();
      buildCandidateUsageSourceIds({ prefix: provider.prefix }).forEach((id) => sourceIds.add(id));
      (provider.apiKeyEntries || []).forEach((entry) => {
        buildCandidateUsageSourceIds({ apiKey: entry.apiKey }).forEach((id) => sourceIds.add(id));
      });

      const filteredDetails = sourceIds.size
        ? usageDetails.filter((detail) => sourceIds.has(detail.source))
        : [];
      cache.set(provider.name, calculateStatusBarData(filteredDetails));
    });

    return cache;
  }, [configs, usageDetails]);

  const selectedProvider =
    selectedDetail !== null ? configs[selectedDetail.providerIndex] ?? null : null;

  return (
    <SectionCard
      title={t('ai_providers.openai_title')}
      iconSrc={resolvedTheme === 'dark' ? iconOpenaiDark : iconOpenaiLight}
      extra={
        <Button size="sm" onClick={onAdd} disabled={actionsDisabled}>
          {t('ai_providers.openai_add_button')}
        </Button>
      }
    >
      <ProviderList<OpenAIProviderConfig>
        items={configs}
        loading={loading}
        keyField={(_, index) => `openai-provider-${index}`}
        emptyTitle={t('ai_providers.openai_empty_title')}
        emptyDescription={t('ai_providers.openai_empty_desc')}
        onEdit={onEdit}
        onDelete={onDelete}
        actionsDisabled={actionsDisabled}
        renderContent={(item, index) => {
          const stats = getOpenAIProviderStats(item.apiKeyEntries, keyStats, item.prefix);
          const headerEntries = Object.entries(item.headers || {});
          const apiKeyEntries = item.apiKeyEntries || [];
          const models = item.models || [];
          const statusData = statusBarCache.get(item.name) || calculateStatusBarData([]);

          return (
            <Fragment>
              <div className="item-title">{item.name}</div>
              {item.priority !== undefined && (
                <div className={styles.fieldRow}>
                  <span className={styles.fieldLabel}>{t('common.priority')}:</span>
                  <span className={styles.fieldValue}>{item.priority}</span>
                </div>
              )}
              {item.prefix && (
                <div className={styles.fieldRow}>
                  <span className={styles.fieldLabel}>{t('common.prefix')}:</span>
                  <span className={styles.fieldValue}>{item.prefix}</span>
                </div>
              )}
              <div className={styles.fieldRow}>
                <span className={styles.fieldLabel}>{t('common.base_url')}:</span>
                <span className={styles.fieldValue}>{item.baseUrl}</span>
              </div>
              {headerEntries.length > 0 && (
                <div className={styles.headerBadgeList}>
                  {headerEntries.map(([key, value]) => (
                    <span key={key} className={styles.headerBadge}>
                      <strong>{key}:</strong> {value}
                    </span>
                  ))}
                </div>
              )}

              {apiKeyEntries.length > 0 && (
                <div className={styles.apiKeyEntriesSection}>
                  <div className={styles.apiKeySummaryRow}>
                    <div className={styles.fieldRow}>
                      <span className={styles.fieldLabel}>{t('ai_providers.openai_keys_count')}:</span>
                      <span className={styles.fieldValue}>{apiKeyEntries.length}</span>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setSelectedDetail({ providerIndex: index, type: 'keys' })}
                      disabled={actionsDisabled}
                    >
                      {`${t('ai_providers.openai_add_modal_keys_label')} (${apiKeyEntries.length})`}
                    </Button>
                  </div>
                </div>
              )}
              <div className={styles.apiKeyEntriesSection}>
                <div className={styles.apiKeySummaryRow}>
                  <div className={styles.fieldRow} style={{ marginBottom: 0 }}>
                    <span className={styles.fieldLabel}>{t('ai_providers.openai_models_count')}:</span>
                    <span className={styles.fieldValue}>{models.length}</span>
                  </div>
                  {models.length > 0 ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setSelectedDetail({ providerIndex: index, type: 'models' })}
                      disabled={actionsDisabled}
                    >
                      {`${t('ai_providers.openai_models_count')} (${models.length})`}
                    </Button>
                  ) : null}
                </div>
              </div>
              {item.testModel && (
                <div className={styles.fieldRow}>
                  <span className={styles.fieldLabel}>Test Model:</span>
                  <span className={styles.fieldValue}>{item.testModel}</span>
                </div>
              )}
              <div className={styles.cardStats}>
                <span className={`${styles.statPill} ${styles.statSuccess}`}>
                  {t('stats.success')}: {stats.success}
                </span>
                <span className={`${styles.statPill} ${styles.statFailure}`}>
                  {t('stats.failure')}: {stats.failure}
                </span>
              </div>
              <ProviderStatusBar statusData={statusData} />
            </Fragment>
          );
        }}
      />

      <Modal
        open={Boolean(selectedProvider)}
        title={
          selectedProvider
            ? `${selectedProvider.name} · ${t(
                selectedDetail?.type === 'models'
                  ? 'ai_providers.openai_models_count'
                  : 'ai_providers.openai_add_modal_keys_label'
              )}`
            : undefined
        }
        onClose={() => setSelectedDetail(null)}
        width={880}
        footer={
          <Button variant="secondary" size="sm" onClick={() => setSelectedDetail(null)}>
            {t('common.close')}
          </Button>
        }
      >
        {selectedProvider ? (
          selectedDetail?.type === 'models' ? (
            <>
              <div className={styles.fieldRow}>
                <span className={styles.fieldLabel}>{t('common.base_url')}:</span>
                <span className={styles.fieldValue}>{selectedProvider.baseUrl}</span>
              </div>
              <div className={styles.fieldRow}>
                <span className={styles.fieldLabel}>{t('ai_providers.openai_models_count')}:</span>
                <span className={styles.fieldValue}>{selectedProvider.models?.length || 0}</span>
              </div>
              {selectedProvider.models?.length ? (
                <div className={styles.modelTagList}>
                  {selectedProvider.models.map((model) => (
                    <span key={model.name} className={styles.modelTag}>
                      <span className={styles.modelName}>{model.name}</span>
                      {model.alias && model.alias !== model.name && (
                        <span className={styles.modelAlias}>{model.alias}</span>
                      )}
                    </span>
                  ))}
                </div>
              ) : null}
              {selectedProvider.testModel && (
                <div className={styles.fieldRow}>
                  <span className={styles.fieldLabel}>Test Model:</span>
                  <span className={styles.fieldValue}>{selectedProvider.testModel}</span>
                </div>
              )}
            </>
          ) : (
            <>
              <div className={styles.fieldRow}>
                <span className={styles.fieldLabel}>{t('common.base_url')}:</span>
                <span className={styles.fieldValue}>{selectedProvider.baseUrl}</span>
              </div>

              <div className={styles.apiKeyEntriesSection}>
                <div className={styles.apiKeyEntriesLabel}>
                  {t('ai_providers.openai_keys_count')}: {selectedProvider.apiKeyEntries?.length ?? 0}
                </div>

                <div className={styles.apiKeyEntryList}>
                  {(selectedProvider.apiKeyEntries || []).map((entry, entryIndex) => {
                    const entryStats = getStatsBySource(entry.apiKey, keyStats);

                    return (
                      <div key={`${selectedProvider.name}-${entryIndex}`} className={styles.apiKeyEntryCard}>
                        <span className={styles.apiKeyEntryIndex}>{entryIndex + 1}</span>
                        <span className={styles.apiKeyEntryKey}>{maskApiKey(entry.apiKey)}</span>
                        {entry.proxyUrl && (
                          <span className={styles.apiKeyEntryProxy}>{entry.proxyUrl}</span>
                        )}
                        <div className={styles.apiKeyEntryStats}>
                          <span
                            className={`${styles.apiKeyEntryStat} ${styles.apiKeyEntryStatSuccess}`}
                          >
                            <IconCheck size={12} /> {entryStats.success}
                          </span>
                          <span
                            className={`${styles.apiKeyEntryStat} ${styles.apiKeyEntryStatFailure}`}
                          >
                            <IconX size={12} /> {entryStats.failure}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )
        ) : null}
      </Modal>
    </SectionCard>
  );
}
