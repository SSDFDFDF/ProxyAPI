import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import styles from '@/pages/AuthFilesPage.module.scss';

export type BatchEditableFieldKey =
  | 'prefix'
  | 'proxyUrl'
  | 'priority'
  | 'excludedModelsText'
  | 'disableCooling'
  | 'websockets'
  | 'note';

export type BatchEditableFieldState =
  | {
      enabled: boolean;
      value: string;
    }
  | {
      enabled: boolean;
      value: boolean;
    };

export type BatchAuthFileFieldsState = {
  prefix: { enabled: boolean; value: string };
  proxyUrl: { enabled: boolean; value: string };
  priority: { enabled: boolean; value: string };
  excludedModelsText: { enabled: boolean; value: string };
  disableCooling: { enabled: boolean; value: string };
  websockets: { enabled: boolean; value: boolean };
  note: { enabled: boolean; value: string };
};

type BatchAuthFileFieldsModalProps = {
  open: boolean;
  selectedCount: number;
  saving: boolean;
  disableControls: boolean;
  fields: BatchAuthFileFieldsState;
  onClose: () => void;
  onSave: () => void;
  onFieldToggle: (field: BatchEditableFieldKey, enabled: boolean) => void;
  onFieldChange: (field: BatchEditableFieldKey, value: string | boolean) => void;
};

