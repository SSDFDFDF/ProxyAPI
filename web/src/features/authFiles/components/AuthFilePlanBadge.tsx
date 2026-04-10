import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { AuthFileItem } from '@/types';
import { useQuotaStore } from '@/stores';
import { useSessionScopeKey } from '@/stores/serverState/sessionScope';
import { resolveAuthFileQuotaType } from '@/features/authFiles/presentation';
import styles from '@/pages/AuthFilesPage.module.scss';

type AuthFilePlanBadgeProps = {
  file: AuthFileItem;
  compact?: boolean;
};

type PlanBadgeInfo = {
  label: string;
  premium: boolean;
};

const PREMIUM_GEMINI_CLI_TIER_IDS = new Set(['g1-pro-tier', 'g1-ultra-tier']);
const PREMIUM_CLAUDE_PLAN_TYPES = new Set(['plan_max', 'plan_pro']);
const PREMIUM_CODEX_PLAN_TYPES = new Set(['pro']);

const resolveCodexPlanLabel = (
  planType: string | null | undefined,
  t: ReturnType<typeof useTranslation>['t']
) => {
  if (!planType) return null;
  if (planType === 'pro') return t('codex_quota.plan_pro');
  if (planType === 'plus') return t('codex_quota.plan_plus');
  if (planType === 'team') return t('codex_quota.plan_team');
  if (planType === 'free') return t('codex_quota.plan_free');
  return planType;
};

export function AuthFilePlanBadge({ file, compact = false }: AuthFilePlanBadgeProps) {
  const { t } = useTranslation();
  const scopeKey = useSessionScopeKey();
  const quotaType = resolveAuthFileQuotaType(file);

  const codexPlanType = useQuotaStore((state) =>
    quotaType === 'codex' && state.scopeKey === scopeKey
      ? (state.codexQuota[file.name]?.planType ?? null)
      : null
  );
  const claudePlanType = useQuotaStore((state) =>
    quotaType === 'claude' && state.scopeKey === scopeKey
      ? (state.claudeQuota[file.name]?.planType ?? null)
      : null
  );
  const geminiTierLabel = useQuotaStore((state) =>
    quotaType === 'gemini-cli' && state.scopeKey === scopeKey
      ? (state.geminiCliQuota[file.name]?.tierLabel ?? null)
      : null
  );
  const geminiTierId = useQuotaStore((state) =>
    quotaType === 'gemini-cli' && state.scopeKey === scopeKey
      ? (state.geminiCliQuota[file.name]?.tierId ?? null)
      : null
  );

  const badgeInfo = useMemo<PlanBadgeInfo | null>(() => {
    if (quotaType === 'codex') {
      const label = resolveCodexPlanLabel(codexPlanType, t);
      if (!label) return null;
      return {
        label,
        premium: codexPlanType !== null && PREMIUM_CODEX_PLAN_TYPES.has(codexPlanType),
      };
    }

    if (quotaType === 'claude') {
      if (!claudePlanType) return null;
      return {
        label: t(`claude_quota.${claudePlanType}`),
        premium: PREMIUM_CLAUDE_PLAN_TYPES.has(claudePlanType),
      };
    }

    if (quotaType === 'gemini-cli') {
      if (!geminiTierLabel) return null;
      return {
        label: geminiTierLabel,
        premium: geminiTierId !== null && PREMIUM_GEMINI_CLI_TIER_IDS.has(geminiTierId),
      };
    }

    return null;
  }, [claudePlanType, codexPlanType, geminiTierId, geminiTierLabel, quotaType, t]);

  if (!badgeInfo) return null;

  return (
    <span
      className={`${styles.planBadge} ${
        badgeInfo.premium ? styles.planBadgePremium : styles.planBadgeDefault
      } ${compact ? styles.planBadgeCompact : ''}`}
      title={badgeInfo.label}
    >
      {badgeInfo.label}
    </span>
  );
}
