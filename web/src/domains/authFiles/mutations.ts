import { authFilesApi } from '@/services/api';
import {
  isRuntimeOnlyAuthFile,
  normalizeProviderKey,
  type AuthFileModelItem,
} from '@/features/authFiles/constants';
import type { OAuthModelAliasEntry } from '@/types';
import { useAuthFilesOauthStore } from '@/stores/useAuthFilesOauthStore';
import { useAuthFilesStore } from '@/stores/useAuthFilesStore';
import { useProviderModelDefinitionsStore } from '@/stores/useProviderModelDefinitionsStore';
import { getCurrentSessionScopeKey } from '@/stores/serverState/sessionScope';
import { QUOTA_REFRESH_CONCURRENCY } from '@/utils/constants';
import { mapWithConcurrencyLimit } from '@/utils/async';

type BatchStatusResult = {
  successCount: number;
  failCount: number;
  failedNames: string[];
  confirmedDisabledByName: Map<string, boolean>;
  originalDisabledByName: Map<string, boolean>;
};

const normalizeNames = (names: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  names.forEach((name) => {
    const trimmed = String(name ?? '').trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    result.push(trimmed);
  });

  return result;
};

const normalizeExcludedModelsMap = (input: Record<string, string[]>): Record<string, string[]> => {
  const result: Record<string, string[]> = {};

  Object.entries(input).forEach(([provider, models]) => {
    const normalizedProvider = normalizeProviderKey(provider);
    if (!normalizedProvider) return;

    const seen = new Set<string>();
    const normalizedModels: string[] = [];
    (Array.isArray(models) ? models : []).forEach((model) => {
      const trimmed = String(model ?? '').trim();
      if (!trimmed) return;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      normalizedModels.push(trimmed);
    });

    result[normalizedProvider] = normalizedModels;
  });

  return result;
};

