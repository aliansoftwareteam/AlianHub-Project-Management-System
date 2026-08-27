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

export function coerceId(value) {
    if (value == null) return '';
    if (typeof value === 'object') {
        if (typeof value.toHexString === 'function') {
            const hex = String(value.toHexString()).trim();
            if (HEX_ID.test(hex)) return hex;
        }
        const fromBytes = hexFromBytes(value) || hexFromBytes(value.id) || hexFromBytes(value.buffer);
        if (fromBytes) return fromBytes;
        if (value.$oid) return coerceId(value.$oid);
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

export function firstId(...values) {
    for (const value of values) {
        const raw = coerceId(value);
        if (raw) return raw;
    }
    return '';
}

export function resolveTaskOpenIds(row) {
    if (!row || typeof row !== 'object') {
        return { projectId: '', sprintId: '', taskId: '' };
    }
    return {
        projectId: firstId(row.ProjectID, row.projectId, row.ProjectId),
        sprintId: firstId(row.sprintId, row.SprintId),
        taskId: firstId(row.taskId, row._id, row.id),
    };
}

export function resolveOpenProjectId({ queryProjectId, task, selectedTask, routeProjectId } = {}) {
    return firstId(
        queryProjectId,
        task && (task.ProjectID || task.projectId || task.ProjectId),
        selectedTask && (selectedTask.ProjectID || selectedTask.projectId || selectedTask.ProjectId),
        routeProjectId,
    );
}

export function shouldShowTaskSkeleton({ projectId, loaded, blocked } = {}) {
    return Boolean(projectId) && !loaded && !blocked;
}

export function shouldShowTaskChrome({ projectId, loaded, blocked } = {}) {
    if (blocked) return false;
    return Boolean(projectId) || Boolean(loaded);
}

export function sameId(a, b) {
    const left = firstId(a);
    const right = firstId(b);
    return Boolean(left) && left === right;
}

export function bindSprintsToProject(sprints, folders, projectId) {
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

export function asDocList(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (value._id || value.id) return [value];
    return Object.values(value).filter((row) => row && (row._id || row.id));
}

export function firstSprintOf(project) {
    if (!project) return null;
    const root = Object.values(project.sprintsObj || {});
    if (root[0]) return root[0];
    for (const folder of Object.values(project.sprintsfolders || {})) {
        const rows = Object.values((folder && folder.sprintsObj) || {});
        if (rows[0]) return rows[0];
    }
    return null;
}

export function injectedId(value) {
    if (value && typeof value === 'object' && typeof value.value === 'string') {
        return firstId(value.value);
    }
    return firstId(value);
}

export function taskOpenRoute({ companyId, projectId, sprintId, taskId, folderId } = {}) {
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

export function taskOpenPath(ids = {}) {
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

export function pageProjectId(page) {
    if (!page || typeof page !== 'object') return '';
    return firstId(
        page.ProjectID,
        page.projectId,
        page.ProjectId,
        page.project && (page.project._id || page.project.id || page.project),
    );
}

export function pageFromGetResponse(response) {
    const body = response && response.data;
    if (!body || typeof body !== 'object' || body.status === false) return null;
    const row = body.data !== undefined ? body.data : body;
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
    if (!(row._id || row.id || row.ProjectID || row.projectId || row.ProjectId)) return null;
    return row;
}

export function lookupById(map, id) {
    if (!map || typeof map !== 'object') return undefined;
    const want = firstId(id);
    if (!want) return undefined;
    if (Object.prototype.hasOwnProperty.call(map, want) && map[want] !== undefined) return map[want];
    for (const key of Object.keys(map)) {
        if (firstId(key) === want) return map[key];
    }
    return undefined;
}

export function sprintTasksBucket(tasksMap, projectId, sprintId) {
    const project = lookupById(tasksMap, projectId);
    if (!project || typeof project !== 'object') return null;
    const bucket = lookupById(project, sprintId);
    return bucket && typeof bucket === 'object' ? bucket : null;
}

export function countSprintBoardTasks(tasksMap, projectId, sprintId) {
    const bucket = sprintTasksBucket(tasksMap, projectId, sprintId);
    const rows = bucket && Array.isArray(bucket.tasks) ? bucket.tasks : [];
    return rows.filter((row) => row && !row.deletedStatusKey).length;
}

export function pageOpenRoute({ companyId, projectId, pageId } = {}) {
    const cid = injectedId(companyId);
    const pid = firstId(projectId);
    if (!cid || !pid) return null;
    const page = firstId(pageId);
    const dest = { name: 'ProjectPages', params: { cid, projectId: pid } };
    if (page) dest.query = { page };
    return dest;
}

export function pageOpenPath(ids = {}) {
    const dest = pageOpenRoute(ids);
    if (!dest) return '';
    const page = dest.query && dest.query.page;
    return `/${dest.params.cid}/projects/${dest.params.projectId}/pages${page ? `?page=${page}` : ''}`;
}

export function pageDeepLinkNeedsResolve({ pageId, projectId, routeName } = {}) {
    return Boolean(firstId(pageId)) && !firstId(projectId) && routeName !== 'ProjectPages';
}

export function pageOpeningLine(title) {
    const name = String(title || '').trim();
    return name ? `Opening ${name}…` : 'Opening…';
}

export function boardEmptyKind({ loading, sprintsBound, boardCount, expectedCount, searchHits } = {}) {
    if (loading) return 'loading';
    const shown = Number(boardCount) || 0;
    if (shown > 0) return 'ready';
    const expected = Number(expectedCount) || 0;
    if (!sprintsBound || expected > 0 || searchHits) return 'failed';
    return 'empty';
}
