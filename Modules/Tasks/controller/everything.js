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
const { fetchRules } = require('../../settings/securityPermissions/controller');
const { idForms } = require('../../../utils/mongo-handler/objectIdKeys');
const {
    EverythingRefused, parseRequest, scopedProjectIds, projectMatch, taskListProjectIds, projectPermissions, rowEditRights, buildMatch, pagePipeline, positionOf,
    groupPipeline, shapeGroups, queryBinding, encodeCursor, decodeCursor,
} = require('../helpers/everythingQuery');

const PROJECT_HEADING_FIELDS = { ProjectName: 1, ProjectCode: 1, projectIcon: 1, statusType: 1, isPersonal: 1 };
const PROJECT_CARD_FIELDS = { ...PROJECT_HEADING_FIELDS, taskStatusData: 1, taskTypeCounts: 1, apps: 1, isGlobalPermission: 1 };

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
 * less trashed, archived, restricted and, unless asked for, closed ones, and less the ones whose
 * task list the caller's role may not read. A project the request names can only narrow that set.
 * `permissionOf` reads the caller's role in any of them, and is null for an owner or an admin. */
const readableProjects = async (companyId, uid, roleType, request) => {
    const candidates = scopedProjectIds(await visibleProjectIds(companyId, uid), request.filter.projectIds);
    if (!candidates.length) return { projectIds: [], permissionOf: null };
    const projects = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECTS,
        data: [projectMatch(candidates, uid, request.includeClosedProjects), { _id: 1, isGlobalPermission: 1, isPersonal: 1 }, { lean: true }],
    }, 'find') || [];
    if (isPrivileged(roleType)) return { projectIds: projects.map((project) => String(project._id)), permissionOf: null };

    const withOwnRules = projects.filter((project) => project.isGlobalPermission === false).map((project) => String(project._id));
    const [companyRules, projectRules] = await Promise.all([
        fetchRules(companyId),
        withOwnRules.length
            ? MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PROJECT_RULES, data: [{ projectId: { $in: idForms(withOwnRules) } }, null, { lean: true }] }, 'find')
            : [],
    ]);
    return {
        projectIds: taskListProjectIds(projects, roleType, companyRules, projectRules),
        permissionOf: projectPermissions(roleType, companyRules, projectRules),
    };
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

const readProjects = async (companyId, uid, projectIds, fields) => (projectIds.length
    ? await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PROJECTS, data: [projectMatch(projectIds, uid, true), fields, { lean: true }] }, 'find') || []
    : []);

/* A row needs its project's statuses, task types, apps and edit rights. A project that is only
 * counted needs what its group's heading shows; with hundreds of projects the whole cards were
 * half a megabyte on the request that opens a view grouped by project. */
const projectCards = async (companyId, uid, { onPage, onlyCounted }, permissionOf) => {
    const [whole, headings] = await Promise.all([
        readProjects(companyId, uid, onPage, PROJECT_CARD_FIELDS),
        readProjects(companyId, uid, onlyCounted, PROJECT_HEADING_FIELDS),
    ]);
    return Object.fromEntries([
        ...headings.map((project) => [String(project._id), {
            _id: String(project._id),
            ProjectName: project.ProjectName,
            ProjectCode: project.ProjectCode,
            projectIcon: project.projectIcon,
            statusType: project.statusType,
            isPersonal: project.isPersonal === true,
        }]),
        ...whole.map((project) => [String(project._id), {
            _id: String(project._id),
            ProjectName: project.ProjectName,
            ProjectCode: project.ProjectCode,
            projectIcon: project.projectIcon,
            taskStatusData: project.taskStatusData || [],
            taskTypeCounts: project.taskTypeCounts || [],
            apps: project.apps || [],
            statusType: project.statusType,
            isPersonal: project.isPersonal === true,
            edit: rowEditRights(project, permissionOf),
        }]),
    ]);
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

        const { projectIds, permissionOf } = await readableProjects(companyId, uid, seat.roleType, request);
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
        const onPage = new Set(page.rows.map((row) => String(row.ProjectID)));
        const onlyCounted = groups && request.group === 'project' ? groups.map((group) => group.key).filter((key) => !onPage.has(key)) : [];

        return res.status(200).json({
            status: true,
            statusText: 'Tasks fetched successfully.',
            data: {
                rows: page.rows,
                groups,
                nextCursor: page.more ? encodeCursor(positionOf(page.rows[page.rows.length - 1], request.sort), binding, cursorKey()) : null,
                projects: await projectCards(companyId, uid, { onPage: [...onPage], onlyCounted }, permissionOf),
            },
        });
    } catch (error) {
        if (error instanceof EverythingRefused) return refuse(res, 400, 'Request refused', error.message, { field: error.field });
        if (error instanceof TenantError) return refuse(res, error.statusCode, 'Forbidden', error.message);
        logger.error(`listEverything error: ${error.message || error}`);
        return refuse(res, 500, 'An error occurred while listing tasks.', 'An error occurred while listing tasks.');
    }
};
