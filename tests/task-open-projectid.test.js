'use strict';

const fs = require('fs');
const path = require('path');
const {
    resolveOpenProjectId,
    firstId,
    resolveTaskOpenIds,
    shapeOpenTaskHit,
    shouldShowTaskSkeleton,
    shouldShowTaskChrome,
    bindSprintsToProject,
    sameId,
    asDocList,
    firstSprintOf,
    taskOpenPath,
    taskOpenRoute,
    injectedId,
    pageOpenRoute,
    pageOpenPath,
    pageDeepLinkNeedsResolve,
    pageOpeningLine,
    pageProjectId,
    pageFromGetResponse,
    countSprintBoardTasks,
    countRenderedSprintItems,
    sameGroupValue,
    unmatchedBoardTasks,
    appendUnmatchedToFirstGroup,
    countPaintedSprintTasks,
    sprintTasksBucket,
    boardEmptyKind,
    sprintExpectedCount,
    sprintTreeExpectedCount,
    sprintCountFromSprintBags,
    bindSprintTaskSource,
    countPaintedTaskRows,
    boardHoursVisible,
    sprintSurfaceKind,
    coerceAssigneeChipId,
    assigneeChipDisplayName,
    assigneeRailEmpty,
} = require('../Modules/Project/helpers/taskOpenProjectId');

describe('TASK OPEN - pass ProjectID so taskData is not empty', () => {
    test('prefers the task ProjectID over an empty query', () => {
        expect(firstId('', 'undefined', null, '  abc  ')).toBe('abc');
        expect(firstId({ toHexString: () => '64b7f0c2a1b2c3d4e5f60711' })).toBe('64b7f0c2a1b2c3d4e5f60711');
        expect(firstId({ $oid: '64b7f0c2a1b2c3d4e5f60711' })).toBe('64b7f0c2a1b2c3d4e5f60711');
        expect(firstId({ _id: '64b7f0c2a1b2c3d4e5f60711' })).toBe('64b7f0c2a1b2c3d4e5f60711');
        expect(firstId({ type: 'Buffer', data: [0x64, 0xb7, 0xf0, 0xc2, 0xa1, 0xb2, 0xc3, 0xd4, 0xe5, 0xf6, 0x07, 0x11] })).toBe('64b7f0c2a1b2c3d4e5f60711');
        expect(resolveOpenProjectId({
            queryProjectId: '',
            task: { ProjectID: '64b7f0c2a1b2c3d4e5f60711' },
        })).toBe('64b7f0c2a1b2c3d4e5f60711');
        expect(resolveOpenProjectId({
            queryProjectId: '',
            selectedTask: { projectId: 'from-home' },
            routeProjectId: 'from-url',
        })).toBe('from-home');
        expect(resolveOpenProjectId({
            queryProjectId: '',
            routeProjectId: 'from-url',
        })).toBe('from-url');
        expect(resolveOpenProjectId({ queryProjectId: '' })).toBe('');

        const search = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'molecules', 'GlobalSearch', 'GlobalSearchModal.vue'), 'utf8');
        const advance = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'atom', 'AdvanceFilterTasks', 'AdvanceFilterTasks.vue'), 'utf8');
        const detail = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'views', 'TaskDetail', 'TaskDetail.vue'), 'utf8');
        const query = fs.readFileSync(path.join(__dirname, '..', 'Modules', 'Project', 'controller', 'getQueryFun.js'), 'utf8');
        const hits = fs.readFileSync(path.join(__dirname, '..', 'Modules', 'GlobalSearch', 'controller.js'), 'utf8');
        expect(search).toContain('@click.stop="openTask(task)"');
        expect(search).toContain('task_not_in_project');
        expect(search).toContain('missingHit');
        expect(advance).toContain('openInApp');
        expect(advance).toContain('openFromTitle');
        expect(advance).toContain('openFromChip');
        expect(advance).toContain(':href="taskHref"');
        expect(advance).toContain('advancefilter__open-chip');
        expect(advance).toContain('Projects.search_open');
        expect(advance).not.toContain('imgOpenSameTab');
        expect(advance).not.toContain('imgOpenNewTab');
        expect(advance).toContain('taskOpenRoute');
        expect(advance).toContain('resolveTaskOpenIds');
        expect(advance).toContain('sprintArray');
        expect(advance).toContain('dest.params.taskId');
        expect(advance).toContain('router.push(next)');
        expect(advance).toContain('closeAdvanceSearch');
        expect(advance).toContain('closeGlobalSearch');
        expect(advance).not.toContain('window.open');
        expect(advance).not.toContain('target="_blank"');
        expect(advance).not.toContain('openModel');
        expect(advance).toMatch(/event\.metaKey \|\| event\.ctrlKey/);
        expect(detail).toContain('resolveOpenProjectId');
        expect(detail).toContain('task_not_in_project');
        expect(detail).toContain('openBlocked');
        expect(detail).toContain('showTaskChrome');
        expect(detail).not.toContain('if (!resolvedProjectId.value || !props.taskId) return;');
        expect(query).toContain('resolvedProjectId');
        expect(query).toContain("SCHEMA_TYPE.TASKS");
        expect(query).toContain("findOne");
        expect(query).not.toContain('$eq: ["$_id", "$$taskId"]');
        expect(detail).toContain('markTaskMissing');
        expect(detail).toContain('8000');
        expect(hits).toContain('shapeOpenTaskHit');
    });

    test('search hits always carry a string ProjectID when the task has one', () => {
        const shaped = shapeOpenTaskHit({
            _id: { toHexString: () => '64b7f0c2a1b2c3d4e5f60722' },
            TaskName: 'Add CSV Export To Reports',
            TaskKey: 'SMOKE-5',
            ProjectID: { toHexString: () => '64b7f0c2a1b2c3d4e5f60711' },
            sprintId: '64b7f0c2a1b2c3d4e5f60733',
        });
        expect(shaped.ProjectID).toBe('64b7f0c2a1b2c3d4e5f60711');
        expect(shaped._id).toBe('64b7f0c2a1b2c3d4e5f60722');
        expect(shapeOpenTaskHit({ TaskName: 'no id' })).toBe(null);
        expect(shapeOpenTaskHit({ _id: 't1' }).ProjectID).toBe('');
        expect(resolveTaskOpenIds({
            _id: '6a8f8cc420e171dfa740fc43',
            TaskKey: 'SMOKE-7',
            sprintArray: {
                id: '6a8f0b22e2ad4d0997553eb4',
                projectId: '6a8f09301f05e701eaf45c9a',
                folderId: '',
            },
        })).toEqual({
            projectId: '6a8f09301f05e701eaf45c9a',
            sprintId: '6a8f0b22e2ad4d0997553eb4',
            taskId: '6a8f8cc420e171dfa740fc43',
        });
        expect(resolveTaskOpenIds(null)).toEqual({ projectId: '', sprintId: '', taskId: '' });
    });

    test('empty projectId never shows a task skeleton; fail-fast is the fallback', () => {
        expect(shouldShowTaskSkeleton({ projectId: '', loaded: false, blocked: false })).toBe(false);
        expect(shouldShowTaskSkeleton({ projectId: '', loaded: false, blocked: true })).toBe(false);
        expect(shouldShowTaskSkeleton({ projectId: 'p1', loaded: false, blocked: false })).toBe(true);
        expect(shouldShowTaskSkeleton({ projectId: 'p1', loaded: true, blocked: false })).toBe(false);
        expect(shouldShowTaskChrome({ projectId: '', loaded: false, blocked: false })).toBe(false);
        expect(shouldShowTaskChrome({ projectId: '', loaded: false, blocked: true })).toBe(false);
        expect(shouldShowTaskChrome({ projectId: 'p1', loaded: false, blocked: false })).toBe(true);
        expect(shouldShowTaskChrome({ projectId: '', loaded: true, blocked: false })).toBe(true);
    });
});

