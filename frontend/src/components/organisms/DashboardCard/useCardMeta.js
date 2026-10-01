import { inject, reactive } from 'vue';

export const CARD_META_KEY = 'dashboardCardMeta';

/**
 * How a card body reports to the DashboardCard around it. The body stays mounted and the shell
 * draws what it reports, so a body sets `state` on every load: 'loading' when it starts, then
 * 'ready', 'empty' or 'error'. A body that never sets it is shown as failed after a timeout.
 *
 * `note` is the footer caption, `emptyText` and `emptyAction` replace the catalogue's empty
 * copy, and `error` replaces the generic error line.
 *
 * Outside a DashboardCard the body gets a detached object, so it still renders on its own.
 */
export function useCardMeta() {
    return inject(CARD_META_KEY, () => reactive({ state: '', note: '', updatedAt: null, emptyText: '', emptyAction: '', error: '' }), true);
}
