const crypto = require('crypto');
const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { tenantOf, TenantError } = require('../../../Config/tenant');
const { ACTIVE_SEAT } = require('../../../Config/seatStatus');
const { isPrivileged } = require('../../../Config/roleTypes');
const logger = require('../../../Config/loggerConfig');
const { visibleProjectIds } = require('../../Agents/scope');
const { hiddenSprintIds } = require('../../Sprints/helpers/sprintVisibility');
const {
    EverythingRefused, parseRequest, scopedProjectIds, projectMatch, buildMatch, pagePipeline, positionOf,
    groupPipeline, shapeGroups, queryBinding, encodeCursor, decodeCursor,
} = require('../helpers/everythingQuery');

const PROJECT_CARD_FIELDS = { ProjectName: 1, ProjectCode: 1, projectIcon: 1, taskStatusData: 1, taskTypeCounts: 1, statusType: 1, isPersonal: 1 };

/* Without JWT_SECRET a cursor is signed with a key that lasts as long as the process, so a
 * restart only ends the pages in flight. */
const PROCESS_KEY = crypto.randomBytes(32);
const cursorKey = () => (process.env.JWT_SECRET
    ? crypto.createHmac('sha256', process.env.JWT_SECRET).update('everything-cursor').digest()
    : PROCESS_KEY);

const refuse = (res, statusCode, statusText, message, extra = {}) => res.status(statusCode).json({ status: false, statusText, message, ...extra });

const objectId = (id) => new mongoose.Types.ObjectId(String(id));
const aggregateTasks = (companyId, pipeline) => MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [pipeline] }, 'aggregate');

/* The projects the request reads: what the caller can open (a narrowed token's list included),
 * less trashed, archived and, unless asked for, closed ones. A project the request names can only
 * narrow that set. */
const readableProjectIds = async (companyId, uid, request) => {
    const candidates = scopedProjectIds(await visibleProjectIds(companyId, uid), request.filter.projectIds);
    if (!candidates.length) return [];
    const projects = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECTS,
        data: [projectMatch(candidates, uid, request.includeClosedProjects), { _id: 1 }, { lean: true }],
    }, 'find');
    return (projects || []).map((project) => String(project._id));
};

const readPage = async (companyId, match, request, after) => {
    const { sort, limit } = request;
    const rows = [];
    if (!after || after.value !== null) {
        rows.push(...await aggregateTasks(companyId, pagePipeline(match, sort, { segment: 'dated', after, limit: limit + 1 })));
    }
    if (rows.length <= limit) {
        const undatedAfter = after && after.value === null ? after : null;
        rows.push(...await aggregateTasks(companyId, pagePipeline(match, sort, { segment: 'undated', after: undatedAfter, limit: limit + 1 - rows.length })));
    }
    return { rows: rows.slice(0, limit), more: rows.length > limit };
};

const projectCards = async (companyId, uid, projectIds) => {
    if (!projectIds.length) return {};
    const projects = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECTS,
        data: [projectMatch(projectIds, uid, true), PROJECT_CARD_FIELDS, { lean: true }],
    }, 'find');
    return Object.fromEntries((projects || []).map((project) => [String(project._id), {
        _id: String(project._id),
        ProjectName: project.ProjectName,
        ProjectCode: project.ProjectCode,
        projectIcon: project.projectIcon,
        taskStatusData: project.taskStatusData || [],
        taskTypeCounts: project.taskTypeCounts || [],
        statusType: project.statusType,
        isPersonal: project.isPersonal === true,
    }]));
};

const nothingToRead = (request) => ({ rows: [], groups: request.cursor ? null : shapeGroups([], request.group), nextCursor: null, projects: {} });

exports.listEverything = async (req, res) => {
    try {
        const companyId = tenantOf(req);
        const uid = String(req.uid || '');
        if (!uid) return refuse(res, 401, 'Unauthorized', 'Sign in to list tasks.');

        const seat = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.COMPANY_USERS,
            data: [{ userId: uid, ...ACTIVE_SEAT }, { roleType: 1, _id: 0 }],
        }, 'findOne');
        if (!seat) return refuse(res, 403, 'Forbidden', 'An active seat in this company is required.');

        const request = parseRequest(req.body);
        const binding = queryBinding({ companyId, uid }, request);
        const after = request.cursor ? decodeCursor(request.cursor, binding, cursorKey()) : null;

        const projectIds = await readableProjectIds(companyId, uid, request);
        if (!projectIds.length) {
            return res.status(200).json({ status: true, statusText: 'Tasks fetched successfully.', data: nothingToRead(request) });
        }
        const projects = projectIds.map(objectId);
        const hidden = isPrivileged(seat.roleType) ? [] : await hiddenSprintIds(companyId, uid, projects);
        const match = buildMatch(request, { projectIds: projects, hiddenSprintIds: hidden });

        const [page, counted] = await Promise.all([
            readPage(companyId, match, request, after),
            after ? null : aggregateTasks(companyId, groupPipeline(match, request)),
        ]);
        const groups = counted ? shapeGroups(counted, request.group) : null;
        const named = new Set(page.rows.map((row) => String(row.ProjectID)));
        if (groups && request.group === 'project') groups.forEach((group) => named.add(group.key));

        return res.status(200).json({
            status: true,
            statusText: 'Tasks fetched successfully.',
            data: {
                rows: page.rows,
                groups,
                nextCursor: page.more ? encodeCursor(positionOf(page.rows[page.rows.length - 1], request.sort), binding, cursorKey()) : null,
                projects: await projectCards(companyId, uid, [...named]),
            },
        });
    } catch (error) {
        if (error instanceof EverythingRefused) return refuse(res, 400, 'Request refused', error.message, { field: error.field });
        if (error instanceof TenantError) return refuse(res, error.statusCode, 'Forbidden', error.message);
        logger.error(`listEverything error: ${error.message || error}`);
        return refuse(res, 500, 'An error occurred while listing tasks.', 'An error occurred while listing tasks.');
    }
};
