import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
  useAuthFilesOauthStore,
  useNotificationStore,
  useProviderModelDefinitionsStore,
} from '@/stores';
import type { UnsupportedError } from '@/stores/useAuthFilesOauthStore';
import type { ProviderModelsError } from '@/stores/useProviderModelDefinitionsStore';
import type { AuthFileItem, OAuthModelAliasEntry } from '@/types';
import type { AuthFileModelItem } from '@/features/authFiles/constants';
import { normalizeProviderKey } from '@/features/authFiles/constants';
import {
  deleteOauthExcludedEntry,
  deleteOauthModelAlias,
  saveOauthModelAlias,
} from '@/domains/authFiles/mutations';

type ViewMode = 'diagram' | 'list';

export type UseAuthFilesOauthResult = {
  excluded: Record<string, string[]>;
  excludedError: UnsupportedError;
  modelAlias: Record<string, OAuthModelAliasEntry[]>;
  modelAliasError: UnsupportedError;
  providerModelErrors: Record<string, ProviderModelsError>;
  allProviderModels: Record<string, AuthFileModelItem[]>;
  providerList: string[];
  loadExcluded: (force?: boolean) => Promise<void>;
  loadModelAlias: (force?: boolean) => Promise<void>;
  deleteExcluded: (provider: string) => void;
  deleteModelAlias: (provider: string) => void;
  handleMappingUpdate: (provider: string, sourceModel: string, newAlias: string) => Promise<void>;
  handleDeleteLink: (provider: string, sourceModel: string, alias: string) => void;
  handleToggleFork: (
    provider: string,
    sourceModel: string,
    alias: string,
    fork: boolean
  ) => Promise<void>;
  handleRenameAlias: (oldAlias: string, newAlias: string) => Promise<void>;
  handleDeleteAlias: (aliasName: string) => void;
};

export type UseAuthFilesOauthOptions = {
  viewMode: ViewMode;
  files: AuthFileItem[];
};

