import { useAuthStore } from '@/stores/useAuthStore';

const normalizeScopePart = (value: string | null | undefined) => String(value ?? '').trim();

const hashScopeSecret = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export const buildSessionScopeKey = (
  apiBase: string | null | undefined,
  managementKey: string | null | undefined
) => {
  const normalizedApiBase = normalizeScopePart(apiBase);
  const normalizedManagementKey = normalizeScopePart(managementKey);
  return `${normalizedApiBase}::${hashScopeSecret(normalizedManagementKey)}`;
};

export const getCurrentSessionScopeKey = (): string => {
  const { apiBase = '', managementKey = '' } = useAuthStore.getState();
  return buildSessionScopeKey(apiBase, managementKey);
};

export const useSessionScopeKey = (): string => {
  const apiBase = useAuthStore((state) => state.apiBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  return buildSessionScopeKey(apiBase, managementKey);
};