describe('LIST/BOARD - bind sprint rows so SMOKE tasks can load', () => {
    const PROJECT = '6a8f09301f05e701eaf45c9a';
    const SPRINT = '6a8f0b22e2ad4d0997553eb4';
    const FOLDER = '6a8f0aaa0000000000000001';

    test('dangling folderId still lands in sprintsObj so list/board can fetch tasks', () => {
        const bound = bindSprintsToProject(
            [{ _id: SPRINT, name: 'Ask Smoke', projectId: PROJECT, folderId: FOLDER, deletedStatusKey: 0 }],
            [],
            PROJECT,
        );
        expect(bound.sprintsArray).toHaveLength(1);
        expect(bound.sprintsObj[SPRINT]._id).toBe(SPRINT);
        expect(bound.sprintsObj[SPRINT].id).toBe(SPRINT);
        expect(bound.sprintsfolders).toEqual({});
    });

    test('ObjectId-like and $oid projectId still match the string project id', () => {
        expect(sameId({ toHexString: () => PROJECT }, PROJECT)).toBe(true);
        expect(sameId({ $oid: PROJECT }, PROJECT)).toBe(true);
        const bound = bindSprintsToProject(
            [{
                _id: SPRINT,
                name: 'Ask Smoke',
                projectId: { toHexString: () => PROJECT },
                deletedStatusKey: 0,
            }],
            [],
            PROJECT,
        );
        expect(Object.keys(bound.sprintsObj)).toEqual([SPRINT]);
        expect(bindSprintsToProject(
            [{ _id: SPRINT, projectId: 'not-this-project', deletedStatusKey: 0 }],
            [],
            PROJECT,
        ).sprintsArray).toHaveLength(0);
    });

    test('foldered sprints stay in the folder map, not dropped', () => {
        const bound = bindSprintsToProject(
            [{ _id: SPRINT, name: 'Ask Smoke', projectId: PROJECT, folderId: FOLDER, deletedStatusKey: 0 }],
            [{ _id: FOLDER, name: 'Mobile', projectId: PROJECT, deletedStatusKey: 0 }],
            PROJECT,
        );
        expect(bound.sprintsArray).toHaveLength(0);
        expect(bound.sprintsfolders[FOLDER].sprintsObj[SPRINT].id).toBe(SPRINT);
        expect(bound.sprintsfolders[FOLDER].sprintsObj[SPRINT].folderName).toBe('Mobile');
    });

    test('list/board load bound sprints and fail-fast search-open still pass ProjectID', () => {
        const listing = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'views', 'Projects', 'ProjectsListing', 'ProjectListing.vue'), 'utf8');
        const sprintFolder = fs.readFileSync(path.join(__dirname, '..', 'Modules', 'Project', 'controller', 'getSprintFolder.js'), 'utf8');
        const list = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'views', 'Projects', 'ListView', 'ListView.vue'), 'utf8');
        const board = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'views', 'Projects', 'Kanban', 'BoardView.vue'), 'utf8');
        const sprintList = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'organisms', 'SprinstList', 'SprintsList.vue'), 'utf8');
        const actions = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'store', 'ProjectData', 'actions.js'), 'utf8');
        expect(listing).toContain('bindSprintsToProject');
        expect(listing).toContain('sameId(item._id, id)');
        expect(listing).toContain('resolve([])');
        expect(sprintFolder).toContain('function projectIdMatch');
        expect(sprintFolder).toContain('exports.projectIdMatch = projectIdMatch');
        expect(sprintFolder).toContain('$in');
        expect(listing).toContain('firstSprintOf');
        expect(listing).toContain('taskOpenRoute');
        expect(listing).toContain('onBareProject');
        expect(listing).toContain('sprintFetchStarted');
        expect(sprintList).toContain('EmptyState.no_sprint_tasks_title');
        expect(board).toContain('EmptyState.no_sprint_tasks_title');
        expect(sprintList).toContain('EmptyState.load_failed_title');
        expect(board).toContain('EmptyState.load_failed_title');
        expect(sprintList).toContain('EmptyState.board_loading');
        expect(list).toContain('headerSprints');
        expect(list).toContain('boardSurfaceKind');
        expect(list).toContain('countSprintBoardTasks');
        expect(board).toContain('EmptyState.board_loading');
        expect(list).not.toContain('EmptyState.no_match_title');
        expect(board).not.toContain('EmptyState.no_match_title');
        expect(list).not.toContain('no_data_found');
        expect(board).not.toContain('no_data_found');
        expect(list).toContain('props.sprints && props.sprints.length');
        expect(board).toContain('props.sprints && props.sprints.length');
        expect(actions).toContain('ProjectID: { objId: { $in: [pid] } }');
        expect(actions).toContain('sprintId: { objId: { $in: [sprintId] } }');
        expect(actions).toContain('{ objId: { ProjectID: pid } }');
        expect(actions).toContain('{ objId: { sprintId } }');
    });
});