export function useAuthFilesOauth(options: UseAuthFilesOauthOptions): UseAuthFilesOauthResult {
  const { viewMode, files } = options;
  const { t } = useTranslation();
  const { showNotification, showConfirmation } = useNotificationStore();
  const excluded = useAuthFilesOauthStore((state) => state.excluded);
  const excludedError = useAuthFilesOauthStore((state) => state.excludedError);
  const modelAlias = useAuthFilesOauthStore((state) => state.modelAlias);
  const modelAliasError = useAuthFilesOauthStore((state) => state.modelAliasError);
  const loadExcludedSnapshot = useAuthFilesOauthStore((state) => state.loadExcluded);
  const loadModelAliasSnapshot = useAuthFilesOauthStore((state) => state.loadModelAlias);
  const providerModelsByProvider = useProviderModelDefinitionsStore((state) => state.modelsByProvider);
  const providerModelErrors = useProviderModelDefinitionsStore((state) => state.errorsByProvider);
  const loadProviderModels = useProviderModelDefinitionsStore((state) => state.loadProviderModels);

  const excludedUnsupportedRef = useRef(false);
  const mappingsUnsupportedRef = useRef(false);

  const providerList = useMemo(() => {
    const providers = new Set<string>();

    Object.keys(excluded).forEach((provider) => {
      const key = provider.trim().toLowerCase();
      if (key) providers.add(key);
    });

    Object.keys(modelAlias).forEach((provider) => {
      const key = provider.trim().toLowerCase();
      if (key) providers.add(key);
    });

    files.forEach((file) => {
      if (typeof file.type === 'string') {
        const key = file.type.trim().toLowerCase();
        if (key) providers.add(key);
      }
      if (typeof file.provider === 'string') {
        const key = file.provider.trim().toLowerCase();
        if (key) providers.add(key);
      }
    });
    return Array.from(providers);
  }, [excluded, files, modelAlias]);

  useEffect(() => {
    if (viewMode !== 'diagram') return;
    if (providerList.length === 0) return;

    void Promise.allSettled(providerList.map((provider) => loadProviderModels(provider)));
  }, [loadProviderModels, providerList, viewMode]);

  const allProviderModels = useMemo(() => {
    if (viewMode !== 'diagram') return {};

    const nextModels: Record<string, AuthFileModelItem[]> = {};
    providerList.forEach((provider) => {
      if (providerModelErrors[provider] === 'unsupported') return;
      const models = providerModelsByProvider[provider] ?? [];
      if (models.length > 0) {
        nextModels[provider] = models;
      }
    });
    return nextModels;
  }, [providerList, providerModelErrors, providerModelsByProvider, viewMode]);

  const loadExcluded = useCallback(async (force: boolean = false) => {
    try {
      await loadExcludedSnapshot({ force });
      excludedUnsupportedRef.current = false;
    } catch (err: unknown) {
      const status =
        typeof err === 'object' && err !== null && 'status' in err
          ? (err as { status?: unknown }).status
          : undefined;

      if (status === 404) {
        if (!excludedUnsupportedRef.current) {
          excludedUnsupportedRef.current = true;
          showNotification(t('oauth_excluded.upgrade_required'), 'warning');
        }
        return;
      }

      const errorMessage = err instanceof Error ? err.message : t('common.unknown_error');
      showNotification(`${t('oauth_excluded.load_failed')}: ${errorMessage}`, 'error');
    }
  }, [loadExcludedSnapshot, showNotification, t]);

  const loadModelAlias = useCallback(async (force: boolean = false) => {
    try {
      await loadModelAliasSnapshot({ force });
      mappingsUnsupportedRef.current = false;
    } catch (err: unknown) {
      const status =
        typeof err === 'object' && err !== null && 'status' in err
          ? (err as { status?: unknown }).status
          : undefined;

      if (status === 404) {
        if (!mappingsUnsupportedRef.current) {
          mappingsUnsupportedRef.current = true;
          showNotification(t('oauth_model_alias.upgrade_required'), 'warning');
        }
        return;
      }

      const errorMessage = err instanceof Error ? err.message : t('common.unknown_error');
      showNotification(`${t('notification.refresh_failed')}: ${errorMessage}`, 'error');
    }
  }, [loadModelAliasSnapshot, showNotification, t]);

  useEffect(() => {
    if (excludedError !== 'unsupported' || excludedUnsupportedRef.current) return;
    excludedUnsupportedRef.current = true;
    showNotification(t('oauth_excluded.upgrade_required'), 'warning');
  }, [excludedError, showNotification, t]);

  useEffect(() => {
    if (modelAliasError !== 'unsupported' || mappingsUnsupportedRef.current) return;
    mappingsUnsupportedRef.current = true;
    showNotification(t('oauth_model_alias.upgrade_required'), 'warning');
  }, [modelAliasError, showNotification, t]);

  const deleteExcluded = useCallback(
    (provider: string) => {
      const providerLabel = provider.trim() || provider;
      showConfirmation({
        title: t('common.delete'),
        message: t('oauth_excluded.delete_confirm', { provider: providerLabel }),
        variant: 'danger',
        confirmText: t('common.confirm'),
        onConfirm: async () => {
          const providerKey = normalizeProviderKey(provider);
          if (!providerKey) {
            showNotification(t('oauth_excluded.provider_required'), 'error');
            return;
          }
          try {
            await deleteOauthExcludedEntry(providerKey);
            showNotification(t('oauth_excluded.delete_success'), 'success');
          } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : '';
            showNotification(`${t('oauth_excluded.delete_failed')}: ${errorMessage}`, 'error');
          }
        }
      });
    },
    [excluded, showConfirmation, showNotification, t]
  );

  const deleteModelAlias = useCallback(
    (provider: string) => {
      showConfirmation({
        title: t('common.delete'),
        message: t('oauth_model_alias.delete_confirm', { provider }),
        variant: 'danger',
        confirmText: t('common.confirm'),
        onConfirm: async () => {
          try {
            await deleteOauthModelAlias(provider);
            showNotification(t('oauth_model_alias.delete_success'), 'success');
          } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : '';
            showNotification(`${t('oauth_model_alias.delete_failed')}: ${errorMessage}`, 'error');
          }
        }
      });
    },
    [showConfirmation, showNotification, t]
  );

  const handleMappingUpdate = useCallback(
    async (provider: string, sourceModel: string, newAlias: string) => {
      if (!provider || !sourceModel || !newAlias) return;
      const normalizedProvider = normalizeProviderKey(provider);
      if (!normalizedProvider) return;

      const providerKey = Object.keys(modelAlias).find(
        (key) => normalizeProviderKey(key) === normalizedProvider
      );
      const currentMappings = (providerKey ? modelAlias[providerKey] : null) ?? [];

      const nameTrim = sourceModel.trim();
      const aliasTrim = newAlias.trim();
      const nameKey = nameTrim.toLowerCase();
      const aliasKey = aliasTrim.toLowerCase();

      if (
        currentMappings.some(
          (m) =>
            (m.name ?? '').trim().toLowerCase() === nameKey &&
            (m.alias ?? '').trim().toLowerCase() === aliasKey
        )
      ) {
        return;
      }

      const nextMappings: OAuthModelAliasEntry[] = [
        ...currentMappings,
        { name: nameTrim, alias: aliasTrim, fork: true }
      ];

      try {
        await saveOauthModelAlias(normalizedProvider, nextMappings);
        showNotification(t('oauth_model_alias.save_success'), 'success');
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : '';
        showNotification(`${t('oauth_model_alias.save_failed')}: ${errorMessage}`, 'error');
      }
    },
    [modelAlias, showNotification, t]
  );

  const handleDeleteLink = useCallback(
    (provider: string, sourceModel: string, alias: string) => {
      const nameTrim = sourceModel.trim();
      const aliasTrim = alias.trim();
      if (!provider || !nameTrim || !aliasTrim) return;

      showConfirmation({
        title: t('oauth_model_alias.delete_link_title', { defaultValue: 'Unlink mapping' }),
        message: (
          <Trans
            i18nKey="oauth_model_alias.delete_link_confirm"
            values={{ provider, sourceModel: nameTrim, alias: aliasTrim }}
            components={{ code: <code /> }}
          />
        ),
        variant: 'danger',
        confirmText: t('common.confirm'),
        onConfirm: async () => {
          const normalizedProvider = normalizeProviderKey(provider);
          const providerKey = Object.keys(modelAlias).find(
            (key) => normalizeProviderKey(key) === normalizedProvider
          );
          const currentMappings = (providerKey ? modelAlias[providerKey] : null) ?? [];
          const nameKey = nameTrim.toLowerCase();
          const aliasKey = aliasTrim.toLowerCase();
          const nextMappings = currentMappings.filter(
            (m) =>
              (m.name ?? '').trim().toLowerCase() !== nameKey ||
              (m.alias ?? '').trim().toLowerCase() !== aliasKey
          );
          if (nextMappings.length === currentMappings.length) return;

          try {
            if (nextMappings.length === 0) {
              await deleteOauthModelAlias(normalizedProvider);
            } else {
              await saveOauthModelAlias(normalizedProvider, nextMappings);
            }
            showNotification(t('oauth_model_alias.save_success'), 'success');
          } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : '';
            showNotification(`${t('oauth_model_alias.save_failed')}: ${errorMessage}`, 'error');
          }
        }
      });
    },
    [modelAlias, showConfirmation, showNotification, t]
  );

  const handleToggleFork = useCallback(
    async (provider: string, sourceModel: string, alias: string, fork: boolean) => {
      const normalizedProvider = normalizeProviderKey(provider);
      if (!normalizedProvider) return;

      const providerKey = Object.keys(modelAlias).find(
        (key) => normalizeProviderKey(key) === normalizedProvider
      );
      const currentMappings = (providerKey ? modelAlias[providerKey] : null) ?? [];
      const nameKey = sourceModel.trim().toLowerCase();
      const aliasKey = alias.trim().toLowerCase();
      let changed = false;

      const nextMappings = currentMappings.map((m) => {
        const mName = (m.name ?? '').trim().toLowerCase();
        const mAlias = (m.alias ?? '').trim().toLowerCase();
        if (mName === nameKey && mAlias === aliasKey) {
          changed = true;
          return fork ? { ...m, fork: true } : { name: m.name, alias: m.alias };
        }
        return m;
      });

      if (!changed) return;

      try {
        await saveOauthModelAlias(normalizedProvider, nextMappings);
        showNotification(t('oauth_model_alias.save_success'), 'success');
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : '';
        showNotification(`${t('oauth_model_alias.save_failed')}: ${errorMessage}`, 'error');
      }
    },
    [modelAlias, showNotification, t]
  );

  const handleRenameAlias = useCallback(
    async (oldAlias: string, newAlias: string) => {
      const oldTrim = oldAlias.trim();
      const newTrim = newAlias.trim();
      if (!oldTrim || !newTrim || oldTrim === newTrim) return;

      const oldKey = oldTrim.toLowerCase();
      const providersToUpdate = Object.entries(modelAlias).filter(([_, mappings]) =>
        mappings.some((m) => (m.alias ?? '').trim().toLowerCase() === oldKey)
      );

      if (providersToUpdate.length === 0) return;

      let hadFailure = false;
      let failureMessage = '';

      const results = await Promise.allSettled(
        providersToUpdate.map(([provider, mappings]) => {
          const nextMappings = mappings.map((m) =>
            (m.alias ?? '').trim().toLowerCase() === oldKey ? { ...m, alias: newTrim } : m
          );
          return saveOauthModelAlias(provider, nextMappings);
        })
      );

      const failures = results.filter(
        (result): result is PromiseRejectedResult => result.status === 'rejected'
      );

      if (failures.length > 0) {
        hadFailure = true;
        const reason = failures[0].reason;
        failureMessage = reason instanceof Error ? reason.message : String(reason ?? '');
      }

      if (hadFailure) {
        showNotification(
          failureMessage
            ? `${t('oauth_model_alias.save_failed')}: ${failureMessage}`
            : t('oauth_model_alias.save_failed'),
          'error'
        );
      } else {
        showNotification(t('oauth_model_alias.save_success'), 'success');
      }
    },
    [modelAlias, showNotification, t]
  );

  const handleDeleteAlias = useCallback(
    (aliasName: string) => {
      const aliasTrim = aliasName.trim();
      if (!aliasTrim) return;
      const aliasKey = aliasTrim.toLowerCase();
      const providersToUpdate = Object.entries(modelAlias).filter(([_, mappings]) =>
        mappings.some((m) => (m.alias ?? '').trim().toLowerCase() === aliasKey)
      );

      if (providersToUpdate.length === 0) return;

      showConfirmation({
        title: t('oauth_model_alias.delete_alias_title', { defaultValue: 'Delete Alias' }),
        message: (
          <Trans
            i18nKey="oauth_model_alias.delete_alias_confirm"
            values={{ alias: aliasTrim }}
            components={{ code: <code /> }}
          />
        ),
        variant: 'danger',
        confirmText: t('common.confirm'),
        onConfirm: async () => {
          let hadFailure = false;
          let failureMessage = '';

          const results = await Promise.allSettled(
            providersToUpdate.map(([provider, mappings]) => {
              const nextMappings = mappings.filter(
                (m) => (m.alias ?? '').trim().toLowerCase() !== aliasKey
              );
              if (nextMappings.length === 0) {
                return deleteOauthModelAlias(provider);
              }
              return saveOauthModelAlias(provider, nextMappings);
            })
          );

          const failures = results.filter(
            (result): result is PromiseRejectedResult => result.status === 'rejected'
          );

          if (failures.length > 0) {
            hadFailure = true;
            const reason = failures[0].reason;
            failureMessage = reason instanceof Error ? reason.message : String(reason ?? '');
          }

          if (hadFailure) {
            showNotification(
              failureMessage
                ? `${t('oauth_model_alias.delete_failed')}: ${failureMessage}`
                : t('oauth_model_alias.delete_failed'),
              'error'
            );
          } else {
            showNotification(t('oauth_model_alias.delete_success'), 'success');
          }
        }
      });
    },
    [modelAlias, showConfirmation, showNotification, t]
  );

  return {
    excluded,
    excludedError,
    modelAlias,
    modelAliasError,
    providerModelErrors,
    allProviderModels,
    providerList,
    loadExcluded,
    loadModelAlias,
    deleteExcluded,
    deleteModelAlias,
    handleMappingUpdate,
    handleDeleteLink,
    handleToggleFork,
    handleRenameAlias,
    handleDeleteAlias
  };
}
