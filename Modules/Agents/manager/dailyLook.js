const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { idForms } = require('../../../utils/mongo-handler/objectIdKeys');
const logger = require('../../../Config/loggerConfig');
const { DAY_MS, localDayStart } = require('../../../utils/localDay');
const { workingDaysOf } = require('../../Company/helpers/companyWeek');
const { CLOSED_STATUS_TYPES } = require('../../Tasks/helpers/taskSignals');
const proposals = require('../proposals');
const rules = require('./rules');
const findings = require('./findings');

// The look a project gets once on each of its working days: read a bounded slice of its open work, let the rules
// say what needs attention, and file what is new. Nothing is changed here; a ready change waits as a proposal.

const CAPS = Object.freeze({ TASKS_READ: 500, FILED_PER_DAY: 10 });
// Tasks with a due date are read first, soonest first, so a large undated backlog cannot crowd them out.
const DATED_SHARE = 300;
const PLANS_READ = 2000;
const COMPANY_CONCURRENCY = 5;
const SYSTEM_AGENT_ID = 'project-manager';
const SYSTEM_ACTIONS = Object.freeze(['task.comment', 'task.update']);
const WITHDRAWN = 'no_longer_needed';
const LOG_PREFIX = '[project-look]';
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const TASK_FIELDS = {
    TaskName: 1, TaskKey: 1, ProjectID: 1, sprintId: 1, statusType: 1, status: 1, DueDate: 1, startDate: 1, relations: 1,
    AssigneeUserId: 1, totalEstimatedTime: 1, points: 1, origin: 1, updatedAt: 1,
};
const { STATUS } = findings;
const DECISION = proposals.STATUS;
const REFUSED_BY_A_PERSON = [DECISION.DECLINED, DECISION.UNDONE];
const ANSWERED = [DECISION.APPROVED, DECISION.EDITED, DECISION.APPLYING, DECISION.FAILED];

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const dayOf = (now) => new Date(now).toISOString().slice(0, 10);
const find = async (companyId, type, data) => (await MongoDbCrudOpration(companyId, { type, data }, 'find')) || [];

const readTasks = async (companyId, projectId) => {
    const open = { ProjectID: { $in: idForms([String(projectId)]) }, deletedStatusKey: { $ne: 1 }, mainChat: { $ne: true }, statusType: { $nin: CLOSED_STATUS_TYPES } };
    const dated = await find(companyId, SCHEMA_TYPE.TASKS, [{ ...open, DueDate: { $type: 'date' } }, TASK_FIELDS, { sort: { DueDate: 1 }, limit: DATED_SHARE }]);
    const undated = await find(companyId, SCHEMA_TYPE.TASKS, [{ ...open, DueDate: null }, TASK_FIELDS, { sort: { updatedAt: 1 }, limit: CAPS.TASKS_READ - dated.length }]);
    return [...dated, ...undated];
};

const readBlockers = async (companyId, tasks) => {
    const read = new Set(tasks.map((task) => String(task._id)));
    const wanted = [...new Set(tasks.flatMap((task) => (Array.isArray(task.relations) ? task.relations : []))
        .filter((relation) => relation && relation.type === 'blocked_by' && OBJECT_ID.test(String(relation.taskId)) && !read.has(String(relation.taskId)))
        .map((relation) => String(relation.taskId)))].slice(0, CAPS.TASKS_READ);
    return wanted.length
        ? find(companyId, SCHEMA_TYPE.TASKS, [{ _id: { $in: wanted.map(oid) }, deletedStatusKey: { $ne: 1 } }, TASK_FIELDS])
        : [];
};

const readPlans = async (companyId, projectId, now) => {
    const { start, end } = rules.weekOf(now);
    const plans = await find(companyId, SCHEMA_TYPE.ESTIMATES_TIME, [
        { ProjectId: { $in: idForms([String(projectId)]) }, Date: { $gte: start, $lt: new Date(end.getTime() + DAY_MS) } },
        { TaskId: 1, UserId: 1, Date: 1, EstimatedTime: 1 }, { limit: PLANS_READ },
    ]);
    const people = [...new Set(plans.map((plan) => String(plan.UserId)))];
    const pto = people.length
        ? await find(companyId, SCHEMA_TYPE.PTO_ENTRIES, [{ userId: { $in: people }, status: 'approved', deletedStatusKey: { $ne: 1 }, startDate: { $lte: end }, endDate: { $gte: start } }])
        : [];
    return { plans, pto };
};

const decisionsOf = async (companyId, rows) => {
    const ids = rows.map((row) => row.proposalId).filter((id) => OBJECT_ID.test(String(id || '')));
    const decided = ids.length ? await find(companyId, SCHEMA_TYPE.AGENT_PROPOSALS, [{ _id: { $in: ids.map(oid) } }, { status: 1, decidedBy: 1 }]) : [];
    return new Map(decided.map((proposal) => [String(proposal._id), proposal]));
};

/* A change a person refused is never offered again; one a person approved is not asked again while its cause lasts. */
const afterDecision = (row, decision) => {
    if (row.status !== STATUS.OPEN || !decision || decision.decidedBy === proposals.SYSTEM_DECIDER) return row.status;
    if (REFUSED_BY_A_PERSON.includes(decision.status)) return STATUS.DECLINED;
    return ANSWERED.includes(decision.status) ? STATUS.HANDLED : row.status;
};

