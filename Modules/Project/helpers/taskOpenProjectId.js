'use strict';

const HEX_ID = /^[a-f0-9]{24}$/i;

function hexFromBytes(value) {
    if (!value) return '';
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(value)) {
        const hex = value.toString('hex');
        return HEX_ID.test(hex) ? hex : '';
    }
    if (value.type === 'Buffer' && Array.isArray(value.data) && value.data.length === 12) {
        const hex = value.data.map((n) => Number(n).toString(16).padStart(2, '0')).join('');
        return HEX_ID.test(hex) ? hex : '';
    }
    return '';
}

function coerceId(value) {
    if (value == null) return '';
    if (typeof value === 'object') {
        if (typeof value.toHexString === 'function') {
            const hex = String(value.toHexString()).trim();
            if (HEX_ID.test(hex)) return hex;
        }
        const fromBytes = hexFromBytes(value) || hexFromBytes(value.id) || hexFromBytes(value.buffer) || hexFromBytes(value.oid);
        if (fromBytes) return fromBytes;
        if (value.$oid) return coerceId(value.$oid);
        if (value.oid) return coerceId(value.oid);
        if (typeof value.toString === 'function') {
            const asString = value.toString();
            if (HEX_ID.test(asString)) return asString;
        }
        return coerceId(value._id || value.id || '');
    }
    const raw = String(value).trim();
    if (!raw || raw === 'undefined' || raw === 'null' || raw === '[object Object]') return '';
    return raw;
}

function firstId(...values) {
    for (const value of values) {
        const raw = coerceId(value);
        if (raw) return raw;
    }
    return '';
}

function resolveTaskOpenIds(row) {
    if (!row || typeof row !== 'object') {
        return { projectId: '', sprintId: '', taskId: '' };
    }
    const sprint = row.sprintArray || row.sprint || {};
    return {
        projectId: firstId(row.ProjectID, row.projectId, row.ProjectId, sprint.projectId),
        sprintId: firstId(row.sprintId, row.SprintId, sprint.id, sprint._id),
        taskId: firstId(row.taskId, row._id, row.id),
    };
}

function resolveOpenProjectId({ queryProjectId, task, selectedTask, routeProjectId } = {}) {
    return firstId(
        queryProjectId,
        task && (task.ProjectID || task.projectId || task.ProjectId),
        selectedTask && (selectedTask.ProjectID || selectedTask.projectId || selectedTask.ProjectId),
        routeProjectId,
    );
}

function shapeOpenTaskHit(row) {
    if (!row || typeof row !== 'object') return null;
    const taskId = firstId(row._id, row.id, row.taskId);
    if (!taskId) return null;
    return {
        _id: taskId,
        TaskName: row.TaskName || row.taskName || '',
        TaskKey: row.TaskKey || row.taskKey || '',
        status: row.status || null,
        statusType: row.statusType || '',
        ProjectID: firstId(row.ProjectID, row.projectId, row.ProjectId),
        sprintId: firstId(row.sprintId, row.SprintId),
        folderObjId: firstId(row.folderObjId, row.folderId),
    };
}

function shouldShowTaskSkeleton({ projectId, loaded, blocked } = {}) {
    return Boolean(projectId) && !loaded && !blocked;
}

function shouldShowTaskChrome({ projectId, loaded, blocked } = {}) {
    if (blocked) return false;
    return Boolean(projectId) || Boolean(loaded);
}

function sameId(a, b) {
    const left = firstId(a);
    const right = firstId(b);
    return Boolean(left) && left === right;
}

function bindSprintsToProject(sprints, folders, projectId) {
    const sprintRows = Array.isArray(sprints) ? sprints : [];
    const folderRows = Array.isArray(folders) ? folders : [];
    const foldersObject = {};
    for (const folder of folderRows) {
        if (!sameId(folder.projectId, projectId)) continue;
        const folId = firstId(folder._id, folder.id, folder.folderId);
        if (!folId) continue;
        foldersObject[folId] = {
            folderId: folId,
            name: folder.name,
            sprintsObj: {},
            deletedStatusKey: folder.deletedStatusKey,
            legacyId: folder.legacyId || '',
            id: folId,
            _id: folId,
        };
    }
    const root = [];
    for (const sprint of sprintRows) {
        if (!sameId(sprint.projectId, projectId)) continue;
        const sid = firstId(sprint._id, sprint.id);
        if (!sid) continue;
        const row = { ...sprint, id: sid, _id: firstId(sprint._id) || sid };
        const folderId = firstId(sprint.folderId);
        if (folderId && foldersObject[folderId]) {
            row.folderName = foldersObject[folderId].name;
            foldersObject[folderId].sprintsObj[sid] = row;
        } else {
            root.push(row);
        }
    }
    const sprintsObj = {};
    root.forEach((row) => {
        sprintsObj[row.id] = row;
    });
    return { sprintsObj, sprintsfolders: foldersObject, sprintsArray: root };
}

