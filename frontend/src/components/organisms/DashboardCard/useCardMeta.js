import { inject, reactive } from 'vue';

export const CARD_META_KEY = 'dashboardCardMeta';

/* How long a card waits for something that must report before it says it failed. */
export const REPORT_TIMEOUT_MS = 15000;

/**
 * How a card body reports to the DashboardCard around it. The body stays mounted and the shell
 * draws what it reports, so a body sets `state` on every load: 'loading' when it starts, then
 * 'ready', 'empty' or 'error'. A body that never sets it is shown as failed after a timeout.
 *
 * `note` is the footer caption, `emptyText` and `emptyAction` replace the catalogue's empty
 * copy, and `error` replaces the generic error line. `updatedAt` is when the shown data was
 * computed, for a body that shows something older than its last load; the footer counts from it.
 *
 * Outside a DashboardCard the body gets a detached object, so it still renders on its own.
 */
export function useCardMeta() {
    return inject(CARD_META_KEY, () => reactive({ state: '', note: '', updatedAt: null, emptyText: '', emptyAction: '', error: '' }), true);
}
