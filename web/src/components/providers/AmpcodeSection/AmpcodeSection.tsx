import { Button } from '@/components/ui/Button';
import { SectionCard } from '@/components/ui/SectionCard';
import iconAmp from '@/assets/icons/amp.svg';
import type { AmpcodeConfig } from '@/types';
import { maskApiKey } from '@/utils/format';
import { useTranslation } from 'react-i18next';
import styles from '../ProviderSectionShared.module.scss';

interface AmpcodeSectionProps {
  config: AmpcodeConfig | null | undefined;
  loading: boolean;
  disableControls: boolean;
  isSwitching: boolean;
  onEdit: () => void;
}

export function AmpcodeSection({
  config,
  loading,
  disableControls,
  isSwitching,
  onEdit,
}: AmpcodeSectionProps) {
  const { t } = useTranslation();
  const showLoadingPlaceholder = loading && !config;

  return (
    <SectionCard
      title={t('ai_providers.ampcode_title')}
      iconSrc={iconAmp}
      extra={
        <Button
          size="sm"
          onClick={onEdit}
          disabled={disableControls || loading || isSwitching}
        >
          {t('common.edit')}
        </Button>
      }
    >
      {showLoadingPlaceholder ? (
        <div className="hint">{t('common.loading')}</div>
      ) : (
        <>
          <div className={styles.fieldRow}>
            <span className={styles.fieldLabel}>{t('ai_providers.ampcode_upstream_url_label')}:</span>
            <span className={styles.fieldValue}>{config?.upstreamUrl || t('common.not_set')}</span>
          </div>
          <div className={styles.fieldRow}>
            <span className={styles.fieldLabel}>
              {t('ai_providers.ampcode_upstream_api_key_label')}:
            </span>
            <span className={styles.fieldValue}>
              {config?.upstreamApiKey ? maskApiKey(config.upstreamApiKey) : t('common.not_set')}
            </span>
          </div>
          <div className={styles.fieldRow}>
            <span className={styles.fieldLabel}>
              {t('ai_providers.ampcode_force_model_mappings_label')}:
            </span>
            <span className={styles.fieldValue}>
              {(config?.forceModelMappings ?? false) ? t('common.yes') : t('common.no')}
            </span>
          </div>
          <div className={styles.fieldRow} style={{ marginTop: 8 }}>
            <span className={styles.fieldLabel}>{t('ai_providers.ampcode_model_mappings_count')}:</span>
            <span className={styles.fieldValue}>{config?.modelMappings?.length || 0}</span>
          </div>
          <div className={styles.fieldRow}>
            <span className={styles.fieldLabel}>{t('ai_providers.ampcode_upstream_api_keys_count')}:</span>
            <span className={styles.fieldValue}>{config?.upstreamApiKeys?.length || 0}</span>
          </div>
          {config?.modelMappings?.length ? (
            <div className={styles.modelTagList}>
              {config.modelMappings.slice(0, 5).map((mapping) => (
                <span key={`${mapping.from}→${mapping.to}`} className={styles.modelTag}>
                  <span className={styles.modelName}>{mapping.from}</span>
                  <span className={styles.modelAlias}>{mapping.to}</span>
                </span>
              ))}
              {config.modelMappings.length > 5 && (
                <span className={styles.modelTag}>
                  <span className={styles.modelName}>+{config.modelMappings.length - 5}</span>
                </span>
              )}
            </div>
          ) : null}
        </>
      )}
    </SectionCard>
  );
}