describe('SEARCH OPEN - same-tab hash with ProjectID, TaskKey, and auto-select', () => {
    const CID = '6a8ee973d625fca52e519a12';
    const PROJECT = '6a8f09301f05e701eaf45c9a';
    const SPRINT = '6a8f0b22e2ad4d0997553eb4';
    const TASK = '6a8f8cc420e171dfa740fc43';
    const FOLDER = '6a8f0aaa0000000000000001';

    test('taskOpenPath builds /project/pid/s/sid/tid and fails closed without cid or pid', () => {
        expect(taskOpenPath({
            companyId: CID,
            projectId: PROJECT,
            sprintId: SPRINT,
            taskId: TASK,
        })).toBe(`/${CID}/project/${PROJECT}/s/${SPRINT}/${TASK}`);
        expect(taskOpenPath({
            companyId: { $oid: CID },
            projectId: { toHexString: () => PROJECT },
            sprintId: SPRINT,
        })).toBe(`/${CID}/project/${PROJECT}/s/${SPRINT}`);
        expect(taskOpenPath({
            companyId: CID,
            projectId: PROJECT,
            folderId: FOLDER,
            sprintId: SPRINT,
            taskId: TASK,
        })).toBe(`/${CID}/project/${PROJECT}/fs/${FOLDER}/${SPRINT}/${TASK}`);
        expect(taskOpenPath({
            companyId: CID,
            projectId: PROJECT,
            folderId: FOLDER,
        })).toBe(`/${CID}/project/${PROJECT}/f/${FOLDER}`);
        expect(taskOpenPath({ companyId: CID, projectId: PROJECT })).toBe(`/${CID}/project/${PROJECT}/p`);
        expect(taskOpenPath({ companyId: CID })).toBe('');
        expect(taskOpenPath({ projectId: PROJECT })).toBe('');
        expect(taskOpenPath({ companyId: CID, projectId: { nope: true } })).toBe('');
        expect(taskOpenRoute({
            companyId: { value: CID },
            projectId: PROJECT,
            sprintId: SPRINT,
            taskId: TASK,
        })).toEqual({
            name: 'ProjectSprintTask',
            params: { cid: CID, id: PROJECT, sprintId: SPRINT, taskId: TASK },
        });
        expect(taskOpenRoute({ companyId: CID, projectId: PROJECT, sprintId: SPRINT }).name).toBe('ProjectSprint');
        expect(taskOpenRoute({ companyId: CID })).toBe(null);
        expect(injectedId({ value: CID })).toBe(CID);
    });

    test('firstSprintOf and asDocList unwrap a single sprint document', () => {
        expect(asDocList({ _id: SPRINT, name: 'Ask Smoke' })).toEqual([{ _id: SPRINT, name: 'Ask Smoke' }]);
        expect(asDocList([{ _id: SPRINT }])).toEqual([{ _id: SPRINT }]);
        expect(asDocList(null)).toEqual([]);
        expect(asDocList({ [SPRINT]: { _id: SPRINT, id: SPRINT } })).toEqual([{ _id: SPRINT, id: SPRINT }]);

        const bound = bindSprintsToProject(
            [{ _id: SPRINT, name: 'Ask Smoke', projectId: PROJECT, deletedStatusKey: 0 }],
            [],
            PROJECT,
        );
        expect(firstSprintOf(bound)._id).toBe(SPRINT);
        expect(firstSprintOf({ sprintsObj: {}, sprintsfolders: { [FOLDER]: { sprintsObj: { [SPRINT]: { _id: SPRINT } } } } })._id).toBe(SPRINT);
        expect(firstSprintOf({})).toBe(null);
    });

    test('Ctrl+K title and OPEN share one in-app href; TaskKey hits AdvancedGlobalFilter', () => {
        const advance = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'atom', 'AdvanceFilterTasks', 'AdvanceFilterTasks.vue'), 'utf8');
        const helper = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'molecules', 'AdvanceSearch', 'helper.js'), 'utf8');
        const filter = fs.readFileSync(path.join(__dirname, '..', 'Modules', 'AdvancedGlobalFilter', 'controller.js'), 'utf8');
        const subItem = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'molecules', 'SubItem', 'SubItem.vue'), 'utf8');
        const projects = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'views', 'Projects', 'Projects.vue'), 'utf8');
        const detail = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'views', 'TaskDetail', 'TaskDetail.vue'), 'utf8');
        const body = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'organisms', 'TaskDetailBody', 'TaskDetailBody.vue'), 'utf8');
        const tabs = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'molecules', 'TabListItem', 'TabListItem.vue'), 'utf8');
        const title = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'molecules', 'TaskDetailTitle', 'TaskDetailTitle.vue'), 'utf8');
        const comments = fs.readFileSync(path.join(__dirname, '..', 'Modules', 'Comments', 'controller.js'), 'utf8');
        const app = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'App.vue'), 'utf8');
        const dropdown = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'molecules', 'DropDown', 'DropDown.vue'), 'utf8');
        const autofill = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'molecules', 'TaskAiAutofill', 'TaskAiAutofill.vue'), 'utf8');
        const cfRender = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'plugins', 'customFieldView', 'component', 'molecules', 'customFieldTaskView', 'customFieldRender.vue'), 'utf8');

        expect(advance).toContain('openInApp');
        expect(advance).toContain('openFromTitle');
        expect(advance).toContain('openFromChip');
        expect(advance).toContain(':href="taskHref"');
        expect(advance).toContain('advancefilter__open-chip');
        expect(advance).not.toContain('imgOpenSameTab');
        expect(advance).not.toContain('imgOpenNewTab');
        expect((advance.match(/:href="taskHref"/g) || []).length).toBe(2);
        expect(advance).toContain('taskOpenRoute');
        expect(advance).toContain('resolveTaskOpenIds');
        expect(advance).toContain('sprintArray');
        expect(advance).toContain('dest.params.taskId');
        expect(advance).toContain('router.push(next)');
        expect(advance).toContain('closeAdvanceSearch');
        expect(advance).toContain('closeGlobalSearch');
        expect(advance).toContain('markSearchClosed');
        expect(advance).not.toContain('window.open');
        expect(advance).not.toContain('target="_blank"');
        expect(advance).not.toContain('@click.prevent');
        expect(advance).toMatch(/event\.metaKey \|\| event\.ctrlKey/);
        expect(advance).toContain('openFromChip');
        expect(helper).toContain('taskOpenPath');
        expect(helper).toContain('firstId');
        expect(filter).toContain('TaskKey');
        expect(filter).toContain('$regex: escapeRegex(searchStr)');
        expect(subItem).toContain('taskOpenRoute');
        expect(subItem).toContain(':href="sprintHref"');
        expect(subItem).toContain('onSprintClick');
        expect(subItem).not.toContain('target="_blank"');
        expect(projects).toContain('bindActiveProject');
        expect(projects).toContain('taskOpenRoute');
        expect(projects).toContain('if (route.params?.taskId) return');
        expect(detail).toContain('task.value = row');
        expect(detail).toContain('bindSprintsToProject(asDocList');
        expect(detail).toContain('keepTaskOpenHash');
        expect(detail).toContain('if (openTid && !dest.params.taskId) return');
        expect(detail).toContain('nestedLayerOpen');
        expect(detail).toContain("nested === 'dropdown'");
        expect(detail).toContain('closeOnBackDrop');
        expect(detail).toContain('ignoreTaskBackdrop');
        expect(detail).toContain('onSidebarVisible');
        expect(body).not.toContain('taskOpenRoute');
        expect(body).not.toContain('syncDetailTab');
        expect(body).not.toContain('router.replace({ query:');
        expect(body).toContain('kiln-task-tab');
        expect(body).toContain('activeTab.value = tab');
        expect(body).toContain("route.query.detailTab");
        expect(body).not.toContain('params.taskId = openTid');
        expect(body).toContain(':projectId="openProjectId"');
        expect(body).toContain('threadTaskId');
        expect(body).not.toContain("activeTab === 'comment' && Object.keys(projectData).length");
        expect(tabs).toContain('selectTab');
        expect(tabs).toContain("emit('changeTab'");
        expect(tabs).toContain('onTabPointer');
        expect(tabs).toContain("if (!props.isActive) emit('changeTab', props.tabKey)");
        expect(tabs).toContain('@click.prevent.stop="selectTab"');
        expect(tabs).toContain('@mousedown.stop.prevent="onTabPointer"');
        expect(tabs).toContain('data-tab');
        expect(tabs).toContain('markTabPointer');
        expect(tabs).toContain('kiln-task-tab');
        expect(tabs).not.toContain('@click.stop="');
        expect(title).toContain('startEditName');
        expect(title).toContain('titlePointerDown');
        expect(title).toContain('onTitlePointerDown');
        expect(title).toContain('event.target !== event.currentTarget');
        expect(title).toContain('wasRecentTabPointer');
        expect(title).toContain('ignoreTaskBackdrop');
        expect(title).toContain('clickFromTab');
        expect(title).toContain('kiln-task-tab');
        expect(title).toContain("event.type !== 'click'");
        expect(title).toContain("event.key !== 'Escape'");
        expect(title).toContain('defineExpose');
        expect(detail).toContain('onPanelEscape');
        expect(detail).toContain("addEventListener('keydown', onPanelEscape, true)");
        expect(detail).toContain("nested === 'dropdown'");
        expect(detail).toContain('titleRef.value.isEditing');
        expect(dropdown).toContain('kiln-dismiss-dropdown');
        expect(dropdown).toContain("event.key !== 'Escape'");
        expect(autofill).toContain('applyOne');
        expect(autofill).toContain('applyEmpty');
        expect(autofill).toContain('canFillEmpty');
        expect(autofill).toContain('sprintDueDisplay');
        expect(autofill).toContain('ghostUser');
        expect(autofill).toContain('ownerFilled');
        expect(autofill).toContain("write: 'assignee'");
        expect(autofill).toContain("write: 'owner'");
        expect(autofill).toContain('showCard');
        expect(autofill).toContain('taf__go');
        expect(autofill).toContain('autofill_fill_empty');
        expect(autofill).toContain('kiln-dismiss-autofill');
        expect(autofill).toContain('canShow');
        expect(autofill).toContain("write: 'date'");
        expect(autofill).toContain('customDueEmpty');
        expect(autofill).toContain('DATE_PLACEHOLDER');
        expect(autofill).not.toContain('taf__kind');
        expect(autofill).not.toContain("checkApps('CustomFields')");
        expect(autofill).not.toContain('getAppState');
        expect(cfRender).not.toContain('TaskAiAutofill');
        const tab = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'molecules', 'TaskDetailTab', 'TaskDetailTab.vue'), 'utf8');
        expect(tab).toContain('TaskAiAutofill');
        expect(tab.indexOf('TaskAiAutofill')).toBeLessThan(tab.indexOf('CheckListComponent'));
        expect(tab.indexOf('TaskAiAutofill')).toBeLessThan(tab.indexOf('CustomFieldRenderViewComponent'));
        expect(tab.indexOf('TaskAiAutofill')).toBeLessThan(tab.indexOf('Description'));
        expect(app).toContain('closeGlobalSearch');
        expect(app).toContain('key="advance-search-modal"');
        expect(comments).toContain('buildPaginatedCommentMatch');
        expect(comments).toContain('status(400)');
        expect(fs.readFileSync(path.join(__dirname, '..', 'Modules', 'Comments', 'helpers', 'commentThread.js'), 'utf8')).toContain('A valid projectId is required.');
        const commentsVue = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'views', 'Projects', 'Comments', 'Comments.vue'), 'utf8');
        expect(commentsVue).toContain('props.projectId');
        expect(commentsVue).toContain('if (!projectId)');
        expect(commentsVue).toContain('scrollThreadEl');
        expect(commentsVue).toContain("@wheel.stop");
        const commentsCss = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'views', 'Projects', 'Comments', 'style.css'), 'utf8');
        expect(commentsCss).toContain('overscroll-behavior: contain');
        expect(comments).toContain('isHexCastError');
        expect(projects).toContain('isTaskDetail.value && firstId(selectedTask.value?.id');
        expect(projects).toContain('reloadSprintTasks');
    });
});

