/* The panel and what it draws with (the block editor, attachments, comments, recording) are a
 * third of the app's own code. The host stays in the shell; the panel arrives in its own chunk. */
export const loadTaskDetailPanel = () => import(/* webpackChunkName: "task-detail" */ "./TaskDetailPanel.vue");
