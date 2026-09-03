const completionStore = require('../completionStore.js');
const socketEmitter = require('../../../../event/socketEventEmitter');
const logger = require('../../../../Config/loggerConfig');

/* Provenance of Done (handoff 29). A person moving a status is the only thing that
 * can fill closedBy / checkedBy — the agent path does the same through
 * Modules/Agents/actions. Runs after the status is written and never rejects: a
 * provenance failure must not look like a failed status change.
 *
 * Shared by the single-task path (updateBasic.updateStatus) and the bulk path
 * (bulk.bulkUpdateStatus). Bulk re-implements the per-task side effects inline
 * rather than looping updateStatus, so without one shared helper a bulk close
 * silently recorded nothing and the task showed no badge. */
const recordCompletion = ({ companyId, taskId, task, newStatus, userData }) => {
    const actorId = userData && (userData.id || userData._id);
    if (!companyId || !taskId || !actorId) return;
    completionStore.forStatusChange(companyId, taskId, {
        toStatus: { statusType: newStatus.statusType, name: newStatus.status && newStatus.status.text },
        fromStatus: { statusType: task && task.statusType, name: task && task.status && task.status.text },
        actor: { actorId: String(actorId), actorType: 'human' },
    })
    .then((outcome) => {
        if (!outcome || outcome.error || !outcome.completion) return null;
        return completionStore.save(companyId, taskId, outcome.completion).then((saved) => {
            socketEmitter.emit('update', { type: 'update', data: saved, updatedFields: { completion: outcome.completion }, module: 'task' });
        });
    })
    .catch((error) => logger.error(`ERROR in task completion record: ${error.message}`));
};

module.exports = { recordCompletion };
