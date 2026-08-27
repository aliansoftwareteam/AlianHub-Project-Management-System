'use strict';

const fs = require('fs');
const path = require('path');
const { resolveOpenProjectId, firstId } = require('../Modules/Project/helpers/taskOpenProjectId');

describe('TASK OPEN - pass ProjectID so taskData is not empty', () => {
    test('prefers the task ProjectID over an empty query', () => {
        expect(firstId('', 'undefined', null, '  abc  ')).toBe('abc');
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
        expect(search).toContain('@click.stop="openTask(task)"');
        expect(advance).toContain('@click="openModel(props.taskObj)"');
        expect(detail).toContain('resolveOpenProjectId');
        expect(query).toContain('resolvedProjectId');
    });
});
