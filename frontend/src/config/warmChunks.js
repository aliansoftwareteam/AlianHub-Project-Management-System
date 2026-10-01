import { loadTaskDetailPanel } from '@/components/organisms/TaskDetailOverlay/lazyPanel';
import { CUSTOM_FIELD_LOADERS } from '@/plugins/customFieldView/customFieldPlugin';

const IDLE_TIMEOUT_MS = 5000;
const NO_IDLE_CALLBACK_DELAY_MS = 2000;

const whenIdle = (work) => {
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(work, { timeout: IDLE_TIMEOUT_MS });
    else setTimeout(work, NO_IDLE_CALLBACK_DELAY_MS);
};

const WORKSPACE_LOADERS = [loadTaskDetailPanel, ...Object.values(CUSTOM_FIELD_LOADERS)];

let warmed = false;

/* The first paint no longer carries the task panel or the field components, but the first minute of
 * work nearly always needs them: they are fetched once the shell is up and the browser is idle.
 * A failed fetch is dropped here; the component asks again when it renders. */
export const warmWorkspaceChunks = (loaders = WORKSPACE_LOADERS) => {
    if (warmed) return;
    warmed = true;
    whenIdle(() => loaders.forEach((load) => load().catch(() => {})));
};
