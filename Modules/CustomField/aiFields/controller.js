const logger = require('../../../Config/loggerConfig');
const { tenantOf, TenantError } = require('../../../Config/tenant');
const fill = require('./fill');
const jobs = require('./jobs');

const send = (res, data) => res.json({ status: true, statusText: 'OK', data });

const refuse = (res, statusCode, message, code) => res.status(statusCode).json({ status: false, statusText: message, message, ...(code ? { code } : {}) });

const handle = (label, work) => async (req, res) => {
    let companyId;
    try {
        companyId = tenantOf(req);
    } catch (error) {
        if (error instanceof TenantError) return refuse(res, error.statusCode, error.message);
        throw error;
    }
    try {
        return send(res, await work({ req, companyId, uid: String(req.uid || '') }));
    } catch (error) {
        if (error instanceof fill.AiFieldError) return refuse(res, error.statusCode, error.message, error.code);
        logger.error(`[ai-fields] ${label}: ${(error && error.message) || error}`);
        return refuse(res, 500, 'The AI field could not be filled.');
    }
};

const body = (req) => req.body || {};

exports.preview = handle('preview', ({ req, companyId, uid }) => fill.proposeFills({
    companyId, uid, fieldId: req.params.fieldId, taskIds: body(req).taskIds,
}));

exports.apply = handle('apply', ({ req, companyId, uid }) => fill.applyProposals({
    companyId, uid, fieldId: req.params.fieldId, proposalIds: body(req).proposalIds,
}));

exports.startJob = handle('start job', async ({ req, companyId, uid }) => {
    const { job, done } = await jobs.startJob({
        companyId, uid, fieldId: req.params.fieldId, taskIds: body(req).taskIds, proposalIds: body(req).proposalIds,
    });
    done.catch(fill.logFailure(`job ${job._id}`));
    return job;
});

exports.readJob = handle('read job', async ({ req, companyId, uid }) => {
    const job = await jobs.readJob({ companyId, uid, jobId: req.params.jobId });
    if (!job) throw new fill.AiFieldError(404, 'Job not found.');
    return job;
});
