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
        const fromBytes = hexFromBytes(value)
            || hexFromBytes(value.id)
            || hexFromBytes(value.buffer)
            || hexFromBytes(value.oid);
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
    const sprint = row.sprintArray || row.sprint || {};
    return {
        projectId: firstId(row.ProjectID, row.projectId, row.ProjectId, sprint.projectId),
        sprintId: firstId(row.sprintId, row.SprintId, sprint.id, sprint._id),
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
    return collectSprintBoardTasks(tasksMap, projectId, sprintId).length;
}

export function collectSprintBoardTasks(tasksMap, projectId, sprintId) {
    const sid = firstId(sprintId);
    const seen = new Set();
    const out = [];
    const take = (rows, matchSid) => {
        if (!Array.isArray(rows)) return;
        for (const row of rows) {
            if (!row || row.deletedStatusKey) continue;
            const id = firstId(row._id, row.id);
            if (!id || seen.has(id)) continue;
            const rowSid = firstId(row.sprintId, row.SprintId);
            if (matchSid && rowSid && rowSid !== sid) continue;
            seen.add(id);
            out.push(row);
        }
    };
    take((sprintTasksBucket(tasksMap, projectId, sprintId) || {}).tasks, false);
    if (!tasksMap || typeof tasksMap !== 'object' || !sid) return out;
    for (const project of Object.values(tasksMap)) {
        if (!project || typeof project !== 'object') continue;
        const hit = lookupById(project, sid);
        take(hit && hit.tasks, false);
        for (const value of Object.values(project)) {
            if (value && typeof value === 'object' && Array.isArray(value.tasks)) take(value.tasks, true);
        }
    }
    return out;
}

export function uniqueTaskRows(...lists) {
    const seen = new Set();
    const out = [];
    for (const list of lists) {
        if (!Array.isArray(list)) continue;
        for (const row of list) {
            if (!row || row.deletedStatusKey) continue;
            const id = firstId(row._id, row.id);
            if (!id || seen.has(id)) continue;
            seen.add(id);
            out.push(row);
        }
    }
    return out;
}

export function sprintTreeExpectedCount(project, sprintId) {
    const sid = firstId(sprintId);
    if (!project || typeof project !== 'object' || !sid) return 0;
    let max = 0;
    const take = (row) => {
        if (!row || typeof row !== 'object') return;
        if (sameId(row.id || row._id, sid) || sameId(row.sprintId, sid)) {
            max = Math.max(max, sprintExpectedCount(row));
        }
    };
    const takeBag = (bag) => {
        if (!bag || typeof bag !== 'object') return;
        if (Array.isArray(bag)) {
            bag.forEach(take);
            return;
        }
        take(lookupById(bag, sid));
        Object.values(bag).forEach(take);
    };
    take(project);
    takeBag(project.sprintsObj);
    takeBag(project.sprints);
    for (const folder of Object.values(project.sprintsfolders || {})) {
        takeBag(folder && folder.sprintsObj);
        takeBag(folder && folder.sprints);
    }
    const folders = project.folders;
    if (Array.isArray(folders)) {
        folders.forEach((folder) => {
            takeBag(folder && folder.sprintsObj);
            takeBag(folder && folder.sprints);
        });
    } else if (folders && typeof folders === 'object') {
        Object.values(folders).forEach((folder) => {
            takeBag(folder && folder.sprintsObj);
            takeBag(folder && folder.sprints);
            if (Array.isArray(folder)) folder.forEach(take);
        });
    }
    if (Array.isArray(project.data)) {
        for (const row of project.data) {
            max = Math.max(max, sprintTreeExpectedCount(row, sid));
        }
    }
    return max;
}

