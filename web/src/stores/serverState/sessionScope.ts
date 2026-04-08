import { useAuthStore } from '@/stores/useAuthStore';

const normalizeScopePart = (value: string | null | undefined) => String(value ?? '').trim();

export const buildSessionScopeKey = (
  apiBase: string | null | undefined,
  managementKey: string | null | undefined
) => `${normalizeScopePart(apiBase)}::${normalizeScopePart(managementKey)}`;

export const getCurrentSessionScopeKey = (): string => {
  const { apiBase = '', managementKey = '' } = useAuthStore.getState();
  return buildSessionScopeKey(apiBase, managementKey);
};

export const useSessionScopeKey = (): string => {
  const apiBase = useAuthStore((state) => state.apiBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  return buildSessionScopeKey(apiBase, managementKey);
};
