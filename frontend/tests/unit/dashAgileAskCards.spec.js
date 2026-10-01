import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { h, ref } from 'vue';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import BurndownCard from '@/components/organisms/BurndownCard/BurndownCard.vue';
import VelocityCard from '@/components/organisms/VelocityCard/VelocityCard.vue';
import AskAQuestionCard from '@/components/organisms/AskAQuestionCard/AskAQuestionCard.vue';
import CardSettings from '@/views/Dashboards/CardSettings.vue';
import { catalogEntry, isBuiltCard } from '@/plugins/dashboard/cardCatalog';
import { cardComponent } from '@/plugins/dashboard/cardRegistry';
import { AI_STATE, applyAiAvailability, resetAiAvailability } from '@/composable/aiAvailability';
import { burndownSeries, velocityScale, sprintChoices } from '@/views/Projects/Reports/composables/agileReports';
import { ApexChart, clickRefresh, clickRetry, mountInShell } from '../cardInShell';

enableAutoUnmount(afterEach);

const RouterLink = { name: 'RouterLink', props: ['to'], render() { return h('a', { 'data-test': 'cite-link' }, this.$slots.default && this.$slots.default()); } };

const mountCard = async (component, props = {}, { userId = 'user-1' } = {}) => {
    const { wrapper, shown } = mountInShell(component, {
        props,
        global: { provide: { $userId: ref(userId), $companyId: ref('company-1') }, stubs: { RouterLink } },
    });
    await flushPromises();
    return { wrapper, shown };
};

const ok = (data) => ({ data: { status: true, data } });

describe('the catalogue', () => {
    it.each(['BurndownCard', 'VelocityCard', 'AskAQuestionCard'])('lets %s be added, renders it and gives it settings', (key) => {
        expect(isBuiltCard(key)).toBe(true);
        expect(cardComponent(key)).not.toBeNull();
        const entry = catalogEntry(key);
        expect(entry.emptyKey).toBeTruthy();
        expect(Array.isArray(entry.settings) && entry.settings.length).toBeTruthy();
    });

    it('asks for a sprint for Burndown, a project for Velocity and a question for Ask', () => {
        const required = (key) => catalogEntry(key).settings.filter((f) => f.required).map((f) => f.name);
        expect(required('BurndownCard')).toEqual(['projectId', 'sprintId']);
        expect(required('VelocityCard')).toEqual(['projectId']);
        expect(required('AskAQuestionCard')).toEqual(['question']);
    });
});

describe('the shared agile chart helpers', () => {
    it('keeps a day the sprint has not reached as a gap, in points or in tasks', () => {
        const days = [
            { date: 'd1', remainingPoints: 8, idealPoints: 8, remainingCount: 4, ideal: 4 },
            { date: 'd2', remainingPoints: null, idealPoints: 4, remainingCount: null, ideal: 2 },
        ];
        expect(burndownSeries(days, { remaining: 'R', ideal: 'I' })).toEqual([
            { name: 'R', data: [8, null] },
            { name: 'I', data: [8, 4] },
        ]);
        expect(burndownSeries(days, { metric: 'count', remaining: 'R', ideal: 'I' })[0].data).toEqual([4, null]);
    });

    it('scales velocity bars to the tallest of committed, completed and the forecast', () => {
        const rows = [{ committed: 10, completed: 5 }, { committed: 4, completed: 8 }];
        const scale = velocityScale(rows, { barHeight: 100 });
        expect(scale.heightOf(10)).toBe('100px');
        expect(scale.heightOf(5)).toBe('50px');
        expect(scale.heightOf(0)).toBe('2px');
        expect(scale.completedOf(rows[1])).toBe(8);
    });

    it('offers sprints and lists, never folders, backlogs, chats or deleted ones', () => {
        const list = [
            { _id: 's1', name: 'Sprint 1' },
            { _id: 'f1', name: 'Folder', isFolder: true },
            { _id: 'b1', name: 'Backlog', isBacklog: true },
            { _id: 'c1', name: 'Chat', mainChat: true },
            { _id: 'x1', name: 'Gone', deletedStatusKey: 1 },
        ];
        expect(sprintChoices(list).map((s) => s._id)).toEqual(['s1']);
    });
});