export function sprintCountFromSprintBags(bags, sprintId) {
    const sid = firstId(sprintId);
    if (!sid || bags == null || typeof bags !== 'object') return 0;
    let max = 0;
    const rows = [];
    if (Array.isArray(bags)) {
        rows.push(...bags);
    } else {
        for (const value of Object.values(bags)) {
            if (Array.isArray(value)) rows.push(...value);
            else if (value && typeof value === 'object') rows.push(value);
        }
    }
    for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        if (sameId(row.id || row._id || row.sprintId, sid)) {
            max = Math.max(max, sprintExpectedCount(row));
        }
        if (row.sprintsObj || row.sprintsfolders || row.sprints || row.folders || row.data) {
            max = Math.max(max, sprintTreeExpectedCount(row, sid));
        }
    }
    return max;
}

export function taskMatchesBoard(row, { sprintId, projectId } = {}) {
    if (!row || row.deletedStatusKey || !firstId(row._id, row.id)) return false;
    const ids = resolveTaskOpenIds(row);
    const sid = firstId(sprintId);
    const pid = firstId(projectId);
    if (sid && ids.sprintId) return ids.sprintId === sid;
    if (sid && !ids.sprintId && pid && ids.projectId) return ids.projectId === pid;
    return false;
}

export function bindSprintTaskSource({ searched, searchRows, storedRows, sprintId, projectId } = {}) {
    const stored = uniqueTaskRows(storedRows);
    if (searched && Array.isArray(searchRows) && searchRows.length) {
        const hits = uniqueTaskRows(searchRows.filter((task) => taskMatchesBoard(task, { sprintId, projectId })));
        if (hits.length) return hits;
    }
    return stored;
}

export function collectRetryTaskRows({
    store, projectId, sprintId, groupRows, searchRows, allTasks, sprint,
} = {}) {
    const fromSprint = Array.isArray(sprint && sprint.tasks)
        ? sprint.tasks.filter((row) => row && typeof row === 'object' && firstId(row._id, row.id))
        : [];
    return uniqueTaskRows(
        collectSprintBoardTasks(store, projectId, sprintId),
        groupRows,
        bindSprintTaskSource({
            searched: true,
            searchRows,
            storedRows: [],
            sprintId,
            projectId,
        }),
        (Array.isArray(allTasks) ? allTasks : []).filter((row) => taskMatchesBoard(row, { sprintId, projectId })),
        fromSprint,
    );
}

