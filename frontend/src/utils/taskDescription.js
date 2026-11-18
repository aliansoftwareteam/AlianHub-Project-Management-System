import { descriptionBlockFor } from '@descriptionBlock';

/* A task imported before descriptions were stored as editor documents holds its description as plain text alone. The
   panel shows that text through the same builder the server now uses, escaped, and the first edit saves a document. */
export const shownDescription = (task) => descriptionBlockFor(task) || (task?.descriptionBlock ? task.descriptionBlock : task?.description);