describe('BOARD EMPTY - three states, never No Data Found', () => {
    const PROJECT = '6a8f09301f05e701eaf45c9a';
    const SPRINT = '6a8f0b22e2ad4d0997553eb4';

    test('loading, honest empty, and failed bind are distinct', () => {
        expect(boardEmptyKind({ loading: true, sprintsBound: true, boardCount: 0, expectedCount: 4 })).toBe('loading');
        expect(boardEmptyKind({ loading: false, sprintsBound: true, boardCount: 0, expectedCount: 0, searchHits: false })).toBe('empty');
        expect(boardEmptyKind({ loading: false, sprintsBound: false, boardCount: 0, expectedCount: 0 })).toBe('failed');
        expect(boardEmptyKind({ loading: false, sprintsBound: true, boardCount: 0, expectedCount: 3 })).toBe('failed');
        expect(boardEmptyKind({ loading: false, sprintsBound: true, boardCount: 0, expectedCount: 0, searchHits: true })).toBe('failed');
        expect(boardEmptyKind({ loading: false, sprintsBound: true, boardCount: 2, expectedCount: 2 })).toBe('ready');
        expect(boardEmptyKind({ loading: false, sprintsBound: true, boardCount: 0, expectedCount: 7, hasGroups: false })).toBe('failed');
        expect(boardEmptyKind({ loading: false, sprintsBound: true, boardCount: 0, expectedCount: 0, hasGroups: false })).toBe('failed');
        expect(boardEmptyKind({ loading: false, sprintsBound: true, boardCount: 0, expectedCount: 7, hasGroups: true })).toBe('failed');
        expect(boardEmptyKind({ loading: false, sprintsBound: true, boardCount: 7, expectedCount: 7, hasGroups: true })).toBe('ready');
        expect(sprintExpectedCount({ tasks: 7 })).toBe(7);
        expect(sprintExpectedCount({ taskCount: 7 })).toBe(7);
        expect(sprintExpectedCount({ tasks: [] })).toBe(0);
        expect(sprintExpectedCount({ tasks: [], taskCount: 7 })).toBe(7);
        expect(countRenderedSprintItems([{ tasksArray: [] }, { tasksArray: [] }])).toBe(0);
        expect(countRenderedSprintItems([{ tasksArray: [{ _id: 't1' }, { _id: 't2', deletedStatusKey: 1 }] }])).toBe(1);
        expect(countRenderedSprintItems([{ items: [{ _id: 't1' }] }, { tasks: [{ _id: 't2' }] }])).toBe(2);
        expect(sameGroupValue(1, '1')).toBe(true);
        expect(sameGroupValue('todo', 'todo')).toBe(true);
        expect(sameGroupValue('todo', 'done')).toBe(false);
        expect(appendUnmatchedToFirstGroup(
            [{ tasksArray: [{ _id: 'a' }] }, { tasksArray: [] }],
            [{ _id: 'b' }, { _id: 'a' }],
        )[0].tasksArray.map((row) => row._id)).toEqual(['a', 'b']);
        expect(unmatchedBoardTasks([{ tasksArray: [{ _id: 'a' }] }], [{ _id: 'a' }, { _id: 'b' }]).map((row) => row._id)).toEqual(['b']);
        expect(boardHoursVisible('failed')).toBe(false);
        expect(boardHoursVisible('loading')).toBe(false);
        expect(boardHoursVisible('ready')).toBe(true);
        expect(boardHoursVisible('empty')).toBe(true);
        expect(countPaintedSprintTasks(
            [{ searchKey: 'statusKey', searchValue: 'todo', tasksArray: [] }],
            [{ _id: 'a', statusKey: 'in-progress' }, { _id: 'b', statusKey: 'todo' }],
        )).toBe(2);
        expect(countPaintedSprintTasks(
            [{ searchKey: 'statusKey', searchValue: 'todo', tasksArray: [] }],
            [],
        )).toBe(0);
        expect(boardEmptyKind({ loading: false, sprintsBound: true, boardCount: 0, expectedCount: 7, hasGroups: true })).toBe('failed');
        expect(boardEmptyKind({ loading: false, sprintsBound: true, boardCount: 7, expectedCount: 7, hasGroups: true })).toBe('ready');
        expect(boardEmptyKind({ loading: false, sprintsBound: true, boardCount: 0, expectedCount: 0, storedCount: 7, hasGroups: true })).toBe('failed');
        expect(boardEmptyKind({ loading: false, sprintsBound: true, boardCount: 0, expectedCount: 0, storedCount: 0, hasGroups: true })).toBe('empty');
        expect(sprintSurfaceKind({ injected: 'ready', paintedCount: 0, sidebarCount: 7 })).toBe('failed');
        expect(sprintSurfaceKind({ injected: 'ready', paintedCount: 7, sidebarCount: 7 })).toBe('ready');
        expect(sprintSurfaceKind({ injected: 'loading', paintedCount: 0, sidebarCount: 7 })).toBe('loading');
        expect(sprintSurfaceKind({ injected: 'ready', paintedCount: 0, sidebarCount: 0 })).toBe('empty');
        expect(sprintSurfaceKind({ injected: 'ready', paintedCount: 0, sidebarCount: 0, storedCount: 7 })).toBe('failed');
        expect(coerceAssigneeChipId({ userId: 'u-ada' })).toBe('u-ada');
        expect(coerceAssigneeChipId('  ')).toBe('');
        expect(assigneeChipDisplayName('u-ada', () => ({ Employee_Name: 'Ada Lovelace' }))).toBe('Ada Lovelace');
        expect(assigneeChipDisplayName('u-ghost', () => ({ Employee_Name: 'Ghost User', ghostUser: true }))).toBe('');
        expect(assigneeChipDisplayName({ userId: 'u-ada' }, () => ({ Employee_Name: 'Ada Lovelace' }))).toBe('');
        expect(assigneeRailEmpty(['u-ada'], () => ({ Employee_Name: 'Ada Lovelace' }))).toBe(false);
        expect(assigneeRailEmpty([{ userId: 'u-ada' }], () => ({ Employee_Name: 'Ada Lovelace' }))).toBe(true);
        expect(assigneeRailEmpty(['tId_missing'], () => null)).toBe(true);
        expect(assigneeRailEmpty(['  unassigned  '], () => ({ Employee_Name: 'Ada' }))).toBe(true);
        expect(sprintTreeExpectedCount({
            sprintsObj: { [SPRINT]: { id: SPRINT, tasks: 7 } },
        }, SPRINT)).toBe(7);
        expect(sprintTreeExpectedCount({
            sprintsfolders: { f1: { sprintsObj: { [SPRINT]: { _id: SPRINT, taskCount: 7 } } } },
        }, SPRINT)).toBe(7);
        expect(sprintTreeExpectedCount({
            sprintsObj: {},
            sprintsfolders: { f1: { sprints: [{ id: SPRINT, tasks: 7 }] } },
        }, SPRINT)).toBe(7);
        expect(sprintTreeExpectedCount({
            data: [{ sprintsObj: {}, sprintsfolders: { f1: { sprintsObj: { [SPRINT]: { _id: SPRINT, tasks: 7 } } } } }],
        }, SPRINT)).toBe(7);
        expect(sprintCountFromSprintBags({
            pid: [{ _id: SPRINT, tasks: 7 }],
        }, SPRINT)).toBe(7);
        expect(sprintExpectedCount({ items: [{ tasksArray: [{ _id: 'a' }, { _id: 'b' }] }] })).toBe(0);
        expect(bindSprintTaskSource({
            searched: true,
            searchRows: [],
            storedRows: [{ _id: 't1' }, { _id: 't2' }],
            sprintId: SPRINT,
        })).toHaveLength(2);
        expect(bindSprintTaskSource({
            searched: true,
            searchRows: [{ _id: 'hit', sprintId: SPRINT }],
            storedRows: [{ _id: 't1' }],
            sprintId: SPRINT,
        }).map((row) => row._id)).toEqual(['hit']);
        expect(countPaintedTaskRows([{ tasksArray: [{ _id: 'a' }, { TaskName: 'ghost' }] }])).toBe(1);
        const store = {
            [PROJECT]: {
                sprints: [SPRINT],
                [SPRINT]: { tasks: [{ _id: 't1' }, { _id: 't2', deletedStatusKey: 0 }] },
            },
        };
        expect(countSprintBoardTasks(store, { $oid: PROJECT }, { toHexString: () => SPRINT })).toBe(2);
        expect(countSprintBoardTasks({}, PROJECT, SPRINT)).toBe(0);
        expect(sprintTasksBucket(store, PROJECT, SPRINT).tasks).toHaveLength(2);
        const list = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'views', 'Projects', 'ListView', 'ListView.vue'), 'utf8');
        const board = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'views', 'Projects', 'Kanban', 'BoardView.vue'), 'utf8');
        expect(list).toContain('hasGroups');
        expect(list).toContain('sprintExpectedCount');
        expect(list).toContain('sprintTreeExpectedCount');
        expect(list).toContain('sprintCountFromSprintBags');
        expect(list).toContain('projectData/allProjects');
        expect(list).toContain('storedCount: stored');
        expect(list).toContain('countPaintedTaskRows');
        expect(list).toContain('bindPaintedSprints');
        expect(list).toContain('paintSprintGroups');
        expect(list).not.toContain('Math.max(countRenderedSprintItems(groups), stored)');
        expect(list).toContain('boardCount: shown');
        expect(list).toContain('resetSprintTaskBucket');
        expect(list).toContain('refetchSprintBoardTasks');
        expect(list).toContain('const retrying = ref(false)');
        expect(list).toContain('if (retrying.value) return');
        expect(list).toContain('groupBy(props.grouped, false');
        expect(list).not.toContain('reloadSprintTasks');
        const itemList = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'organisms', 'ItemList', 'ItemList.vue'), 'utf8');
        expect(itemList).toContain('sameGroupValue');
        expect(itemList).toContain('unmatchedBoardTasks');
        expect(itemList).toContain('visibleTaskRows');
        expect(itemList).toContain('searchMode');
        expect(itemList).toContain('idBearingTaskRows');
        expect(itemList).toContain('props.item && props.item.tasksArray');
        expect(itemList).toContain('visibleCount');
        expect(itemList).toContain('taskRowKey');
        expect(itemList).not.toContain('v-if="!isLoading"');
        expect(board).toContain('hasGroups');
        expect(board).toContain('sprintExpectedCount');
        expect(board).toContain('sameGroupValue');
        expect(board).toContain('appendUnmatchedToFirstGroup');
        expect(board).toContain('resetSprintTaskBucket');
        expect(board).toContain('refetchSprintBoardTasks');
        expect(board).toContain('boardCount: shownBoardCount.value');
        expect(board).toContain('storedCount: stored');
        expect(board).toContain('sprintTreeExpectedCount');
        expect(board).toContain('sprintCountFromSprintBags');
        expect(board).toContain('projectData/allProjects');
        expect(board).toContain('bindSprintTaskSource');
        expect(board).toContain("emptyKind === 'ready' && shownBoardCount > 0");
        expect(board).toContain("provide('boardSurfaceKind', emptyKind)");
        expect(board).toContain('const retrying = ref(false)');
        expect(board).toContain('if (retrying.value) return');
        expect(board).toContain('groupBy(props.grouped, false');
        expect(board).not.toContain('reloadSprintTasks');
        expect(board).not.toContain('Math.max(shownBoardCount.value, stored)');
        expect(board).not.toContain('runGroup(false)');
        const helper = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'views', 'Projects', 'helper.js'), 'utf8');
        expect(helper).toContain('refetchSprintBoardTasks');
        expect(helper).toContain('unfiltered: true');
        expect(helper).toContain('resetCursor: true');
        expect(helper).toContain('showAllTasks: true');
        expect(helper).toContain("lView === 'list' || lView === 'board'");
        const actions = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'store', 'ProjectData', 'actions.js'), 'utf8');
        expect(actions).toContain('sprintTasksBucket');
        expect(actions).toContain('unfiltered');
        expect(actions).toContain('resetCursor');
        expect(actions).toContain('sprintTasksBucket(state.tasks, pid, sprintId)');
        expect(actions).toContain('setSprintBoardTasks');
        expect(actions).toContain('ProjectID: { objId: { $in: [pid] } }');
        const mutations = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'store', 'ProjectData', 'mutations.js'), 'utf8');
        expect(mutations).toContain('lookupById(state.tasks, pid)');
        expect(mutations).toContain('lookupById(project, sprintId)');
        expect(mutations).toContain('setSprintBoardTasks');
        const sprintsList = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'organisms', 'SprinstList', 'SprintsList.vue'), 'utf8');
        expect(sprintsList).toContain('boardHoursVisible');
        expect(sprintsList).toContain('v-if="showSprintHours"');
        expect(sprintsList).toContain('data-board-hours');
        expect(sprintsList).toContain('hoursFetched');
        expect(sprintsList).toContain("kind === 'loading' || kind === 'failed'");
        expect(sprintsList).toContain("if (!hoursFetched.value) return '—'");
        expect(sprintsList).toContain("surfaceKind === 'failed'");
        expect(sprintsList).toContain('EmptyState.load_failed_title');
        expect(sprintsList).toContain('retrySurface');
        expect(sprintsList).toContain('retrySurface');
        expect(sprintsList).toContain('sprintSurfaceKind');
        expect(sprintsList).toContain('sprintSid');
        expect(sprintsList).toContain('localStored');
        expect(sprintsList).toContain('storedCount: localStored.value');
        expect(sprintsList).toContain('paintedForKind');
        expect(sprintsList).toContain('listVisible');
        expect(sprintsList).toContain("paintedForKind = computed(() => listVisible.value)");
        expect(sprintsList).not.toContain('groupsReported.value ? listVisible.value : localPainted.value');
        expect(sprintsList).not.toContain('countPaintedTaskRows(props.sprint');
        expect(sprintsList).toContain('onItemVisible');
        expect(sprintsList).toContain('sprintTreeExpectedCount');
        expect(sprintsList).toContain('sprintCountFromSprintBags');
        expect(sprintsList).toContain("v-show=\"surfaceKind === 'ready'\"");
        expect(sprintsList).toContain('projectData/allProjects');
        expect(itemList).toContain('props.sprintObject && (props.sprintObject.id || props.sprintObject._id)');
        const empty = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'atom', 'EmptyState', 'EmptyState.vue'), 'utf8');
        expect(empty).toContain('@mousedown.stop.prevent="onActionPointer"');
        expect(empty).toContain('@click.stop.prevent="onActionClick"');
        expect(empty).toContain('skipClick');
        expect(empty).toContain("emit('action')");
        const locale = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'locales', 'en.js'), 'utf8');
        expect(empty).toContain('empty-state--pine');
        expect(empty).toContain('empty-state--copper');
        expect(empty).toContain('#f4ead8');
        expect(empty).not.toContain('#172b4d');
        expect(empty).not.toContain('#2f6fdb');
        expect(locale).toContain('No tasks in this sprint.');
        expect(locale).toContain("Couldn't load this board.");
        expect(locale).toContain("This sprint has {count} tasks. They didn't show here.");
        expect(locale).toContain('Loading this board…');
        expect(locale).toContain('search_open: "Open"');
        expect(locale).toContain("You don't have this page.");
        expect(locale).toContain("This page isn't in {project}.");
        expect(locale).toContain('Opening {title}…');
        expect(locale).toContain('Back to Pages');
        expect(locale).not.toContain('Page not in a project you can open');
        expect(locale).not.toContain("Couldn't load tasks");
    });
});

