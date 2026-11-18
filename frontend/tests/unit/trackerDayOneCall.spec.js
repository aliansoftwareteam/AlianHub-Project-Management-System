/* Tenth sweep, defects 13 and 14: the Tracker timesheet reads a day in one call, and the priority filter shows the
   icon the rest of the app shows instead of asking storage for a picture it never held. */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services', () => ({ apiRequest: vi.fn(), apiRequestWithoutCompnay: vi.fn() }));
vi.mock('@/store/index', () => ({ default: { getters: {}, commit: () => {}, dispatch: () => Promise.resolve(), state: {} } }));

import { dayRange, hourSlots, hoursWithLogs, logsOf, shotsIn } from '@/views/Timesheet/TrackerTimeSheet/trackerDay';
import { bundledPriorityIcon } from '@/composable/commonFunction';

const SRC = path.resolve(__dirname, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const DAY = new Date(2026, 9, 2, 15, 30);
const at = (hour, minute = 0) => new Date(2026, 9, 2, hour, minute).getTime();
const seconds = (ms) => Math.floor(ms / 1000);
const log = (from, to, more = {}) => ({ ProjectId: 'p1', Loggeduser: 'u1', TicketID: 't1', LogDescription: 'memo', LogStartTime: seconds(from), LogEndTime: seconds(to), trackShots: [], ...more });
const answer = (...logs) => [{ _id: { userId: 'u1' }, data: logs }];
const PROJECTS = [{ _id: 'p1', ProjectName: 'Alpha', ProjectCode: 'AL' }];

describe('a day of the Tracker timesheet', () => {
    it('is asked for as one span, from its first second to its last', () => {
        const { start, end } = dayRange(DAY);
        expect(start).toBe(seconds(at(0)));
        expect(end).toBe(seconds(new Date(2026, 9, 3, 0, 0).getTime()));
    });

    it('is cut into its twenty-four hours in the browser', () => {
        const slots = hourSlots(DAY);
        expect(slots).toHaveLength(24);
        expect(slots[9]).toMatchObject({ time: 9, start: at(9), end: at(10) });
    });

    it('marks the hours a log reaches, as the server marked them hour by hour', () => {
        const logs = logsOf(answer(log(at(9, 20), at(11, 5)), log(at(14), at(14, 30))), PROJECTS);
        expect(hoursWithLogs(logs, hourSlots(DAY))).toEqual([9, 10, 11, 13, 14]);
    });

    it('leaves out the logs of a project this person does not see', () => {
        const logs = logsOf(answer(log(at(9), at(10), { ProjectId: 'hidden' })), PROJECTS);
        expect(logs).toEqual([]);
        expect(hoursWithLogs(logs, hourSlots(DAY))).toEqual([]);
    });

    it('hands an hour the screenshots taken in it, oldest first, with the project named', () => {
        const shots = [{ screenShotTime: at(9, 50), image: 'b.png' }, { screenShotTime: at(9, 10), image: 'a.png' }, { screenShotTime: at(10, 5), image: 'c.png' }];
        const logs = logsOf(answer(log(at(9), at(11), { trackShots: shots })), PROJECTS);
        const inNine = shotsIn(logs, hourSlots(DAY)[9], { projects: PROJECTS, userOf: () => ({ Employee_Name: 'Olive', Employee_profileImageURL: 'o.png' }), companyId: 'c1' });
        expect(inNine.map((shot) => shot.image)).toEqual(['a.png', 'b.png']);
        expect(inNine[0]).toMatchObject({ time: at(9, 10), userId: 'u1', userName: 'Olive', projectName: 'Alpha', projectKey: 'AL', taskId: 't1', projectId: 'p1', companyId: 'c1', memoName: 'memo' });
    });

    it('takes an answer that names no times as one whose screenshots say when it ran', () => {
        const old = { ProjectId: 'p1', Loggeduser: 'u1', trackShots: [{ screenShotTime: at(16, 10), image: 'x.png' }] };
        expect(hoursWithLogs(logsOf(answer(old), PROJECTS), hourSlots(DAY))).toEqual([16]);
    });
});

describe('the Tracker timesheet screen', () => {
    const SCREEN = read('views/Timesheet/TrackerTimeSheet/TrackerTimesheet.vue');

    it('asks the server in one place, and never once an hour', () => {
        expect(SCREEN.match(/\$\{env\.TIMESHEET\}\/tracker/g)).toHaveLength(1);
        expect(SCREEN).not.toMatch(/executeQuery/);
        expect(SCREEN).not.toMatch(/batchObject/);
    });
});

describe('the picture of a priority in the task filter', () => {
    it('is the app\'s own icon for a priority that came with the app', () => {
        expect(bundledPriorityIcon({ value: 'HIGH', statusImage: 'taskPriorities/priority_high.png' })).toBeTruthy();
        expect(bundledPriorityIcon({ value: 'LOW', statusImage: '' })).toBeTruthy();
    });

    it('is none for a picture the company uploaded, which storage holds, or for a priority the app has no icon for', () => {
        expect(bundledPriorityIcon({ value: 'HIGH', statusImage: 'c1/priorities/own.png' })).toBe('');
        expect(bundledPriorityIcon({ value: 'URGENT', statusImage: 'taskPriorities/urgent.png' })).toBe('');
    });

    it('is what the filter draws, asking storage only for an uploaded picture', () => {
        const FILTER = read('components/molecules/TaskFilter/FieldsTable.vue');
        expect(FILTER).not.toMatch(/<WasabiIamgeCompp v-if="option\.statusImage"/);
        expect(FILTER.match(/v-if="bundledPriorityIcon\(option\)"/g)).toHaveLength(2);
        expect(FILTER.match(/<WasabiIamgeCompp v-else-if="storedOptionImage\(option\)"/g)).toHaveLength(2);
    });
});