describe('Burndown card', () => {
    beforeEach(() => { apiRequest.mockReset(); });

    it('asks for a sprint rather than loading anything when none is chosen', async () => {
        const { shown } = await mountCard(BurndownCard, { cardData: {} });
        expect(apiRequest).not.toHaveBeenCalled();
        expect(shown.state).toBe('empty');
        expect(shown.emptyText).toBe('Dash.burndown_pick_sprint');
    });

    it('loads the chosen sprint from the burndown report and charts it', async () => {
        apiRequest.mockResolvedValue(ok({ sprintName: 'Sprint 4', totalPoints: 12, days: [
            { date: '2026-09-01', remainingPoints: 12, idealPoints: 12 },
            { date: '2026-09-02', remainingPoints: 7, idealPoints: 6 },
        ] }));
        const { wrapper, shown } = await mountCard(BurndownCard, { cardData: { projectId: 'p1', sprintId: 's1' } });
        expect(apiRequest).toHaveBeenCalledWith('get', '/api/v1/agile/burndown?sprintId=s1');
        expect(shown.state).toBe('ready');
        expect(wrapper.find('[data-test="burndown-remaining"]').text()).toBe('7');
        expect(wrapper.findComponent(ApexChart).props('series')[0].data).toEqual([12, 7]);
    });

    it('is empty when the sprint has no tasks yet', async () => {
        apiRequest.mockResolvedValue(ok({ sprintName: 'Sprint 4', days: [] }));
        const { shown } = await mountCard(BurndownCard, { cardData: { projectId: 'p1', sprintId: 's1' } });
        expect(shown.state).toBe('empty');
        expect(shown.emptyText).toBe('Dash.burndown_no_tasks');
    });

    it('reports an error it cannot read past, and reloads on the dashboard refresh', async () => {
        apiRequest.mockRejectedValue(new Error('down'));
        const { wrapper, shown } = await mountCard(BurndownCard, { cardData: { projectId: 'p1', sprintId: 's1' } });
        expect(shown.state).toBe('error');
        apiRequest.mockResolvedValue(ok({ days: [{ date: 'd', remainingPoints: 1, idealPoints: 1 }] }));
        await wrapper.setProps({ refreshTrigger: 1 });
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledTimes(2);
        expect(shown.state).toBe('ready');
    });
});

describe('Velocity card', () => {
    beforeEach(() => { apiRequest.mockReset(); });

    const sprints = (n) => Array.from({ length: n }, (_, i) => ({ sprintId: `s${i}`, name: `Sprint ${i}`, committed: 10, completed: 8 + i }));

    it('asks for a project rather than loading anything when none is chosen', async () => {
        const { shown } = await mountCard(VelocityCard, { cardData: {} });
        expect(apiRequest).not.toHaveBeenCalled();
        expect(shown.state).toBe('empty');
        expect(shown.emptyText).toBe('Dash.velocity_pick_project');
    });

    it('loads the last N sprints of the chosen project and draws a bar pair for each', async () => {
        apiRequest.mockResolvedValue(ok({ sprints: sprints(4), skipped: 0 }));
        const { wrapper, shown } = await mountCard(VelocityCard, { cardData: { projectId: 'p1', sprintCount: 4 } });
        expect(apiRequest).toHaveBeenCalledWith('get', '/api/v1/agile/velocity?projectId=p1&limit=4');
        expect(shown.state).toBe('ready');
        expect(wrapper.findAll('[data-test="velocity-sprint"]')).toHaveLength(4);
        expect(wrapper.find('[data-test="velocity-average"]').text()).toBe('10');
    });

    it('keeps the sprint count inside the range the report allows', async () => {
        apiRequest.mockResolvedValue(ok({ sprints: [] }));
        await mountCard(VelocityCard, { cardData: { projectId: 'p1', sprintCount: 99 } });
        expect(apiRequest).toHaveBeenLastCalledWith('get', '/api/v1/agile/velocity?projectId=p1&limit=12');
        await mountCard(VelocityCard, { cardData: { projectId: 'p1' } });
        expect(apiRequest).toHaveBeenLastCalledWith('get', '/api/v1/agile/velocity?projectId=p1&limit=6');
    });

    it('is empty when no sprint has closed yet, and an error when the report fails', async () => {
        apiRequest.mockResolvedValue(ok({ sprints: [] }));
        const empty = await mountCard(VelocityCard, { cardData: { projectId: 'p1' } });
        expect(empty.shown.state).toBe('empty');
        apiRequest.mockRejectedValue(new Error('down'));
        const failed = await mountCard(VelocityCard, { cardData: { projectId: 'p1' } });
        expect(failed.shown.state).toBe('error');
    });
});

