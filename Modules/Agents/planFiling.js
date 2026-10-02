const permissions = require('./permissions');
const setup = require('./setupRequests');
const plans = require('./projectSetup');
const projects = require('./projectCreate');
const planWork = require('./planWork');
const { storedProject } = require('./taskRequests');

// A plan is one thing whatever road files it. Its parts are kept under one set of keys, so the card, the approver's
// choice of parts (./planChoice.js) and the executor read the same plan, and every road asks the same questions
// before a person is asked to approve it: nobody approves a part that cannot be made.

const SETUP = 'project.setup';
const DENIED = permissions.REASON;
const NO_PROJECT = 'project not found';
const REFUSED = Object.freeze({
    parts: `${DENIED}: the person behind this token may not make these parts of the plan by hand`,
    project: `${DENIED}: the person behind this token may not create a project by hand`,
});

const objectOf = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const idText = (value) => String(value === undefined || value === null ? '' : value).slice(0, 40);

const KINDS = Object.freeze({
    [SETUP]: { stored: (given) => ({ projectId: idText(given.projectId), ...plans.setupPlanOf(given) }), problem: plans.setupProblem },
    [projects.ACTION]: { stored: projects.draftOf, problem: projects.problemIn },
});
const kindOf = (action) => (Object.hasOwn(KINDS, String(action)) ? KINDS[String(action)] : null);
const isPlan = (action) => Boolean(kindOf(action));

/* The params a plan is kept with, whatever keys its caller used; any other change keeps its own. */
const storedParams = (action, params) => (isPlan(action) ? kindOf(action).stored(objectOf(params)) : params);

/* '' for a change that is no plan, or a plan every part of which can be asked for; otherwise what is wrong with it. */
const problemIn = (action, params) => (isPlan(action) ? kindOf(action).problem(objectOf(params)) : '');

const partsRefused = (refused) => `${REFUSED.parts}: ${refused.map((entry) => `${entry.part} (${entry.reason})`).join('; ')}`;

/* What stops a plan for a project that exists from being filed for this caller: { refused } where its person may
 * not make one of its parts by hand, or could not ask for one of its automations or first tasks in a call of its
 * own; { error } where a view has nothing to start from or a rule or a task names what is in neither the plan nor
 * the project; null where nothing does. `mayManage` says whether the caller holds what the task tools need. */
const setupStopped = async ({ companyId, actor, uid, allowedActions, mayManage, project, params }) => {
    const plan = plans.setupPlanOf(params);
    const refused = await plans.refusedParts(companyId, uid, String(project._id), plan);
    if (refused.length) return { refused: partsRefused(refused) };
    const kind = (plan.views || []).map((view) => view.kind).find((wanted) => !setup.sourceView(project, wanted));
    if (kind) return { error: setup.noSource(kind) };
    return planWork.filingProblem({ companyId, actor, uid: String(uid), allowedActions, mayManage, project, plan });
};

/* { refused } where the person may not create a project by hand, or may not make a part of its plan; otherwise null. */
const projectStopped = async ({ companyId, uid, params }) => {
    const refused = await projects.refusedFor(companyId, uid, projects.draftOf(params));
    const reason = (refused.project && `${REFUSED.project} (${refused.project})`) || (refused.parts.length && partsRefused(refused.parts));
    return reason ? { refused: reason } : null;
};

/* The same questions for a change filed with no tool call around it: what is wrong with the plan, then what stops it. */
const stoppedFor = async ({ companyId, actor, uid, allowedActions, action, params }) => {
    const problem = problemIn(action, params);
    if (problem) return { error: problem };
    if (action === projects.ACTION) return projectStopped({ companyId, uid, params });
    if (action !== SETUP) return null;
    const project = await storedProject(companyId, objectOf(params).projectId).catch(() => null);
    if (!project) return { error: NO_PROJECT };
    return setupStopped({ companyId, actor, uid, allowedActions, mayManage: true, project, params });
};

module.exports = { REFUSED, isPlan, storedParams, problemIn, setupStopped, projectStopped, stoppedFor };
