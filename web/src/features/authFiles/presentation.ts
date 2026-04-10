import type { TFunction } from 'i18next';
import type { AuthFileItem } from '@/types';
import {
  getAuthFileStatusMessage,
  isRuntimeOnlyAuthFile,
  QUOTA_PROVIDER_TYPES,
  type QuotaProviderType,
} from '@/features/authFiles/constants';
import { isDisabledAuthFile, resolveAuthProvider } from '@/utils/quota';

export type AuthFileHealthState = 'virtual' | 'disabled' | 'warning' | 'healthy' | 'enabled';

export const AUTH_FILE_HEALTHY_STATUS_MESSAGES = new Set([
  'ok',
  'healthy',
  'ready',
  'success',
  'available',
]);

export type AuthFileHealthPresentation = {
  state: AuthFileHealthState;
  statusMessage: string;
  isRuntimeOnly: boolean;
  isDisabled: boolean;
  isWarning: boolean;
  showStatusMessage: boolean;
};

export const resolveAuthFileQuotaType = (file: AuthFileItem): QuotaProviderType | null => {
  const provider = resolveAuthProvider(file);
  if (!QUOTA_PROVIDER_TYPES.has(provider as QuotaProviderType)) return null;
  return provider as QuotaProviderType;
};

export const resolveAuthFileHealthPresentation = (
  file: AuthFileItem
): AuthFileHealthPresentation => {
  const statusMessage = getAuthFileStatusMessage(file);
  const isRuntimeOnly = isRuntimeOnlyAuthFile(file);
  const isDisabled = isDisabledAuthFile(file);
  const isWarning =
    statusMessage.length > 0 && !AUTH_FILE_HEALTHY_STATUS_MESSAGES.has(statusMessage.toLowerCase());

  const state: AuthFileHealthState = isRuntimeOnly
    ? 'virtual'
    : isDisabled
      ? 'disabled'
      : isWarning
        ? 'warning'
        : statusMessage
          ? 'healthy'
          : 'enabled';

  return {
    state,
    statusMessage,
    isRuntimeOnly,
    isDisabled,
    isWarning,
    showStatusMessage: isWarning,
  };
};

export const getAuthFileHealthLabel = (t: TFunction, state: AuthFileHealthState): string => {
  if (state === 'virtual') return t('auth_files.type_virtual');
  if (state === 'disabled') return t('auth_files.health_status_disabled');
  if (state === 'warning') return t('auth_files.health_status_warning');
  if (state === 'healthy') return t('auth_files.health_status_healthy');
  return t('auth_files.status_toggle_label');
};