describe('Ask card', () => {
    const CARD_URL = '/api/v1/ai/ask/card/dash-1/c1';
    const CITED = [{ kind: 'task', id: 't1', ref: 'OPS-1', title: 'Budget review', project: 'Ops', projectId: 'p1' }];
    const HOUR = 60 * 60 * 1000;

    /* What Modules/AI/askCard answers: a GET hands back the viewer's kept answer, a POST asks and keeps it. */
    const askServer = ({ text = 'Two are late [OPS-1].' } = {}) => {
        const server = { kept: null, stale: false, refreshDue: false, reads: 0, asks: [], text, reply: null };
        apiRequest.mockImplementation(async (method, url, body) => {
            if (url !== CARD_URL) throw new Error(`unexpected ${method} ${url}`);
            if (method === 'get') {
                server.reads += 1;
                return ok({ stored: server.kept, stale: server.stale, refreshDue: server.refreshDue });
            }
            server.asks.push(body);
            if (server.reply) return server.reply(body);
            server.kept = { question: body.question, projectId: body.projectId || '', answer: server.text, cited: CITED, askedAt: Date.now() };
            server.stale = false;
            server.refreshDue = false;
            return ok({ configured: true, answer: server.text, cited: CITED, askedAt: server.kept.askedAt });
        });
        return server;
    };

    const keep = (server, over = {}) => {
        server.kept = { question: 'What is late?', projectId: '', answer: 'Two are late [OPS-1].', cited: CITED, askedAt: Date.now(), ...over };
        return server;
    };

    const mountAsk = (cardData = { question: 'What is late?' }, { userId = ref('user-1'), dashboardId = 'dash-1' } = {}) => mountInShell(AskAQuestionCard, {
        props: { cardData },
        global: { provide: { $userId: userId, $companyId: ref('company-1'), dashboardId: ref(dashboardId) }, stubs: { RouterLink } },
    });
    const answerText = (wrapper) => wrapper.find('[data-test="ask-card-answer"]').text();

    beforeEach(() => {
        apiRequest.mockReset();
        resetAiAvailability();
        applyAiAvailability({ state: AI_STATE.ON, loaded: true, planAllowsAi: true });
    });
    afterEach(() => { vi.useRealTimers(); });

    it('asks for a question rather than calling the model when none is saved', async () => {
        const server = askServer();
        const { shown } = mountAsk({});
        await flushPromises();
        expect(apiRequest).not.toHaveBeenCalled();
        expect(server.asks).toHaveLength(0);
        expect(shown.state).toBe('empty');
        expect(shown.emptyText).toBe('Dash.ask_pick_question');
    });

    it('asks the saved question once and shows the answer with its citations', async () => {
        const server = askServer();
        const { wrapper, shown } = mountAsk({ question: 'What is late?', projectId: 'p1' });
        await flushPromises();
        expect(server.asks).toEqual([{ question: 'What is late?', projectId: 'p1' }]);
        expect(shown.state).toBe('ready');
        expect(answerText(wrapper)).toContain('Two are late');
        const cites = wrapper.findAll('[data-test="ask-card-cite"]');
        expect(cites).toHaveLength(1);
        expect(cites[0].text()).toContain('Budget review');
    });

    it('shows the kept answer when the dashboard is opened again, without asking', async () => {
        const server = askServer();
        const first = mountAsk();
        await flushPromises();
        first.wrapper.unmount();

        const second = mountAsk();
        await flushPromises();
        expect(server.asks).toHaveLength(1);
        expect(second.shown.state).toBe('ready');
        expect(answerText(second.wrapper)).toContain('Two are late');

        second.wrapper.unmount();
        const third = mountAsk();
        await flushPromises();
        expect(server.asks).toHaveLength(1);
        expect(third.shown.state).toBe('ready');
    });

    it('says how old a kept answer is', async () => {
        keep(askServer(), { askedAt: Date.now() - 3 * HOUR });
        const { shown } = mountAsk();
        await flushPromises();
        expect(shown.note).toContain('Dash.updated_hours');
        expect(shown.note).toContain('Dash.ask_note');
        expect(shown.note).not.toContain('Dash.ask_note_from');
    });

    it('asks once more when the person refreshes the card', async () => {
        const server = askServer();
        const { wrapper } = mountAsk();
        await flushPromises();
        server.text = 'Now one is late [OPS-1].';
        await clickRefresh(wrapper);
        await flushPromises();
        expect(server.asks).toEqual([{ question: 'What is late?' }, { question: 'What is late?', fresh: true }]);
        expect(answerText(wrapper)).toContain('Now one is late');
    });

    it('asks again when the question or the project it searches changes', async () => {
        const server = keep(askServer());
        const { wrapper } = mountAsk();
        await flushPromises();
        expect(server.asks).toHaveLength(0);

        await wrapper.setProps({ cardData: { question: 'What is blocked?' } });
        await flushPromises();
        expect(server.asks).toEqual([{ question: 'What is blocked?' }]);

        await wrapper.setProps({ cardData: { question: 'What is blocked?', projectId: 'p2' } });
        await flushPromises();
        expect(server.asks).toHaveLength(2);
        expect(server.asks[1]).toEqual({ question: 'What is blocked?', projectId: 'p2' });
    });

    it('does not ask again for a setting that changes neither', async () => {
        const server = keep(askServer());
        const { wrapper } = mountAsk();
        await flushPromises();
        await wrapper.setProps({ cardData: { question: 'What is late?', fieldName: 'Renamed' } });
        await flushPromises();
        expect(server.asks).toHaveLength(0);
        expect(server.reads).toBe(1);
    });

    it('shows an answer past its limit with the time it is from, and asks once when a refresh is due', async () => {
        const server = keep(askServer(), { askedAt: Date.now() - 30 * HOUR });
        server.stale = true;
        server.refreshDue = true;
        const waiting = [];
        server.reply = () => new Promise((resolve) => { waiting.push(resolve); });
        const { wrapper, shown } = mountAsk();
        await flushPromises();

        expect(shown.state).toBe('ready');
        expect(answerText(wrapper)).toContain('Two are late');
        expect(shown.note).toContain('Dash.ask_note_from');
        expect(server.asks).toEqual([{ question: 'What is late?' }]);

        waiting[0](ok({ configured: true, answer: 'Now one is late [OPS-1].', cited: CITED, askedAt: Date.now() }));
        await flushPromises();
        expect(answerText(wrapper)).toContain('Now one is late');
        expect(shown.note).not.toContain('Dash.ask_note_from');
    });

    it('keeps showing an answer past its limit, without asking, when no refresh is due', async () => {
        const server = keep(askServer(), { askedAt: Date.now() - 30 * HOUR });
        server.stale = true;
        const { wrapper, shown } = mountAsk();
        await flushPromises();
        expect(server.asks).toHaveLength(0);
        expect(shown.state).toBe('ready');
        expect(answerText(wrapper)).toContain('Two are late');
        expect(shown.note).toContain('Dash.ask_note_from');
    });

    it('keeps the old answer and its note when the refresh that was due fails', async () => {
        const server = keep(askServer(), { askedAt: Date.now() - 30 * HOUR });
        server.stale = true;
        server.refreshDue = true;
        server.reply = async () => { throw new Error('down'); };
        const { wrapper, shown } = mountAsk();
        await flushPromises();
        expect(server.asks).toHaveLength(1);
        expect(shown.state).toBe('ready');
        expect(answerText(wrapper)).toContain('Two are late');
        expect(shown.note).toContain('Dash.ask_note_from');
    });

    it('sends one request when the user id arrives after the card has mounted', async () => {
        const server = askServer();
        const userId = ref('');
        mountAsk({ question: 'What is late?' }, { userId });
        await flushPromises();
        userId.value = 'user-1';
        await flushPromises();
        expect(server.reads).toBe(1);
        expect(server.asks).toHaveLength(1);
    });

    it('sends one request when it is told to load again while the first is on its way', async () => {
        const server = askServer();
        const waiting = [];
        server.reply = () => new Promise((resolve) => { waiting.push(resolve); });
        const { wrapper, shown } = mountAsk();
        await flushPromises();
        expect(server.asks).toHaveLength(1);

        await wrapper.setProps({ cardData: { question: 'What is late?', refreshAfter: '6' } });
        await flushPromises();
        expect(server.reads).toBe(1);
        expect(server.asks).toHaveLength(1);

        waiting[0](ok({ configured: true, answer: 'Two are late [OPS-1].', cited: CITED, askedAt: Date.now() }));
        await flushPromises();
        expect(server.asks).toHaveLength(1);
        expect(shown.state).toBe('ready');
    });

    it('stops waiting and offers a retry when it never learns whether AI is available', async () => {
        vi.useFakeTimers();
        const server = askServer();
        resetAiAvailability();
        const { wrapper, shown } = mountAsk();
        await flushPromises();
        expect(shown.state).toBe('loading');

        await vi.advanceTimersByTimeAsync(15000);
        expect(shown.state).toBe('error');
        expect(shown.error).toBe('Dash.ask_availability_unknown');
        expect(wrapper.find('[data-test="dcard-retry"]').exists()).toBe(true);
        expect(server.asks).toHaveLength(0);

        applyAiAvailability({ state: AI_STATE.ON, loaded: true, planAllowsAi: true });
        await flushPromises();
        expect(shown.state).toBe('ready');
        expect(server.asks).toHaveLength(1);
    });

    it('has nowhere to keep an answer outside a dashboard, so it does not ask', async () => {
        const server = askServer();
        const { shown } = mountAsk({ question: 'What is late?' }, { dashboardId: '' });
        await flushPromises();
        expect(apiRequest).not.toHaveBeenCalled();
        expect(server.asks).toHaveLength(0);
        expect(shown.state).toBe('error');
    });

    it('says AI is off rather than asking', async () => {
        const server = askServer();
        applyAiAvailability({ state: AI_STATE.OFF_WORKSPACE });
        const { shown } = mountAsk();
        await flushPromises();
        expect(apiRequest).not.toHaveBeenCalled();
        expect(server.asks).toHaveLength(0);
        expect(shown.state).toBe('empty');
        expect(shown.emptyText).toBe('AiAvailability.off_workspace_member');
    });

    it('says the plan does not include AI rather than asking', async () => {
        askServer();
        applyAiAvailability({ planAllowsAi: false });
        const { shown } = mountAsk();
        await flushPromises();
        expect(apiRequest).not.toHaveBeenCalled();
        expect(shown.state).toBe('empty');
        expect(shown.emptyText).toBe('Dash.ask_not_permitted');
    });

    it('says no model is set up when Ask answers without one', async () => {
        const server = askServer();
        server.reply = async () => ok({ configured: false, answer: '', sources: [] });
        const { shown } = mountAsk();
        await flushPromises();
        expect(shown.state).toBe('empty');
        expect(shown.emptyText).toBe('AiAvailability.unconfigured_member');
    });

    it('says nothing matched when the viewer can open nothing relevant', async () => {
        const server = askServer();
        server.reply = async () => ok({ configured: true, answer: '', sources: [], emptyCode: 'no_match' });
        const { shown } = mountAsk();
        await flushPromises();
        expect(shown.state).toBe('empty');
        expect(shown.emptyText).toBe('Ask.empty_no_match');
    });

    it('names the spend cap when the workspace budget is used up', async () => {
        const server = askServer();
        server.reply = async () => ({ data: { status: false, statusText: 'Budget used', code: 'ai_budget_exhausted' } });
        const { shown } = mountAsk();
        await flushPromises();
        expect(shown.state).toBe('error');
        expect(shown.error).toBe('Dash.ask_budget_exhausted');
    });

    it('reports an error it cannot read past, and tries the same load again on retry', async () => {
        const server = askServer();
        server.reply = async () => { throw new Error('down'); };
        const { wrapper, shown } = mountAsk();
        await flushPromises();
        expect(shown.state).toBe('error');

        server.reply = null;
        await clickRetry(wrapper);
        await flushPromises();
        expect(shown.state).toBe('ready');
        expect(server.asks).toEqual([{ question: 'What is late?' }, { question: 'What is late?' }]);
    });
});

