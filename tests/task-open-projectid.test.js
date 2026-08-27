'use strict';

const fs = require('fs');
const path = require('path');
const {
    resolveOpenProjectId,
    firstId,
    shapeOpenTaskHit,
    shouldShowTaskSkeleton,
    shouldShowTaskChrome,
    bindSprintsToProject,
    sameId,
} = require('../Modules/Project/helpers/taskOpenProjectId');

describe('TASK OPEN - pass ProjectID so taskData is not empty', () => {
    test('prefers the task ProjectID over an empty query', () => {
        expect(firstId('', 'undefined', null, '  abc  ')).toBe('abc');
        expect(firstId({ toHexString: () => '64b7f0c2a1b2c3d4e5f60711' })).toBe('64b7f0c2a1b2c3d4e5f60711');
        expect(firstId({ $oid: '64b7f0c2a1b2c3d4e5f60711' })).toBe('64b7f0c2a1b2c3d4e5f60711');
        expect(firstId({ _id: '64b7f0c2a1b2c3d4e5f60711' })).toBe('64b7f0c2a1b2c3d4e5f60711');
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
        expect(advance).toContain('@click="openModel(props.taskObj)"');
        expect(detail).toContain('resolveOpenProjectId');
        expect(detail).toContain('task_not_in_project');
        expect(detail).toContain('openBlocked');
        expect(detail).toContain('showTaskChrome');
        expect(detail).not.toContain('if (!resolvedProjectId.value || !props.taskId) return;');
        expect(query).toContain('resolvedProjectId');
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
        expect(listing).toContain('bindSprintsToProject');
        expect(listing).toContain('sameId(item._id, id)');
        expect(listing).toContain('resolve([])');
        expect(sprintFolder).toContain('function projectIdMatch');
        expect(sprintFolder).toContain('exports.projectIdMatch = projectIdMatch');
        expect(sprintFolder).toContain('$in');
        expect(list).toContain('EmptyState.no_match_title');
        expect(board).toContain('EmptyState.no_match_title');
        expect(list).toContain('props.sprints && props.sprints.length');
        expect(board).toContain('props.sprints && props.sprints.length');
    });
});
