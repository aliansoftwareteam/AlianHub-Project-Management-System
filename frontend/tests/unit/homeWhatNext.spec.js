import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, ref } from 'vue';
import { createStore } from 'vuex';
import moment from 'moment';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/composable', () => ({ useMoment: () => ({ changeDateFormate: (value) => value }) }));
vi.mock('@/components/molecules/Home/usePersonalList', () => ({ usePersonalList: () => ({}) }));
vi.mock('@/utils/TaskOperations', () => ({ default: {} }));
vi.mock('@/utils/NotificationTemplate', () => ({ taskDueDateAdd: vi.fn(), taskDueDateChange: vi.fn() }));

import * as env from '@/config/env';
import { NEXT, useWhatNext, whatNext } from '@/components/molecules/Home/whatNext';
import HomeWhatNext from '@/components/molecules/Home/HomeWhatNext.vue';
import { useMyWork } from '@/components/molecules/Home/useMyWork';

const ME = 'user-1';
const day = (offset) => moment().add(offset, 'day').toISOString();
const task = (id, due, over = {}) => ({ _id: id, TaskName: id, ProjectID: 'p1', AssigneeUserId: [ME], DueDate: due, ...over });

let serverTasks;
let serverCounts;

const answer = (type, url) => {
    if (type === 'post' && url === `${env.TASK}/find`) return Promise.resolve({ data: serverTasks });
    if (type === 'get' && url === `${env.INBOX}/counts`) return Promise.resolve({ data: { status: true, data: serverCounts } });
    return Promise.resolve({ data: { status: false } });
};

const store = () => createStore({
    modules: { projectData: { namespaced: true, getters: { allProjects: () => ({ data: [{ _id: 'p1', ProjectName: 'Launch' }] }) } } }
});

const openHome = async ({ waiting = 0, empty = false, canCreateProject = false, canOpenInbox = true } = {}) => {
    const Host = defineComponent({
        setup() {
            const work = useMyWork({ companyId: ref('company-1'), userId: ref(ME), dateFormat: ref('') });
            const whatsNext = useWhatNext({ work, waiting: ref(waiting), empty: ref(empty), canCreateProject: ref(canCreateProject), canOpenInbox: ref(canOpenInbox) });
            work.fetchOpen();
            whatsNext.load();
            return { work, next: whatsNext.next };
        },
        render: () => null
    });
    const wrapper = mount(Host, { global: { plugins: [store()] } });
    await flushPromises();
    return wrapper.vm;
};

beforeEach(() => {
    apiRequest.mockReset();
    apiRequest.mockImplementation(answer);
    serverTasks = [];
    serverCounts = { approval: 0, approvals: 0, proposals: 0, primary: 0 };
});

describe('what next, in order', () => {
    it('an empty workspace offers one step: a project to whoever may create one, a task to whoever may not', () => {
        expect(whatNext({ empty: true, canCreateProject: true })).toEqual({ kind: NEXT.START_PROJECT, count: 0 });
        expect(whatNext({ empty: true, canCreateProject: false })).toEqual({ kind: NEXT.START_TASK, count: 0 });
    });

    it('the sample project\'s tasks do not stand in for a start', () => {
        expect(whatNext({ empty: true, canCreateProject: true, overdue: 1, today: 3 })).toEqual({ kind: NEXT.START_PROJECT, count: 0 });
        expect(whatNext({ empty: true, approvals: 1 })).toEqual({ kind: NEXT.APPROVALS, count: 1 });
    });

    it('approvals come before everything else', () => {
        expect(whatNext({ approvals: 3, waiting: 4, overdue: 2, today: 5 })).toEqual({ kind: NEXT.APPROVALS, count: 3 });
    });

    it('what the Waiting on you card holds comes next, when the Inbox tab holds nothing', () => {
        expect(whatNext({ waiting: 2, overdue: 1 })).toEqual({ kind: NEXT.WAITING, count: 2 });
    });

    it('then overdue work, then today', () => {
        expect(whatNext({ overdue: 2, today: 5 })).toEqual({ kind: NEXT.OVERDUE, count: 2 });
        expect(whatNext({ today: 5 })).toEqual({ kind: NEXT.TODAY, count: 5 });
    });

    it('with nothing to do it says so', () => {
        expect(whatNext({})).toEqual({ kind: NEXT.CLEAR, count: 0 });
        expect(whatNext({ canCreateProject: true })).toEqual({ kind: NEXT.CLEAR, count: 0 });
    });
});