export function countPaintedTaskRows(groups) {
    if (!Array.isArray(groups)) return 0;
    return groups.reduce((n, group) => {
        const rows = (group && group.tasksArray) || [];
        if (!Array.isArray(rows)) return n;
        return n + rows.filter((row) => row && !row.deletedStatusKey && firstId(row._id, row.id)).length;
    }, 0);
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

export function sprintExpectedCount(sprint) {
    if (!sprint || typeof sprint !== 'object') return 0;
    const counts = [sprint.tasks, sprint.taskCount, sprint.archiveTaskCount].map((raw) => {
        if (raw == null) return 0;
        if (Array.isArray(raw)) return raw.filter((row) => row && !row.deletedStatusKey).length;
        const n = Number(raw);
        return Number.isFinite(n) && n > 0 ? n : 0;
    });
    return Math.max(0, ...counts);
}

export function boardHoursVisible(kind) {
    return kind === 'ready' || kind === 'empty';
}

export function countRenderedSprintItems(groups) {
    if (!Array.isArray(groups)) return 0;
    return groups.reduce((n, group) => {
        const rows = (group && (group.tasksArray || group.items || group.tasks)) || [];
        if (!Array.isArray(rows)) return n;
        return n + rows.filter((row) => row && !row.deletedStatusKey).length;
    }, 0);
}

export function sameGroupValue(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return false;
    const left = firstId(a) || String(a).trim();
    const right = firstId(b) || String(b).trim();
    return left === right;
}

export function unmatchedBoardTasks(groups, tasks) {
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

export function appendUnmatchedToFirstGroup(groups, unmatched) {
    if (!Array.isArray(groups) || !groups.length || !Array.isArray(unmatched) || !unmatched.length) return groups;
    const have = new Set((groups[0].tasksArray || []).map((row) => firstId(row && (row._id || row.id))).filter(Boolean));
    const extra = unmatched.filter((row) => {
        const id = firstId(row && (row._id || row.id));
        return id && !have.has(id);
    });
    if (!extra.length) return groups;
    return groups.map((group, i) => (i === 0 ? { ...group, tasksArray: [...(group.tasksArray || []), ...extra] } : group));
}

export function taskMatchesGroup(task, group) {
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

export function paintSprintGroups(groups, tasks) {
    const source = (Array.isArray(tasks) ? tasks : []).filter((row) => row && !row.deletedStatusKey && firstId(row._id, row.id));
    const cols = Array.isArray(groups) ? groups : [];
    const mapped = cols.map((group) => ({
        ...group,
        tasksArray: source.filter((task) => taskMatchesGroup(task, group)),
    }));
    if (!mapped.length) {
        if (!source.length) return mapped;
        return [{
            key: 'bound',
            name: 'Tasks',
            searchKey: 'statusKey',
            searchValue: '',
            isExpanded: true,
            tasksArray: source,
        }];
    }
    return appendUnmatchedToFirstGroup(mapped, unmatchedBoardTasks(mapped, source));
}

export function countPaintedSprintTasks(groups, tasks) {
    return countPaintedTaskRows(paintSprintGroups(groups, tasks));
}

export function boardEmptyKind({ loading, sprintsBound, boardCount, expectedCount, searchHits, hasGroups, storedCount } = {}) {
    if (loading) return 'loading';
    const shown = Number(boardCount) || 0;
    if (shown > 0) return 'ready';
    if (hasGroups === false) return 'failed';
    const expected = Math.max(Number(expectedCount) || 0, Number(storedCount) || 0);
    if (!sprintsBound || expected > 0 || searchHits) return 'failed';
    return 'empty';
}

export function sprintSurfaceKind({ loading, injected, paintedCount, sidebarCount, storedCount } = {}) {
    if (loading || injected === 'loading') return 'loading';
    const painted = Number(paintedCount) || 0;
    if (painted > 0) return 'ready';
    const expected = Math.max(Number(sidebarCount) || 0, Number(storedCount) || 0);
    if (expected > 0) return 'failed';
    if (injected === 'failed') return 'failed';
    return 'empty';
}

const PLACEHOLDER_CHIP_NAMES = new Set(['', 'ghost user', 'n/a', 'unassigned', 'un-assigned', 'none', '—', '-']);

export function coerceAssigneeChipId(value) {
    if (value == null || value === false) return '';
    if (typeof value === 'number' && Number.isFinite(value) && value !== 0) return String(value);
    if (typeof value === 'string') {
        const id = value.trim();
        if (!id || id === '0' || PLACEHOLDER_CHIP_NAMES.has(id.toLowerCase()) || id === '[object Object]') return '';
        return id;
    }
    if (typeof value === 'object') {
        return firstId(value.userId, value._id, value.id, value);
    }
    return '';
}

export function assigneeChipDisplayName(chip, lookup) {
    if (typeof chip !== 'string') return '';
    const id = coerceAssigneeChipId(chip);
    if (!id) return '';
    if (typeof lookup !== 'function') return '';
    try {
        const user = lookup(id);
        if (!user || user.ghostUser) return '';
        const title = String(user.Employee_Name || user.name || user.title || '').trim();
        if (!title || PLACEHOLDER_CHIP_NAMES.has(title.toLowerCase())) return '';
        return title;
    } catch (_error) {
        return '';
    }
}

export function assigneeRailEmpty(raw, lookup) {
    const list = Array.isArray(raw) ? raw : (raw == null || raw === '' ? [] : [raw]);
    if (!list.length) return true;
    return list.every((entry) => !assigneeChipDisplayName(entry, lookup));
}
