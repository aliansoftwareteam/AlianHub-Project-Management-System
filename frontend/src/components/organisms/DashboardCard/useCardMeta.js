import { inject, reactive } from 'vue';

export const CARD_META_KEY = 'dashboardCardMeta';

/**
 * The channel a card body uses to talk to the chrome around it (DashboardCard):
 * which state to render, the freshness line, and the empty-state copy.
 *
 * Falls back to a detached object when the body is rendered outside a
 * DashboardCard (the legacy Home grid), so the same card works in both.
 *
 *   const meta = useCardMeta();
 *   meta.state = 'loading' | 'ready' | 'empty' | 'error';
 *   meta.note  = 'top 4 of 19';
 *   meta.updatedAt = Date.now();
 */
export function useCardMeta() {
    return inject(CARD_META_KEY, () => reactive({ state: 'loading', note: '', updatedAt: null, emptyText: '', emptyAction: '' }), true);
}