describe('the numbers on the line are the linked screens\' own', () => {
    it('approvals: the count the Inbox shows on its approval tab', async () => {
        serverCounts = { approval: 2, approvals: 1, proposals: 1, primary: 9 };
        serverTasks = [task('late', day(-2))];
        const home = await openHome();
        expect(home.next).toEqual({ kind: NEXT.APPROVALS, count: 2 });
    });

    it('overdue and today: the rows My work lists under those headings', async () => {
        serverTasks = [task('late-1', day(-3)), task('late-2', day(-1)), task('now', day(0)), task('later', day(4))];
        const home = await openHome();
        expect(home.next).toEqual({ kind: NEXT.OVERDUE, count: home.work.groups.overdue.length });
        expect(home.next.count).toBe(2);

        serverTasks = [task('now-1', day(0)), task('now-2', day(0)), task('later', day(4))];
        const calm = await openHome();
        expect(calm.next).toEqual({ kind: NEXT.TODAY, count: calm.work.groups.today.length });
        expect(calm.next.count).toBe(2);
    });

    it('nothing is read beyond My work\'s tasks and the Inbox count', async () => {
        await openHome();
        const asked = apiRequest.mock.calls.map(([type, url]) => `${type} ${url}`).sort();
        expect(asked).toEqual([`get ${env.INBOX}/counts`, `post ${env.TASK}/find`]);
    });

    it('a task in a project the person cannot open is not counted', async () => {
        serverTasks = [task('late', day(-2)), task('elsewhere', day(-2), { ProjectID: 'p-not-mine' })];
        const home = await openHome();
        expect(home.next).toEqual({ kind: NEXT.OVERDUE, count: 1 });
    });

    it('says nothing until both reads have answered, and treats a failed count as none', async () => {
        apiRequest.mockImplementation((type, url) => (type === 'get' ? Promise.reject(new Error('offline')) : answer(type, url)));
        serverTasks = [task('now', day(0))];
        const home = await openHome();
        expect(home.next).toEqual({ kind: NEXT.TODAY, count: 1 });

        apiRequest.mockImplementation(() => new Promise(() => {}));
        expect((await openHome()).next).toBeNull();
    });

    it('a workspace with no Inbox asks for no count', async () => {
        await openHome({ canOpenInbox: false });
        expect(apiRequest.mock.calls.some(([type]) => type === 'get')).toBe(false);
    });
});

describe('the line on Home', () => {
    const line = (next) => mount(HomeWhatNext, { props: { next } });

    it.each([
        [NEXT.APPROVALS, 3],
        [NEXT.WAITING, 1],
        [NEXT.OVERDUE, 2],
        [NEXT.TODAY, 4],
        [NEXT.START_PROJECT, 0],
        [NEXT.START_TASK, 0],
        [NEXT.CLEAR, 0]
    ])('%s: one sentence and one button that says what it does', async (kind, count) => {
        const wrapper = line({ kind, count });
        expect(wrapper.find('[data-test="home-next"]').attributes('data-kind')).toBe(kind);
        expect(wrapper.find('[data-test="home-next-line"]').text()).toBe(`Home.next_${kind}`);
        const buttons = wrapper.findAll('button');
        expect(buttons).toHaveLength(1);
        expect(buttons[0].text()).toBe(`Home.next_${kind}_action`);
        await buttons[0].trigger('click');
        expect(wrapper.emitted('act')).toEqual([[kind]]);
    });
});