describe('PAGES DEEP LINK - project-scoped hash before first paint', () => {
    const CID = '6a8ee973d625fca52e519a12';
    const PROJECT = '6a8f09301f05e701eaf45c9a';
    const PAGE = '6a8f0aaa0000000000000002';

    test('pageOpenRoute builds /projects/pid/pages and fails closed without cid or pid', () => {
        expect(pageOpenRoute({
            companyId: CID,
            projectId: PROJECT,
            pageId: PAGE,
        })).toEqual({
            name: 'ProjectPages',
            params: { cid: CID, projectId: PROJECT },
            query: { page: PAGE },
        });
        expect(pageOpenPath({ companyId: CID, projectId: PROJECT, pageId: PAGE }))
            .toBe(`/${CID}/projects/${PROJECT}/pages?page=${PAGE}`);
        expect(pageOpenPath({ companyId: CID, projectId: PROJECT }))
            .toBe(`/${CID}/projects/${PROJECT}/pages`);
        expect(pageOpenRoute({ companyId: CID, pageId: PAGE })).toBe(null);
        expect(pageOpenRoute({ projectId: PROJECT, pageId: PAGE })).toBe(null);
        expect(pageDeepLinkNeedsResolve({ pageId: PAGE, projectId: '', routeName: 'Pages' })).toBe(true);
        expect(pageDeepLinkNeedsResolve({ pageId: PAGE, projectId: PROJECT, routeName: 'Pages' })).toBe(false);
        expect(pageDeepLinkNeedsResolve({ pageId: PAGE, projectId: '', routeName: 'ProjectPages' })).toBe(false);
        expect(pageProjectId({ ProjectID: { $oid: PROJECT } })).toBe(PROJECT);
        expect(pageProjectId({ projectId: PROJECT })).toBe(PROJECT);
        expect(pageProjectId({ ProjectID: { $oid: PROJECT }, projectId: '[object Object]' })).toBe(PROJECT);
        expect(pageProjectId({ title: 'Ask smoke' })).toBe('');
        expect(pageOpeningLine('Ask smoke')).toBe('Opening Ask smoke…');
        expect(pageOpeningLine('')).toBe('Opening…');
        expect(pageFromGetResponse({
            data: { status: true, data: { _id: PAGE, ProjectID: { $oid: PROJECT }, projectId: '[object Object]' } },
        })).toEqual({ _id: PAGE, ProjectID: { $oid: PROJECT }, projectId: '[object Object]' });
        expect(pageProjectId(pageFromGetResponse({
            data: { status: true, data: { _id: PAGE, ProjectID: { type: 'Buffer', data: PROJECT.match(/.{2}/g).map((h) => parseInt(h, 16)) } } },
        }))).toBe(PROJECT);
        expect(pageFromGetResponse({ data: { status: false, statusText: 'Page not found.' } })).toBe(null);
        const routerSrc = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'router', 'index.js'), 'utf8');
        const resolveSrc = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'router', 'pages', 'resolvePageDeepLink.js'), 'utf8');
        const space = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'views', 'Pages', 'PagesSpace.vue'), 'utf8');
        const getPage = fs.readFileSync(path.join(__dirname, '..', 'Modules', 'Pages', 'controller.js'), 'utf8');
        expect(routerSrc).toContain('resolvePageDeepLink');
        expect(resolveSrc).toContain('pageOpenRoute');
        expect(resolveSrc).toContain('pageFromGetResponse');
        expect(resolveSrc).toContain('pageProjectId');
        expect(resolveSrc).toContain('/api/v2/pages/');
        expect(resolveSrc).toContain('companyId');
        expect(resolveSrc).not.toContain('unresolved');
        expect(resolveSrc).toContain('fetchPageRow');
        expect(resolveSrc).not.toContain('pageDeepLinkNeedsResolve');
        expect(resolveSrc).toContain('knownPid');
        expect(resolveSrc).toContain('/\\/pages\\/?$/');
        expect(space).toContain('route.params.projectId');
        expect(space).toContain('boundProject');
        expect(space).toContain('PagesPanel');
        expect(space).toContain("kind === 'opening'");
        expect(space).toContain('pages-space__opening');
        expect(space).toContain('pageOpeningLine');
        expect(space).toContain("kind === 'forbidden' || kind === 'missing'");
        expect(space).not.toContain("missingProjectName.value = projectNameOf(bound) || t('Projects.pages_project_none')");
        expect(space).toContain('page_no_access');
        expect(space).toContain('page_not_in_named_project');
        expect(space).toContain('page_back_to_pages');
        expect(space).not.toContain('page_not_in_project');
        expect(space).not.toContain('PagesPanel v-if="true"');
        const panel = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'molecules', 'Pages', 'PagesPanel.vue'), 'utf8');
        expect(panel).toContain('workspaceSideKicker');
        expect(panel).toContain('ensurePageInList');
        expect(panel).toContain('pageFromGetResponse');
        expect(panel).toContain('!rows.length && !current');
        expect(panel).toContain('loadTree');
        expect(panel).toContain('workspace && routePageId.value && !projectId.value');
        expect(panel).toContain('workspaceProjectId.value = pid');
        expect(getPage).toContain('attachProjectsToPages');
        const pageProject = require('../Modules/Pages/helpers/pageProject');
        expect(pageProject.stampPageProject({ title: 'Ask smoke' }, PROJECT)).toEqual({
            title: 'Ask smoke',
            ProjectID: PROJECT,
            projectId: PROJECT,
        });
        expect(pageProject.asPlainPage({
            title: 'Ask smoke',
            ProjectID: { $oid: PROJECT },
            toObject() { return { title: 'Ask smoke', ProjectID: { $oid: PROJECT } }; },
        }).ProjectID).toBe(PROJECT);
        expect(pageProject.asPlainPage({
            title: 'Ask smoke',
            ProjectID: { toHexString: () => PROJECT },
        }).ProjectID).toBe(PROJECT);
    });
});
