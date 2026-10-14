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
import { NEXT, dueCountsPreferringOwn, useWhatNext, whatNext } from '@/components/molecules/Home/whatNext';
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
            return { work, next: whatsNext.next, team: whatsNext.team };
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
    serverCounts = { approval: 0, approvalOwn: 0, approvalTeam: 0, approvals: 0, proposals: 0, primary: 0 };
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

    it('the person\'s own work due soon comes before approvals, which may be other people\'s agents asking', () => {
        expect(whatNext({ approvals: 3, waiting: 4, overdue: 2, today: 5, soon: 1 })).toEqual({ kind: NEXT.OVERDUE, count: 2 });
        expect(whatNext({ approvals: 3, waiting: 4, today: 5, soon: 1 })).toEqual({ kind: NEXT.TODAY, count: 5 });
        expect(whatNext({ approvals: 6, waiting: 6, soon: 1 })).toEqual({ kind: NEXT.SOON, count: 1 });
    });

    it('then approvals, then what the Waiting on you card holds', () => {
        expect(whatNext({ approvals: 3, waiting: 4 })).toEqual({ kind: NEXT.APPROVALS, count: 3 });
        expect(whatNext({ waiting: 2 })).toEqual({ kind: NEXT.WAITING, count: 2 });
    });

    it('with nothing to do it says so', () => {
        expect(whatNext({})).toEqual({ kind: NEXT.CLEAR, count: 0 });
        expect(whatNext({ canCreateProject: true })).toEqual({ kind: NEXT.CLEAR, count: 0 });
    });
});

describe('the numbers on the line are the linked screens\' own', () => {
    it('approvals: only what was filed for the person; what waits for the team is counted apart', async () => {
        serverCounts = { approval: 5, approvalOwn: 2, approvalTeam: 3, approvals: 1, proposals: 4, primary: 9 };
        serverTasks = [task('far', day(30))];
        const home = await openHome();
        expect(home.next).toEqual({ kind: NEXT.APPROVALS, count: 2 });
        expect(home.team).toBe(3);
    });

    it('a queue that holds only the team\'s proposals does not ask for the person\'s approval', async () => {
        serverCounts = { approval: 4, approvalOwn: 0, approvalTeam: 4, approvals: 0, proposals: 4, primary: 0 };
        serverTasks = [task('late', day(-2))];
        const home = await openHome();
        expect(home.next).toEqual({ kind: NEXT.OVERDUE, count: 1 });
        expect(home.team).toBe(4);
    });

    it('the team\'s proposals the Waiting on you card also lists are not said as waiting on the person', async () => {
        serverCounts = { approval: 1, approvalOwn: 0, approvalTeam: 1, approvals: 0, proposals: 1, primary: 0 };
        expect((await openHome({ waiting: 1 })).next).toEqual({ kind: NEXT.CLEAR, count: 0 });
        expect((await openHome({ waiting: 3 })).next).toEqual({ kind: NEXT.WAITING, count: 2 });
    });

    it('overdue and today: the rows My work lists under those headings', async () => {
        serverTasks = [task('late-1', day(-3)), task('late-2', day(-1)), task('now', day(0)), task('later', day(4))];
        const home = await openHome();
        expect(home.next).toEqual({ kind: NEXT.OVERDUE, count: home.work.groups.value.overdue.length });
        expect(home.next.count).toBe(2);

        serverTasks = [task('now-1', day(0)), task('now-2', day(0)), task('later', day(4))];
        const calm = await openHome();
        expect(calm.next).toEqual({ kind: NEXT.TODAY, count: calm.work.groups.value.today.length });
        expect(calm.next.count).toBe(2);
    });

    it('due soon: a task of the person\'s own in the next week, ahead of approvals; a far one is not soon', async () => {
        serverCounts = { approval: 6, approvals: 6, proposals: 6, primary: 0 };
        serverTasks = [task('friday', day(3)), task('far', day(30))];
        const home = await openHome();
        expect(home.next).toEqual({ kind: NEXT.SOON, count: 1 });
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

    it('what waits for the team is a quieter second link, shown only when there is some', async () => {
        const wrapper = mount(HomeWhatNext, { props: { next: { kind: NEXT.CLEAR, count: 0 }, team: 3 } });
        const link = wrapper.find('[data-test="home-next-team"]');
        expect(link.text()).toBe('Home.next_team');
        expect(link.classes()).not.toContain('ah-btn--primary');
        await link.trigger('click');
        expect(wrapper.emitted('act')).toEqual([[NEXT.TEAM]]);
        expect(mount(HomeWhatNext, { props: { next: { kind: NEXT.CLEAR, count: 0 }, team: 0 } }).find('[data-test="home-next-team"]').exists()).toBe(false);
    });
});

describe('what next, on a workspace that started with the sample project', () => {
    const SAMPLE = 'sample-1';
    const groupsOf = (tasks) => ({
        overdue: tasks.filter((t) => moment(t.DueDate).isBefore(moment().startOf('day'))),
        today: tasks.filter((t) => moment(t.DueDate).isSame(moment(), 'day')),
        next: tasks.filter((t) => moment(t.DueDate).isAfter(moment().endOf('day'))),
    });

    it('points at the person\'s own work before the sample project\'s', () => {
        const groups = groupsOf([task('start-here', day(0), { ProjectID: SAMPLE }), task('book-movers', day(3), { ProjectID: 'move' })]);
        const counts = dueCountsPreferringOwn(groups, SAMPLE);
        expect(counts).toEqual({ overdue: 0, today: 0, soon: 1 });
        expect(whatNext(counts)).toEqual({ kind: NEXT.SOON, count: 1 });
    });

    it('falls back to the sample project while the person has nothing of their own due', () => {
        const groups = groupsOf([task('start-here', day(0), { ProjectID: SAMPLE }), task('someday', day(30), { ProjectID: 'move' })]);
        expect(whatNext(dueCountsPreferringOwn(groups, SAMPLE))).toEqual({ kind: NEXT.TODAY, count: 1 });
    });

    it('counts everything when there is no sample project', () => {
        const groups = groupsOf([task('a', day(0)), task('b', day(-2))]);
        expect(dueCountsPreferringOwn(groups, '')).toEqual({ overdue: 1, today: 1, soon: 0 });
    });
});