const propose = async (companyId, project, row, finding) => {
    const { action, params, label, what, why } = finding.fix;
    const proposal = await proposals.create(companyId, {
        agent: { _id: SYSTEM_AGENT_ID, name: `System for ${project.ProjectName || 'this project'}` },
        taskId: params.taskId, projectId: String(project._id), what, why, changes: [{ action, params, label }],
        source: proposals.SOURCE_SYSTEM, allowedActions: SYSTEM_ACTIONS,
        finding: { id: String(row._id), rule: finding.rule, facts: finding.facts, projectName: project.ProjectName || '' },
    });
    await findings.attach(companyId, row, proposal._id);
};

const reconcile = async (companyId, project, found, now) => {
    const projectId = String(project._id);
    const foundByKey = new Map(found.map((finding) => [finding.key, finding]));
    const rows = await findings.standing(companyId, projectId, [...foundByKey.keys()]);
    const decisions = await decisionsOf(companyId, rows.filter((row) => row.status === STATUS.OPEN));
    const rowByKey = new Map();

    for (const row of rows) {
        const decision = decisions.get(String(row.proposalId || ''));
        const finding = foundByKey.get(row.key);
        const status = afterDecision(row, decision);
        rowByKey.set(row.key, { ...row, status });
        if ([STATUS.OPEN, STATUS.HANDLED].includes(status) && !finding) {
            // eslint-disable-next-line no-await-in-loop
            if (decision && decision.status === DECISION.PENDING) await proposals.withdraw(companyId, row.proposalId, WITHDRAWN);
            // eslint-disable-next-line no-await-in-loop
            await findings.settle(companyId, row, STATUS.CLOSED, now);
        } else if (status !== row.status) {
            // eslint-disable-next-line no-await-in-loop
            await findings.settle(companyId, row, status, now);
        } else if (status === STATUS.OPEN) {
            // eslint-disable-next-line no-await-in-loop
            await findings.refresh(companyId, row, finding, now);
        }
    }

    const room = CAPS.FILED_PER_DAY - await findings.openedSince(companyId, projectId, localDayStart(now, 0));
    const fresh = found.filter((finding) => !rowByKey.has(finding.key) || rowByKey.get(finding.key).status === STATUS.CLOSED).slice(0, Math.max(0, room));
    let filed = 0;
    for (const finding of fresh) {
        const closedRow = rowByKey.get(finding.key);
        // eslint-disable-next-line no-await-in-loop
        const row = await findings.open(companyId, projectId, finding, now, closedRow);
        if (!row) continue;
        filed += 1;
        // eslint-disable-next-line no-await-in-loop
        if (finding.fix) await propose(companyId, project, row, finding);
    }
    return filed;
};

/* The mark is taken before anything is read, so two servers running the job cannot both look; it is given back
 * only when the look failed, and the hour after tries again. null when there was nothing to do today. */
const lookAt = async (companyId, project, now = new Date()) => {
    const week = await workingDaysOf(companyId, String(project._id));
    if (!rules.isWorkingDay(now, week)) return null;
    const today = dayOf(now);
    const claimed = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECTS,
        data: [{ _id: oid(project._id), 'agentManager.on': true, agentManagerLookedOn: { $ne: today } }, { $set: { agentManagerLookedOn: today } }, { projection: { ProjectName: 1 } }],
    }, 'findOneAndUpdate');
    if (!claimed) return null;
    try {
        const tasks = await readTasks(companyId, project._id);
        const [blockers, { plans, pto }] = await Promise.all([readBlockers(companyId, tasks), readPlans(companyId, project._id, now)]);
        const found = rules.findingsOf({ tasks, blockers, plans, pto, now, week });
        return { filed: await reconcile(companyId, project, found, now), found: found.length };
    } catch (error) {
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PROJECTS, data: [{ _id: oid(project._id), agentManagerLookedOn: today }, { $unset: { agentManagerLookedOn: '' } }],
        }, 'updateOne').catch(() => {});
        throw error;
    }
};

const runForCompany = async (companyId, now = new Date()) => {
    const projects = await find(companyId, SCHEMA_TYPE.PROJECTS, [
        { 'agentManager.on': true, agentManagerLookedOn: { $ne: dayOf(now) }, deletedStatusKey: { $ne: 1 } }, { ProjectName: 1 },
    ]);
    const totals = { looked: 0, filed: 0 };
    for (const project of projects) {
        try {
            // eslint-disable-next-line no-await-in-loop
            const look = await lookAt(companyId, project, now);
            if (look) { totals.looked += 1; totals.filed += look.filed; }
        } catch (error) {
            logger.error(`${LOG_PREFIX} ${companyId}: project ${project._id} was not looked at: ${error.message || error}`);
        }
    }
    return totals;
};

const runForAllCompanies = async (now = new Date()) => {
    const companies = await find(SCHEMA_TYPE.GOLBAL, SCHEMA_TYPE.COMPANIES, [{}, '_id']);
    const totals = { looked: 0, filed: 0 };
    for (let i = 0; i < companies.length; i += COMPANY_CONCURRENCY) {
        // eslint-disable-next-line no-await-in-loop
        const done = await Promise.all(companies.slice(i, i + COMPANY_CONCURRENCY).map((company) => runForCompany(String(company._id), now).catch((error) => {
            logger.error(`${LOG_PREFIX} ${company._id}: ${error.message || error}`);
            return { looked: 0, filed: 0 };
        })));
        done.forEach((one) => { totals.looked += one.looked; totals.filed += one.filed; });
    }
    return totals;
};

module.exports = { CAPS, SYSTEM_ACTIONS, lookAt, runForCompany, runForAllCompanies };