export function BatchAuthFileFieldsModal(props: BatchAuthFileFieldsModalProps) {
  const {
    open,
    selectedCount,
    saving,
    disableControls,
    fields,
    onClose,
    onSave,
    onFieldToggle,
    onFieldChange,
  } = props;
  const { t } = useTranslation();

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeDisabled={saving}
      width={720}
      title={t('auth_files.batch_edit_fields_title', {
        count: selectedCount,
        defaultValue: '批量编辑 {{count}} 个认证文件',
      })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button onClick={onSave} loading={saving} disabled={disableControls || saving}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className={styles.prefixProxyEditor}>
        <div className={styles.batchFieldsHint}>
          {t('auth_files.batch_edit_fields_hint', {
            defaultValue: '仅会更新已启用的字段；留空可用于清空文本字段。',
          })}
        </div>

        <div className={styles.prefixProxyFields}>
          <div className={styles.batchFieldRow}>
            <div className={styles.batchFieldToggle}>
              <ToggleSwitch
                checked={fields.prefix.enabled}
                onChange={(value) => onFieldToggle('prefix', value)}
                disabled={disableControls || saving}
                ariaLabel={t('auth_files.prefix_label')}
                label={<span className={styles.filterToggleLabel}>{t('auth_files.prefix_label')}</span>}
              />
            </div>
            <Input
              label={t('auth_files.prefix_label')}
              value={fields.prefix.value}
              disabled={!fields.prefix.enabled || disableControls || saving}
              onChange={(e) => onFieldChange('prefix', e.target.value)}
            />
          </div>

          <div className={styles.batchFieldRow}>
            <div className={styles.batchFieldToggle}>
              <ToggleSwitch
                checked={fields.proxyUrl.enabled}
                onChange={(value) => onFieldToggle('proxyUrl', value)}
                disabled={disableControls || saving}
                ariaLabel={t('auth_files.proxy_url_label')}
                label={
                  <span className={styles.filterToggleLabel}>{t('auth_files.proxy_url_label')}</span>
                }
              />
            </div>
              <Input
                label={t('auth_files.proxy_url_label')}
                value={fields.proxyUrl.value}
                placeholder={t('auth_files.proxy_url_placeholder')}
                disabled={!fields.proxyUrl.enabled || disableControls || saving}
                onChange={(e) => onFieldChange('proxyUrl', e.target.value)}
              />
            </div>

          <div className={styles.batchFieldRow}>
            <div className={styles.batchFieldToggle}>
              <ToggleSwitch
                checked={fields.priority.enabled}
                onChange={(value) => onFieldToggle('priority', value)}
                disabled={disableControls || saving}
                ariaLabel={t('auth_files.priority_label')}
                label={
                  <span className={styles.filterToggleLabel}>{t('auth_files.priority_label')}</span>
                }
              />
            </div>
            <Input
              label={t('auth_files.priority_label')}
              value={fields.priority.value}
              placeholder={t('auth_files.priority_placeholder')}
              hint={t('auth_files.priority_hint')}
              disabled={!fields.priority.enabled || disableControls || saving}
              onChange={(e) => onFieldChange('priority', e.target.value)}
            />
          </div>

          <div className={styles.batchFieldRow}>
            <div className={styles.batchFieldToggle}>
              <ToggleSwitch
                checked={fields.excludedModelsText.enabled}
                onChange={(value) => onFieldToggle('excludedModelsText', value)}
                disabled={disableControls || saving}
                ariaLabel={t('auth_files.excluded_models_label')}
                label={
                  <span className={styles.filterToggleLabel}>
                    {t('auth_files.excluded_models_label')}
                  </span>
                }
              />
            </div>
            <div className="form-group">
              <label>{t('auth_files.excluded_models_label')}</label>
              <textarea
                className={`input ${styles.batchFieldsTextarea}`.trim()}
                value={fields.excludedModelsText.value}
                placeholder={t('auth_files.excluded_models_placeholder')}
                rows={4}
                disabled={!fields.excludedModelsText.enabled || disableControls || saving}
                onChange={(e) => onFieldChange('excludedModelsText', e.target.value)}
              />
              <div className="hint">{t('auth_files.excluded_models_hint')}</div>
            </div>
          </div>

          <div className={styles.batchFieldRow}>
            <div className={styles.batchFieldToggle}>
              <ToggleSwitch
                checked={fields.disableCooling.enabled}
                onChange={(value) => onFieldToggle('disableCooling', value)}
                disabled={disableControls || saving}
                ariaLabel={t('auth_files.disable_cooling_label')}
                label={
                  <span className={styles.filterToggleLabel}>
                    {t('auth_files.disable_cooling_label')}
                  </span>
                }
              />
            </div>
            <Input
              label={t('auth_files.disable_cooling_label')}
              value={fields.disableCooling.value}
              placeholder={t('auth_files.disable_cooling_placeholder')}
              hint={t('auth_files.disable_cooling_hint')}
              disabled={!fields.disableCooling.enabled || disableControls || saving}
              onChange={(e) => onFieldChange('disableCooling', e.target.value)}
            />
          </div>

          <div className={styles.batchFieldRow}>
            <div className={styles.batchFieldToggle}>
              <ToggleSwitch
                checked={fields.websockets.enabled}
                onChange={(value) => onFieldToggle('websockets', value)}
                disabled={disableControls || saving}
                ariaLabel={t('ai_providers.codex_websockets_label')}
                label={
                  <span className={styles.filterToggleLabel}>
                    {t('ai_providers.codex_websockets_label')}
                  </span>
                }
              />
            </div>
            <div className="form-group">
              <label>{t('ai_providers.codex_websockets_label')}</label>
              <ToggleSwitch
                checked={fields.websockets.value}
                disabled={!fields.websockets.enabled || disableControls || saving}
                ariaLabel={t('ai_providers.codex_websockets_label')}
                onChange={(value) => onFieldChange('websockets', value)}
              />
              <div className="hint">{t('ai_providers.codex_websockets_hint')}</div>
            </div>
          </div>

          <div className={styles.batchFieldRow}>
            <div className={styles.batchFieldToggle}>
              <ToggleSwitch
                checked={fields.note.enabled}
                onChange={(value) => onFieldToggle('note', value)}
                disabled={disableControls || saving}
                ariaLabel={t('auth_files.note_label')}
                label={<span className={styles.filterToggleLabel}>{t('auth_files.note_label')}</span>}
              />
            </div>
            <Input
              label={t('auth_files.note_label')}
              value={fields.note.value}
              placeholder={t('auth_files.note_placeholder')}
              hint={t('auth_files.note_hint')}
              disabled={!fields.note.enabled || disableControls || saving}
              onChange={(e) => onFieldChange('note', e.target.value)}
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}