describe('card settings form', () => {
    const burndownFields = () => catalogEntry('BurndownCard').settings;
    const projects = [{ _id: 'p1', ProjectName: 'Website' }, { _id: 'p2', ProjectName: 'App' }];
    const mountForm = async (fields, cardData = {}) => {
        const wrapper = mount(CardSettings, { props: { fields, cardData, projects } });
        await flushPromises();
        return wrapper;
    };

    beforeEach(() => { apiRequest.mockReset(); });

    it('offers the chosen project\'s sprints and forgets the sprint when the project changes', async () => {
        apiRequest.mockResolvedValue({ data: { data: [{ _id: 's1', name: 'Sprint 1' }, { _id: 'b1', name: 'Backlog', isBacklog: true }] } });
        const wrapper = await mountForm(burndownFields(), { projectId: 'p1', sprintId: 's1' });
        expect(apiRequest).toHaveBeenCalledWith('get', '/api/v1/project/sprintFolder/p1?collection=sprints');
        expect(wrapper.findAll('[data-test="csf-sprintId"] option').map((o) => o.element.value)).toEqual(['', 's1']);
        expect(wrapper.find('[data-test="csf-sprintId"]').element.value).toBe('s1');

        await wrapper.find('[data-test="csf-projectId"]').setValue('p2');
        await flushPromises();
        await wrapper.find('form').trigger('submit');
        expect(wrapper.emitted('save')).toBeUndefined();
        expect(wrapper.find('[data-test="csf-error"]').text()).toBe('Dash.settings_required');
    });

    it('saves the sprint, the measure and a sprint count kept inside its range', async () => {
        apiRequest.mockResolvedValue({ data: { data: [{ _id: 's1', name: 'Sprint 1' }] } });
        const burndown = await mountForm(burndownFields(), { projectId: 'p1' });
        await burndown.find('[data-test="csf-sprintId"]').setValue('s1');
        await burndown.find('[data-test="csf-metric"]').setValue('count');
        await burndown.find('form').trigger('submit');
        expect(burndown.emitted('save')[0][0]).toEqual({ projectId: 'p1', sprintId: 's1', metric: 'count' });

        const velocity = await mountForm(catalogEntry('VelocityCard').settings, { projectId: 'p2' });
        await velocity.find('[data-test="csf-sprintCount"]').setValue(40);
        await velocity.find('form').trigger('submit');
        expect(velocity.emitted('save')[0][0]).toEqual({ projectId: 'p2', sprintCount: 12 });
    });

    it('saves a trimmed question with or without a project', async () => {
        const wrapper = await mountForm(catalogEntry('AskAQuestionCard').settings);
        await wrapper.find('[data-test="csf-question"]').setValue('  What is late?  ');
        await wrapper.find('form').trigger('submit');
        expect(wrapper.emitted('save')[0][0]).toEqual({ question: 'What is late?', projectId: '', refreshAfter: '24' });
        expect(apiRequest).not.toHaveBeenCalled();
    });

    it('offers how long an answer is kept before it is asked again: a day unless changed, or never', async () => {
        const field = catalogEntry('AskAQuestionCard').settings.find((f) => f.name === 'refreshAfter');
        expect(field.options.map((o) => o.id)).toEqual(['1', '6', '24', '168', 'never']);
        const wrapper = await mountForm(catalogEntry('AskAQuestionCard').settings, { question: 'What is late?' });
        expect(wrapper.find('[data-test="csf-refreshAfter"]').element.value).toBe('24');
        await wrapper.find('[data-test="csf-refreshAfter"]').setValue('never');
        await wrapper.find('form').trigger('submit');
        expect(wrapper.emitted('save')[0][0]).toEqual({ question: 'What is late?', projectId: '', refreshAfter: 'never' });
    });
});
