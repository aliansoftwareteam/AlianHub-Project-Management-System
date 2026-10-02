/* Task 047 S-5: a project whose statuses hold no opening one still takes a new task, in its first status,
   as quick create and the server-side creators already do. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, test } from 'vitest';
import { defaultStatus } from '@/components/organisms/QuickCreateTask/quickCreateTask';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const source = (file) => fs.readFileSync(path.resolve(HERE, '../../src', file), 'utf8');

describe('the status a new task starts in', () => {
    test('is the opening status of the project', () => {
        const statuses = [{ key: 3, name: 'Doing', type: 'active' }, { key: 1, name: 'To Do', type: 'default_active' }];
        expect(defaultStatus({ taskStatusData: statuses }).key).toBe(1);
    });

    test('is the first status when none is marked as the opening one', () => {
        const statuses = [{ key: 3, name: 'Doing', type: 'active' }, { key: 6, name: 'Done', type: 'close' }];
        expect(defaultStatus({ taskStatusData: statuses }).key).toBe(3);
    });

    test.each([
        'components/atom/CreateTask/CreateTask.vue',
        'views/Projects/Kanban/BoardViewTaskCreate.vue',
    ])('%s picks it by the shared rule', (file) => {
        expect(source(file)).toContain('defaultStatus(project.value)');
        expect(source(file)).not.toMatch(/findIndex\(\(x\) => x\.type === "default_active"\)/);
    });
});