function asDocList(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (value._id || value.id) return [value];
    return Object.values(value).filter((row) => row && (row._id || row.id));
}

function firstSprintOf(project) {
    if (!project) return null;
    const root = Object.values(project.sprintsObj || {});
    if (root[0]) return root[0];
    for (const folder of Object.values(project.sprintsfolders || {})) {
        const rows = Object.values((folder && folder.sprintsObj) || {});
        if (rows[0]) return rows[0];
    }
    return null;
}

function injectedId(value) {
    if (value && typeof value === 'object' && typeof value.value === 'string') {
        return firstId(value.value);
    }
    return firstId(value);
}

function taskOpenRoute({ companyId, projectId, sprintId, taskId, folderId } = {}) {
    const cid = injectedId(companyId);
    const pid = firstId(projectId);
    if (!cid || !pid) return null;
    const sid = firstId(sprintId);
    const tid = firstId(taskId);
    const fid = firstId(folderId);
    const params = { cid, id: pid };
    if (tid && sid && fid) return { name: 'ProjectFolderSprintTask', params: { ...params, folderId: fid, sprintId: sid, taskId: tid } };
    if (tid && sid) return { name: 'ProjectSprintTask', params: { ...params, sprintId: sid, taskId: tid } };
    if (sid && fid) return { name: 'ProjectFolderSprint', params: { ...params, folderId: fid, sprintId: sid } };
    if (sid) return { name: 'ProjectSprint', params: { ...params, sprintId: sid } };
    if (fid) return { name: 'ProjectFolder', params: { ...params, folderId: fid } };
    return { name: 'Project', params };
}

function taskOpenPath(ids = {}) {
    const dest = taskOpenRoute(ids);
    if (!dest) return '';
    const { cid, id, folderId, sprintId, taskId } = dest.params;
    const base = `/${cid}/project/${id}`;
    if (taskId && sprintId && folderId) return `${base}/fs/${folderId}/${sprintId}/${taskId}`;
    if (taskId && sprintId) return `${base}/s/${sprintId}/${taskId}`;
    if (sprintId && folderId) return `${base}/fs/${folderId}/${sprintId}`;
    if (sprintId) return `${base}/s/${sprintId}`;
    if (folderId) return `${base}/f/${folderId}`;
    return `${base}/p`;
}

function pageProjectId(page) {
    if (!page || typeof page !== 'object') return '';
    return firstId(
        page.ProjectID,
        page.projectId,
        page.ProjectId,
        page.project && (page.project._id || page.project.id || page.project),
    );
}

function pageFromGetResponse(response) {
    const body = response && response.data;
    if (!body || typeof body !== 'object' || body.status === false) return null;
    const row = body.data !== undefined ? body.data : body;
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
    if (!(row._id || row.id || row.ProjectID || row.projectId || row.ProjectId)) return null;
    return row;
}

function lookupById(map, id) {
    if (!map || typeof map !== 'object') return undefined;
    const want = firstId(id);
    if (!want) return undefined;
    if (Object.prototype.hasOwnProperty.call(map, want) && map[want] !== undefined) return map[want];
    for (const key of Object.keys(map)) {
        if (firstId(key) === want) return map[key];
    }
    return undefined;
}

function sprintTasksBucket(tasksMap, projectId, sprintId) {
    const project = lookupById(tasksMap, projectId);
    if (!project || typeof project !== 'object') return null;
    const bucket = lookupById(project, sprintId);
    return bucket && typeof bucket === 'object' ? bucket : null;
}

function countSprintBoardTasks(tasksMap, projectId, sprintId) {
    const bucket = sprintTasksBucket(tasksMap, projectId, sprintId);
    const rows = bucket && Array.isArray(bucket.tasks) ? bucket.tasks : [];
    return rows.filter((row) => row && !row.deletedStatusKey).length;
}

function pageOpenRoute({ companyId, projectId, pageId } = {}) {
    const cid = injectedId(companyId);
    const pid = firstId(projectId);
    if (!cid || !pid) return null;
    const page = firstId(pageId);
    const dest = { name: 'ProjectPages', params: { cid, projectId: pid } };
    if (page) dest.query = { page };
    return dest;
}

function pageOpenPath(ids = {}) {
    const dest = pageOpenRoute(ids);
    if (!dest) return '';
    const page = dest.query && dest.query.page;
    return `/${dest.params.cid}/projects/${dest.params.projectId}/pages${page ? `?page=${page}` : ''}`;
}

function pageDeepLinkNeedsResolve({ pageId, projectId, routeName } = {}) {
    return Boolean(firstId(pageId)) && !firstId(projectId) && routeName !== 'ProjectPages';
}

function pageOpeningLine(title) {
    const name = String(title || '').trim();
    return name ? `Opening ${name}…` : 'Opening…';
}

