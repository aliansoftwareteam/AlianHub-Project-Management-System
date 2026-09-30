import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { h, reactive, ref } from 'vue';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import BurndownCard from '@/components/organisms/BurndownCard/BurndownCard.vue';
import VelocityCard from '@/components/organisms/VelocityCard/VelocityCard.vue';
import AskAQuestionCard from '@/components/organisms/AskAQuestionCard/AskAQuestionCard.vue';
import { forgetAskAnswers } from '@/components/organisms/AskAQuestionCard/askCardCache';
import CardSettings from '@/views/Dashboards/CardSettings.vue';
import { CARD_META_KEY } from '@/components/organisms/DashboardCard/useCardMeta';
import { catalogEntry, isBuiltCard } from '@/plugins/dashboard/cardCatalog';
import { cardComponent } from '@/plugins/dashboard/cardRegistry';
import { AI_STATE, applyAiAvailability, resetAiAvailability } from '@/composable/aiAvailability';
import { burndownSeries, velocityScale, sprintChoices } from '@/views/Projects/Reports/composables/agileReports';

enableAutoUnmount(afterEach);

const ApexChart = { name: 'ApexChart', props: ['series', 'options', 'type', 'height'], render: () => h('div', { 'data-test': 'apex' }) };
const RouterLink = { name: 'RouterLink', props: ['to'], render() { return h('a', { 'data-test': 'cite-link' }, this.$slots.default && this.$slots.default()); } };

const mountCard = async (component, props = {}, { userId = 'user-1' } = {}) => {
    const meta = reactive({ state: 'loading', note: '', updatedAt: null, emptyText: '', emptyAction: '', error: '' });
    const wrapper = mount(component, {
        props,
        global: {
            provide: { [CARD_META_KEY]: meta, $userId: ref(userId), $companyId: ref('company-1') },
            stubs: { ApexChart, RouterLink },
        },
    });
    await flushPromises();
    return { wrapper, meta };
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
        const { meta } = await mountCard(BurndownCard, { cardData: {} });
        expect(apiRequest).not.toHaveBeenCalled();
        expect(meta.state).toBe('empty');
        expect(meta.emptyText).toBe('Dash.burndown_pick_sprint');
    });

    it('loads the chosen sprint from the burndown report and charts it', async () => {
        apiRequest.mockResolvedValue(ok({ sprintName: 'Sprint 4', totalPoints: 12, days: [
            { date: '2026-09-01', remainingPoints: 12, idealPoints: 12 },
            { date: '2026-09-02', remainingPoints: 7, idealPoints: 6 },
        ] }));
        const { wrapper, meta } = await mountCard(BurndownCard, { cardData: { projectId: 'p1', sprintId: 's1' } });
        expect(apiRequest).toHaveBeenCalledWith('get', '/api/v1/agile/burndown?sprintId=s1');
        expect(meta.state).toBe('ready');
        expect(wrapper.find('[data-test="burndown-remaining"]').text()).toBe('7');
        expect(wrapper.findComponent(ApexChart).props('series')[0].data).toEqual([12, 7]);
    });

    it('is empty when the sprint has no tasks yet', async () => {
        apiRequest.mockResolvedValue(ok({ sprintName: 'Sprint 4', days: [] }));
        const { meta } = await mountCard(BurndownCard, { cardData: { projectId: 'p1', sprintId: 's1' } });
        expect(meta.state).toBe('empty');
        expect(meta.emptyText).toBe('Dash.burndown_no_tasks');
    });

    it('reports an error it cannot read past, and reloads on the dashboard refresh', async () => {
        apiRequest.mockRejectedValue(new Error('down'));
        const { wrapper, meta } = await mountCard(BurndownCard, { cardData: { projectId: 'p1', sprintId: 's1' } });
        expect(meta.state).toBe('error');
        apiRequest.mockResolvedValue(ok({ days: [{ date: 'd', remainingPoints: 1, idealPoints: 1 }] }));
        await wrapper.setProps({ refreshTrigger: 1 });
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledTimes(2);
        expect(meta.state).toBe('ready');
    });
});

describe('Velocity card', () => {
    beforeEach(() => { apiRequest.mockReset(); });

    const sprints = (n) => Array.from({ length: n }, (_, i) => ({ sprintId: `s${i}`, name: `Sprint ${i}`, committed: 10, completed: 8 + i }));

    it('asks for a project rather than loading anything when none is chosen', async () => {
        const { meta } = await mountCard(VelocityCard, { cardData: {} });
        expect(apiRequest).not.toHaveBeenCalled();
        expect(meta.state).toBe('empty');
        expect(meta.emptyText).toBe('Dash.velocity_pick_project');
    });

    it('loads the last N sprints of the chosen project and draws a bar pair for each', async () => {
        apiRequest.mockResolvedValue(ok({ sprints: sprints(4), skipped: 0 }));
        const { wrapper, meta } = await mountCard(VelocityCard, { cardData: { projectId: 'p1', sprintCount: 4 } });
        expect(apiRequest).toHaveBeenCalledWith('get', '/api/v1/agile/velocity?projectId=p1&limit=4');
        expect(meta.state).toBe('ready');
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
        expect(empty.meta.state).toBe('empty');
        apiRequest.mockRejectedValue(new Error('down'));
        const failed = await mountCard(VelocityCard, { cardData: { projectId: 'p1' } });
        expect(failed.meta.state).toBe('error');
    });
});