const normalizeModelAliasEntries = (entries: OAuthModelAliasEntry[]): OAuthModelAliasEntry[] => {
  const seen = new Set<string>();
  const normalized: OAuthModelAliasEntry[] = [];

  entries.forEach((entry) => {
    const name = String(entry.name ?? '').trim();
    const alias = String(entry.alias ?? '').trim();
    if (!name || !alias) return;

    const fork = entry.fork === true;
    const dedupeKey = `${name.toLowerCase()}::${alias.toLowerCase()}::${fork ? '1' : '0'}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    normalized.push(fork ? { name, alias, fork: true } : { name, alias });
  });

  return normalized;
};

export const refreshAuthFilesList = async (force: boolean = true) =>
  useAuthFilesStore.getState().loadAuthFiles({ force });

export const refreshAuthFilesOauth = async (force: boolean = true) =>
  Promise.all([
    useAuthFilesOauthStore.getState().loadExcluded({ force }),
    useAuthFilesOauthStore.getState().loadModelAlias({ force }),
  ]);

export const refreshProviderModelDefinitions = async (
  provider: string,
  force: boolean = true
): Promise<AuthFileModelItem[]> =>
  useProviderModelDefinitionsStore.getState().loadProviderModels(provider, { force });

export const uploadAuthFiles = async (files: File[]) => {
  const result = await authFilesApi.uploadFiles(files);
  if (result.uploaded > 0) {
    await refreshAuthFilesList(true);
  }
  return result;
};

export const deleteAuthFiles = async (names: string[]) => {
  const requestedNames = normalizeNames(names);
  const scopeKey = getCurrentSessionScopeKey();
  useAuthFilesStore.getState().invalidateAuthFiles(scopeKey);
  const result = await authFilesApi.deleteFiles(requestedNames);

  const deletedNames =
    result.files.length > 0
      ? normalizeNames(result.files)
      : requestedNames.length === 1 && result.deleted > 0
        ? requestedNames
        : [];

  if (deletedNames.length > 0) {
    const deletedSet = new Set(deletedNames);
    useAuthFilesStore.getState().updateAuthFiles(
      (prev) => prev.filter((file) => !deletedSet.has(file.name)),
      scopeKey
    );
  }

  return result;
};

export const deleteAuthFile = async (name: string) => deleteAuthFiles([name]);

export const deleteAllAuthFiles = async () => {
  const scopeKey = getCurrentSessionScopeKey();
  useAuthFilesStore.getState().invalidateAuthFiles(scopeKey);
  await authFilesApi.deleteAll();
  useAuthFilesStore.getState().updateAuthFiles(
    (prev) => prev.filter((file) => isRuntimeOnlyAuthFile(file)),
    scopeKey
  );
};

export const setAuthFileStatus = async (name: string, disabled: boolean) => {
  const scopeKey = getCurrentSessionScopeKey();
  const store = useAuthFilesStore.getState();
  const current = store.files.find((file) => file.name === name);
  const previousDisabled = current?.disabled === true;

  store.updateAuthFiles(
    (prev) => prev.map((file) => (file.name === name ? { ...file, disabled } : file)),
    scopeKey
  );

  try {
    const result = await authFilesApi.setStatus(name, disabled);
    useAuthFilesStore.getState().updateAuthFiles(
      (prev) => prev.map((file) => (file.name === name ? { ...file, disabled: result.disabled } : file)),
      scopeKey
    );
    return result;
  } catch (error) {
    useAuthFilesStore.getState().updateAuthFiles(
      (prev) =>
        prev.map((file) =>
          file.name === name ? { ...file, disabled: previousDisabled } : file
        ),
      scopeKey
    );
    throw error;
  }
};

export const setManyAuthFilesStatus = async (
  names: string[],
  disabled: boolean
): Promise<BatchStatusResult> => {
  const scopeKey = getCurrentSessionScopeKey();
  const uniqueNames = normalizeNames(names);
  const requestedNameSet = new Set(uniqueNames);
  const files = useAuthFilesStore.getState().files;
  const originalDisabledByName = new Map(
    files
      .filter((file) => requestedNameSet.has(file.name))
      .map((file) => [file.name, file.disabled === true])
  );
  const targetNames = Array.from(originalDisabledByName.keys());

  const targetSet = new Set(targetNames);
  useAuthFilesStore.getState().updateAuthFiles(
    (prev) => prev.map((file) => (targetSet.has(file.name) ? { ...file, disabled } : file)),
    scopeKey
  );

  const results = await mapWithConcurrencyLimit(
    targetNames,
    QUOTA_REFRESH_CONCURRENCY,
    async (name): Promise<PromiseSettledResult<Awaited<ReturnType<typeof authFilesApi.setStatus>>>> => {
      try {
        return {
          status: 'fulfilled',
          value: await authFilesApi.setStatus(name, disabled)
        };
      } catch (reason) {
        return {
          status: 'rejected',
          reason
        };
      }
    }
  );

  let successCount = 0;
  let failCount = 0;
  const failedNames: string[] = [];
  const failedNameSet = new Set<string>();
  const confirmedDisabledByName = new Map<string, boolean>();

  results.forEach((result, index) => {
    const name = targetNames[index];
    if (result.status === 'fulfilled') {
      successCount += 1;
      confirmedDisabledByName.set(name, result.value.disabled);
      return;
    }

    failCount += 1;
    failedNames.push(name);
    failedNameSet.add(name);
  });

  useAuthFilesStore.getState().updateAuthFiles(
    (prev) =>
      prev.map((file) => {
        if (failedNameSet.has(file.name)) {
          return { ...file, disabled: originalDisabledByName.get(file.name) === true };
        }
        if (confirmedDisabledByName.has(file.name)) {
          return { ...file, disabled: confirmedDisabledByName.get(file.name) };
        }
        return file;
      }),
    scopeKey
  );

  return {
    successCount,
    failCount,
    failedNames,
    confirmedDisabledByName,
    originalDisabledByName,
  };
};

export const saveAuthFileText = async (
  name: string,
  text: string,
  options: { refresh?: boolean } = {}
) => {
  await authFilesApi.saveText(name, text);
  if (options.refresh !== false) {
    await refreshAuthFilesList(true);
  }
};

export const saveAuthFileJsonObject = async (
  name: string,
  json: Record<string, unknown>,
  options: { refresh?: boolean } = {}
) => {
  await authFilesApi.saveJsonObject(name, json);
  if (options.refresh !== false) {
    await refreshAuthFilesList(true);
  }
};

export const patchAuthFileFields = async (
  payload: {
    name: string;
    prefix?: string;
    proxy_url?: string;
    priority?: number;
    note?: string;
  },
  options: { refresh?: boolean } = {}
) => {
  const result = await authFilesApi.patchFields(payload);
  if (options.refresh !== false) {
    await refreshAuthFilesList(true);
  }
  return result;
};

export const saveOauthExcludedModels = async (provider: string, models: string[]) => {
  const scopeKey = getCurrentSessionScopeKey();
  const normalizedProvider = normalizeProviderKey(provider);
  if (!normalizedProvider) {
    throw new Error('Provider is required');
  }

  const normalizedMap = normalizeExcludedModelsMap({
    [normalizedProvider]: models,
  });
  const nextModels = normalizedMap[normalizedProvider] ?? [];

  await authFilesApi.saveOauthExcludedModels(normalizedProvider, nextModels);
  useAuthFilesOauthStore.getState().updateExcludedSnapshot(
    (prev) => ({
      ...prev,
      [normalizedProvider]: nextModels,
    }),
    null,
    scopeKey
  );
};

export const deleteOauthExcludedEntry = async (provider: string) => {
  const scopeKey = getCurrentSessionScopeKey();
  const normalizedProvider = normalizeProviderKey(provider);
  if (!normalizedProvider) {
    throw new Error('Provider is required');
  }

  await authFilesApi.deleteOauthExcludedEntry(normalizedProvider);
  useAuthFilesOauthStore.getState().updateExcludedSnapshot(
    (prev) => {
      const next = { ...prev };
      delete next[normalizedProvider];
      return next;
    },
    null,
    scopeKey
  );
};

export const replaceOauthExcludedModels = async (map: Record<string, string[]>) => {
  const scopeKey = getCurrentSessionScopeKey();
  const normalizedMap = normalizeExcludedModelsMap(map);
  await authFilesApi.replaceOauthExcludedModels(normalizedMap);
  useAuthFilesOauthStore.getState().updateExcludedSnapshot(() => normalizedMap, null, scopeKey);
};

export const saveOauthModelAlias = async (
  provider: string,
  aliases: OAuthModelAliasEntry[]
) => {
  const scopeKey = getCurrentSessionScopeKey();
  const normalizedProvider = normalizeProviderKey(provider);
  if (!normalizedProvider) {
    throw new Error('Provider is required');
  }

  const normalizedAliases = normalizeModelAliasEntries(aliases);
  await authFilesApi.saveOauthModelAlias(normalizedProvider, normalizedAliases);
  useAuthFilesOauthStore.getState().updateModelAliasSnapshot(
    (prev) => ({
      ...prev,
      [normalizedProvider]: normalizedAliases,
    }),
    null,
    scopeKey
  );
};

export const deleteOauthModelAlias = async (provider: string) => {
  const scopeKey = getCurrentSessionScopeKey();
  const normalizedProvider = normalizeProviderKey(provider);
  if (!normalizedProvider) {
    throw new Error('Provider is required');
  }

  await authFilesApi.deleteOauthModelAlias(normalizedProvider);
  useAuthFilesOauthStore.getState().updateModelAliasSnapshot(
    (prev) => {
      const next = { ...prev };
      delete next[normalizedProvider];
      return next;
    },
    null,
    scopeKey
  );
};