function sprintExpectedCount(sprint) {
    if (!sprint || typeof sprint !== 'object') return 0;
    const counts = [sprint.tasks, sprint.taskCount, sprint.archiveTaskCount].map((raw) => {
        if (raw == null) return 0;
        if (Array.isArray(raw)) return raw.filter((row) => row && !row.deletedStatusKey).length;
        const n = Number(raw);
        return Number.isFinite(n) && n > 0 ? n : 0;
    });
    return Math.max(0, ...counts);
}

function boardHoursVisible(kind) {
    return kind === 'ready' || kind === 'empty';
}

function countRenderedSprintItems(groups) {
    if (!Array.isArray(groups)) return 0;
    return groups.reduce((n, group) => {
        const rows = (group && (group.tasksArray || group.items || group.tasks)) || [];
        if (!Array.isArray(rows)) return n;
        return n + rows.filter((row) => row && !row.deletedStatusKey).length;
    }, 0);
}

function sameGroupValue(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return false;
    const left = firstId(a) || String(a).trim();
    const right = firstId(b) || String(b).trim();
    return left === right;
}

function unmatchedBoardTasks(groups, tasks) {
    const have = new Set();
    for (const group of groups || []) {
        for (const row of (group && group.tasksArray) || []) {
            const id = firstId(row && (row._id || row.id));
            if (id) have.add(id);
        }
    }
    return (tasks || []).filter((row) => {
        if (!row || row.deletedStatusKey) return false;
        const id = firstId(row._id, row.id);
        return id && !have.has(id);
    });
}

function appendUnmatchedToFirstGroup(groups, unmatched) {
    if (!Array.isArray(groups) || !groups.length || !Array.isArray(unmatched) || !unmatched.length) return groups;
    const have = new Set((groups[0].tasksArray || []).map((row) => firstId(row && (row._id || row.id))).filter(Boolean));
    const extra = unmatched.filter((row) => {
        const id = firstId(row && (row._id || row.id));
        return id && !have.has(id);
    });
    if (!extra.length) return groups;
    return groups.map((group, i) => (i === 0 ? { ...group, tasksArray: [...(group.tasksArray || []), ...extra] } : group));
}

function taskMatchesGroup(task, group) {
    if (!task || !group) return false;
    const key = group.searchKey;
    if (key === 'statusKey') return sameGroupValue(task.statusKey, group.searchValue);
    if (key === 'Task_Priority') return sameGroupValue(task.Task_Priority, group.searchValue);
    if (key === 'AssigneeUserId') {
        const raw = Array.isArray(task.AssigneeUserId)
            ? task.AssigneeUserId.slice().sort().join('_')
            : (task.AssigneeUserId || '');
        return raw === (group.value || '');
    }
    if (key === 'DueDate') return false;
    return sameGroupValue(task[key], group.searchValue);
}

function paintSprintGroups(groups, tasks) {
    const source = (tasks || []).filter((row) => row && !row.deletedStatusKey);
    const cols = Array.isArray(groups) ? groups : [];
    const mapped = cols.map((group) => ({
        ...group,
        tasksArray: source.filter((task) => taskMatchesGroup(task, group)),
    }));
    if (!mapped.length) return mapped;
    const statusMode = cols.some((group) => group && group.searchKey === 'statusKey');
    if (!statusMode) return mapped;
    return appendUnmatchedToFirstGroup(mapped, unmatchedBoardTasks(mapped, source));
}

function countPaintedSprintTasks(groups, tasks) {
    return paintSprintGroups(groups, tasks).reduce((n, group) => n + (((group && group.tasksArray) || []).length), 0);
}

function boardEmptyKind({ loading, sprintsBound, boardCount, expectedCount, searchHits, hasGroups } = {}) {
    if (loading) return 'loading';
    if (hasGroups === false) return 'failed';
    const shown = Number(boardCount) || 0;
    if (shown > 0) return 'ready';
    const expected = Number(expectedCount) || 0;
    if (!sprintsBound || expected > 0 || searchHits) return 'failed';
    return 'empty';
}

module.exports = {
    firstId,
    injectedId,
    resolveTaskOpenIds,
    resolveOpenProjectId,
    shapeOpenTaskHit,
    shouldShowTaskSkeleton,
    shouldShowTaskChrome,
    sameId,
    bindSprintsToProject,
    asDocList,
    firstSprintOf,
    taskOpenRoute,
    taskOpenPath,
    pageOpenRoute,
    pageOpenPath,
    pageDeepLinkNeedsResolve,
    pageOpeningLine,
    pageProjectId,
    pageFromGetResponse,
    lookupById,
    sprintTasksBucket,
    countSprintBoardTasks,
    countRenderedSprintItems,
    sameGroupValue,
    unmatchedBoardTasks,
    appendUnmatchedToFirstGroup,
    taskMatchesGroup,
    paintSprintGroups,
    countPaintedSprintTasks,
    sprintExpectedCount,
    boardHoursVisible,
    boardEmptyKind,
};