describe('Ask card', () => {
    const answer = (text = 'Two are late [OPS-1].') => ok({
        configured: true,
        mode: 'ask',
        answer: text,
        cited: [{ kind: 'task', id: 't1', ref: 'OPS-1', title: 'Budget review', project: 'Ops', projectId: 'p1' }],
        sources: [{ kind: 'task', id: 't1', ref: 'OPS-1', title: 'Budget review', project: 'Ops', projectId: 'p1' }],
    });

    beforeEach(() => {
        apiRequest.mockReset();
        forgetAskAnswers();
        resetAiAvailability();
        applyAiAvailability({ state: AI_STATE.ON, loaded: true, planAllowsAi: true });
    });

    it('asks for a question rather than calling the model when none is saved', async () => {
        const { meta } = await mountCard(AskAQuestionCard, { cardData: {} });
        expect(apiRequest).not.toHaveBeenCalled();
        expect(meta.state).toBe('empty');
        expect(meta.emptyText).toBe('Dash.ask_pick_question');
    });

    it('asks the saved question through Ask and shows the answer with its citations', async () => {
        apiRequest.mockResolvedValue(answer());
        const { wrapper, meta } = await mountCard(AskAQuestionCard, { cardData: { question: 'What is late?', projectId: 'p1' } });
        expect(apiRequest).toHaveBeenCalledWith('post', '/api/v1/ai/ask', { question: 'What is late?', mode: 'ask', projectId: 'p1' });
        expect(meta.state).toBe('ready');
        expect(wrapper.find('[data-test="ask-card-answer"]').text()).toContain('Two are late');
        const cites = wrapper.findAll('[data-test="ask-card-cite"]');
        expect(cites).toHaveLength(1);
        expect(cites[0].text()).toContain('Budget review');
    });

    it('keeps an answer for the viewer who asked, and asks again for anyone else', async () => {
        apiRequest.mockResolvedValue(answer());
        await mountCard(AskAQuestionCard, { cardData: { question: 'What is late?' } }, { userId: 'user-1' });
        await mountCard(AskAQuestionCard, { cardData: { question: 'What is late?' } }, { userId: 'user-1' });
        expect(apiRequest).toHaveBeenCalledTimes(1);
        const other = await mountCard(AskAQuestionCard, { cardData: { question: 'What is late?' } }, { userId: 'user-2' });
        expect(apiRequest).toHaveBeenCalledTimes(2);
        expect(other.meta.state).toBe('ready');
    });

    it('asks afresh on the dashboard refresh', async () => {
        apiRequest.mockResolvedValue(answer());
        const { wrapper } = await mountCard(AskAQuestionCard, { cardData: { question: 'What is late?' } });
        apiRequest.mockResolvedValue(answer('Now one is late [OPS-1].'));
        await wrapper.setProps({ refreshTrigger: 1 });
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledTimes(2);
        expect(wrapper.find('[data-test="ask-card-answer"]').text()).toContain('Now one is late');
    });

    it('says AI is off rather than asking', async () => {
        applyAiAvailability({ state: AI_STATE.OFF_WORKSPACE });
        const { meta } = await mountCard(AskAQuestionCard, { cardData: { question: 'What is late?' } });
        expect(apiRequest).not.toHaveBeenCalled();
        expect(meta.state).toBe('empty');
        expect(meta.emptyText).toBe('AiAvailability.off_workspace_member');
    });

    it('says the plan does not include AI rather than asking', async () => {
        applyAiAvailability({ planAllowsAi: false });
        const { meta } = await mountCard(AskAQuestionCard, { cardData: { question: 'What is late?' } });
        expect(apiRequest).not.toHaveBeenCalled();
        expect(meta.state).toBe('empty');
        expect(meta.emptyText).toBe('Dash.ask_not_permitted');
    });

    it('says no model is set up when Ask answers without one', async () => {
        apiRequest.mockResolvedValue(ok({ configured: false, answer: '', sources: [] }));
        const { meta } = await mountCard(AskAQuestionCard, { cardData: { question: 'What is late?' } });
        expect(meta.state).toBe('empty');
        expect(meta.emptyText).toBe('AiAvailability.unconfigured_member');
    });

    it('says nothing matched when the viewer can open nothing relevant', async () => {
        apiRequest.mockResolvedValue(ok({ configured: true, answer: '', sources: [], emptyCode: 'no_match' }));
        const { meta } = await mountCard(AskAQuestionCard, { cardData: { question: 'What is late?' } });
        expect(meta.state).toBe('empty');
        expect(meta.emptyText).toBe('Ask.empty_no_match');
    });

    it('names the spend cap when the workspace budget is used up', async () => {
        apiRequest.mockResolvedValue({ data: { status: false, statusText: 'Budget used', code: 'ai_budget_exhausted' } });
        const { meta } = await mountCard(AskAQuestionCard, { cardData: { question: 'What is late?' } });
        expect(meta.state).toBe('error');
        expect(meta.error).toBe('Dash.ask_budget_exhausted');
    });

    it('reports an error it cannot read past', async () => {
        apiRequest.mockRejectedValue(new Error('down'));
        const { meta } = await mountCard(AskAQuestionCard, { cardData: { question: 'What is late?' } });
        expect(meta.state).toBe('error');
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
        expect(wrapper.emitted('save')[0][0]).toEqual({ question: 'What is late?', projectId: '' });
        expect(apiRequest).not.toHaveBeenCalled();
    });
});
