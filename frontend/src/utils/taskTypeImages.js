/* The task types a company starts with name an image its storage is seeded with once, at
   `setting/task_type/`. Where that seed is not on disk (storage moved, restored or never copied)
   every icon was a signed URL and then a 404. The app ships the same four images, so these paths
   are shown from its own assets and storage is never asked for them. */
const BUNDLED = new Map([
    ['setting/task_type/task.png', require('@/assets/images/task_type/task.png')],
    ['setting/task_type/bug.png', require('@/assets/images/task_type/bug.png')],
    ['setting/task_type/subtask.png', require('@/assets/images/task_type/subtask.png')],
    ['setting/task_type/design.png', require('@/assets/images/task_type/design.png')]
]);

export const bundledTaskTypeImage = (path) => BUNDLED.get(path) || '';
