'use strict';

const logger = require('../../../Config/loggerConfig');
const {
    isAiAction,
    gatherAutofillContext,
    previewAutofill,
    applyAutofill,
} = require('../helpers/taskAiAutofillRun');

function callerId(req) {
    return String((req && req.uid) || '');
}

exports.aiAutofill = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const uid = callerId(req);
        const body = req.body || {};
        const action = String(body.action || '').toLowerCase();
        const taskId = body.taskId || body.id;

        if (!companyId) {
            return res.send({ status: false, statusText: 'companyId is required.' });
        }
        if (!isAiAction(action)) {
            return res.send({ status: false, statusText: 'action must be preview or apply.' });
        }

        const context = await gatherAutofillContext({ companyId, uid, taskId });
        if (!context.allowed) {
            return res.send({ status: false, statusText: context.reason || 'Task not found.' });
        }

        const result = action === 'apply'
            ? await applyAutofill(context, body.suggestions)
            : await previewAutofill(context);

        if (!result.status) {
            return res.send({ status: false, statusText: result.reason || 'Could not autofill.' });
        }
        return res.send({ status: true, data: result.data });
    } catch (error) {
        logger.error(`ERROR in task ai-autofill: ${error && error.message ? error.message : error}`);
        return res.send({ status: false, statusText: (error && error.message) || 'Could not autofill.' });
    }
};
