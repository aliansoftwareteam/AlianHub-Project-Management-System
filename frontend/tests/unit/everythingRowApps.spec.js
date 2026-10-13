/* Task 046 M2, slice E2: a row on the Everything page belongs to its own project, and no project
   is selected on that page. `@/composable` is the real one here: its checkApps reads the project
   from inject('selectedProject'), which would answer for no project at all, so the row has to be
   handed its project and decide from that. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import fixture from '../fixtures/everythingResponses.json';

vi.mock('@/services', () => ({ apiRequest: vi.fn(), apiRequestWithoutCompnay: vi.fn(), apiRequestWithoutSecure: vi.fn() }));

// The store and the composable import each other; the app loads the store first, and so must this.
import '@/store';
import EverythingRow from '@/views/Everything/EverythingRow.vue';
import { useCustomComposable } from '@/composable';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/views/Everything');
const WEB = '6f0000000000000000000a01';
const OPS = '6f0000000000000000000a02';
const cards = fixture.withSubtasks.response.data.projects;
const taskIn = (projectId, over = {}) => ({
    ...fixture.withDone.response.data.rows[0], ProjectID: projectId, TaskKey: projectId === WEB ? 'WEB-9' : 'OPS-9', AssigneeUserId: [], Task_Priority: 'HIGH', ...over
});

const mountRow = (project, { planFeature = { projectProjectApp: true }, task = taskIn(project._id) } = {}) => mount(EverythingRow, {
    props: { task, project },
    global: {
        plugins: [createStore({
            getters: {
                'settings/companyPriority': () => [{ value: 'HIGH', name: 'High' }],
                'settings/selectedCompany': () => ({ planFeature }),
                'settings/companyMembers': () => [],
                'settings/teams': () => [],
                'users/users': () => []
            }
        })],
        stubs: { Sidebar: true, PriorityComp: { render() { return this.$slots.trigger?.({ open: () => {} }); } } }
    }
});

describe('a row decides from the project it is handed', () => {
    it('shows priority for a project with the Priority app and not for one without', () => {
        expect(cards[WEB].apps).toEqual([{ key: 'Priority' }]);
        expect(cards[OPS].apps).toEqual([]);
        expect(mountRow(cards[WEB]).find('.evr__prio').text()).toBe('High');
        expect(mountRow(cards[OPS]).find('.evr__prio').text()).toBe('');
    });

    it('shows no priority when the plan does not include the app, whatever the project says', () => {
        expect(mountRow(cards[WEB], { planFeature: { projectProjectApp: false } }).find('.evr__prio').text()).toBe('');
        expect(mountRow(cards[WEB], { planFeature: null }).find('.evr__prio').text()).toBe('');
    });

    it('offers the status of the row\'s project, named by that project', () => {
        const waiting = { status: { key: 4, text: 'Waiting on a supplier', type: 'active' }, statusKey: 4, statusType: 'active' };
        const row = mountRow(cards[OPS], { task: taskIn(OPS, waiting) });
        expect(row.find('.evr__status').text()).toBe('Waiting on a supplier');
        expect(row.find('.evr__key').text()).toBe('OPS-9');
        expect(row.find('.evr__project').attributes('title')).toBe('Operations');
    });

    it('still renders when its project is not on the page yet', () => {
        const row = mountRow(null, { task: taskIn(WEB) });
        expect(row.find('.evr__name').text()).toBe(taskIn(WEB).TaskName);
        expect(row.find('.evr__prio').text()).toBe('');
    });
});

describe('the inject trap', () => {
    it('is real: with no selected project, checkApps says no even for a project that has the app', () => {
        const Probe = { setup: () => ({ answer: useCustomComposable().checkApps('Priority') }), render: () => null };
        expect(mount(Probe).vm.answer).toBe(false);
    });

    it('is not something the page relies on: nothing under views/Everything calls checkApps or injects a selected project', () => {
        const offenders = fs.readdirSync(SRC)
            .filter((file) => /\.(vue|js)$/.test(file))
            .filter((file) => /checkApps|selectedProject/.test(fs.readFileSync(path.join(SRC, file), 'utf8')));
        expect(offenders).toEqual([]);
    });
});
