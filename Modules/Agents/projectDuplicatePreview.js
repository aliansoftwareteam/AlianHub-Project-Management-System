const copies = require('./projectDuplicate');

// The card of a waiting copy of a project (frontend IntentPreview). It names the project it is copied from, so a
// viewer who cannot open that project has no card. The number of tasks is the number that viewer would copy by
// approving it, and `limit` is set when that is more than a copy made this way takes.

const copyPreview = async (change, { named, companyId, uid }) => {
    const draft = copies.draftOf(change && change.params);
    const project = draft.sourceProjectId ? named.project(draft.sourceProjectId).name : null;
    if (!project || !draft.name) return null;
    const source = draft.tasks ? await copies.sourceFor(companyId, [uid], draft.sourceProjectId) : null;
    const count = source ? await copies.taskCount({ companyId, uid, source }) : 0;
    return {
        kind: 'projectCopy',
        title: draft.name,
        lines: [
            { kind: 'copyOf', project },
            { kind: 'copyParts' },
            draft.tasks ? { kind: 'copyTasks', asked: true, count, limit: copies.tooLarge(count) ? copies.TASKS_MAX : 0 } : { kind: 'copyTasks', asked: false },
            draft.dates && { kind: 'copyDates' },
            { kind: 'members', only: 'approver' },
        ].filter(Boolean),
    };
};

/* The project a waiting copy is copied from, or ''. */
const sourceIdOf = (change) => copies.draftOf(change && change.params).sourceProjectId;

module.exports = { BUILDERS: Object.freeze({ [copies.ACTION]: copyPreview }), sourceIdOf };
