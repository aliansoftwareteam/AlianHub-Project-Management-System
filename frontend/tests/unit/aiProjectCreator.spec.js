import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { h, nextTick } from 'vue';

const { apiRequest, push, stub } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    push: vi.fn(),
    stub: (name) => ({ default: { name, render: () => null } })
}));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-router', () => ({
    useRouter: () => ({ push }),
    useRoute: () => ({ params: { cid: 'company-1' }, query: {} })
}));
vi.mock('@/components/molecules/SkillsSelect/SkillsSelect.vue', () => stub('SkillsSelect'));
vi.mock('@/components/molecules/ProjectSourceSelect/ProjectSourceSelect.vue', () => stub('ProjectSourceSelect'));
vi.mock('@/components/molecules/Sidebar/Sidebar.vue', () => ({
    default: {
        name: 'Sidebar',
        render() {
            const s = this.$slots;
            return h('div', [s['head-left'] && s['head-left'](), s['head-right'] && s['head-right'](), s.body && s.body()]);
        }
    }
}));

import AiProjectCreator from '@/components/organisms/AiProjectCreator/AiProjectCreator.vue';
import * as env from '@/config/env';

const ok = (data) => Promise.resolve({ data: { status: true, data } });

const allMet = { what_for_whom: 'met', done_when: 'met', existing: 'met', constraints: 'met', team: 'met' };
const twoMissing = { ...allMet, done_when: 'missing', constraints: 'missing' };

const question = (id, point) => ({ id, point, question: `Q ${point}`, type: 'text', options: [], required: false, allowUnknown: true });

const brief = {
    sections: { what_for_whom: 'A shop for makers', done_when: 'First order ships', existing: 'Shopify trial', constraints: '6 weeks', team: 'Two people' },
    assumptions: [{ point: 'constraints', text: 'No launch date given; planning for a 6-week first release.' }],
    markdown: '## What and for whom\nA shop for makers\n## Assumptions\n- No launch date given'
};

const plan = {
    project: { ProjectName: 'Maker Shop', ProjectCode: 'MS', description: 'A shop for makers', projectIcon: { emoji: '🛍️', backgroundColor: '#eee' }, skills: [] },
    sprints: [{
        sprintName: 'Sprint 1',
        tasks: [
            { TaskName: 'QA the checkout on https://shop.example', estimatedHours: 1, split: { label: 'agent', skill: 'qa-review', reason: 'public URL present', need: null }, subtasks: [] },
            { TaskName: 'Summarise the theme PR', estimatedHours: 1, split: { label: 'agent-after', skill: 'pr.summary', reason: 'no PR link yet', need: 'pr_link' }, subtasks: [] },
            { TaskName: 'Pick the payment provider', estimatedHours: 2, split: { label: 'person', skill: null, reason: 'a human decision', need: null },
                subtasks: [{ TaskName: 'Compare fees', estimatedHours: 1, split: { label: 'person', skill: null, reason: 'a human decision', need: null } }] }
        ]
    }],
    splitSummary: { agent: 1, agentAfter: 1, person: 1 },
    assumptions: brief.assumptions
};

const guide = {
    stages: [{ name: 'Discovery', goal: 'Confirm the catalogue' }, { name: 'Launch', goal: 'First order ships' }],
    essentials: ['Payment provider'],
    escalations: ['Budget over 6 weeks'],
    style: 'Start with the clearest next step',
    markdown: '# Guide\n## Stages\n1. Discovery'
};

class FakeEventSource {
    constructor() { FakeEventSource.last = this; this.onmessage = null; this.onerror = null; }
    emit(payload) { this.onmessage({ data: JSON.stringify(payload) }); }
    close() {}
}

function routes({ clarify, briefResponse = brief, planResponse = plan, guideResponse = guide, execute } = {}) {
    apiRequest.mockImplementation((method, url, body) => {
        if (url === env.AI_PROJECT_CLARIFY) return Promise.resolve({ data: { status: true, data: clarify(body) } });
        if (url === env.AI_PROJECT_BRIEF) return ok({ brief: briefResponse, coverage: allMet });
        if (url === env.AI_PROJECT_PLAN) return Promise.resolve({ data: { status: true, plan: planResponse, planId: 'plan-1' } });
        if (url === env.AI_PROJECT_GUIDE) return ok({ guide: guideResponse });
        if (url === env.AI_PROJECT_EXECUTE) return ok(execute || { jobId: 'job-1' });
        return Promise.resolve({ data: { status: false } });
    });
}

const callsTo = (url) => apiRequest.mock.calls.filter((c) => c[1] === url);

function mountCreator() {
    const store = createStore({ getters: { 'settings/projectSkills': () => [] } });
    return mount(AiProjectCreator, { props: { visible: true }, global: { plugins: [store] } });
}

const describeProject = (wrapper) => wrapper.find('textarea.aipg-textarea').setValue('An online shop for makers selling handmade goods to hobbyists.');

async function describeAndStart(wrapper) {
    await describeProject(wrapper);
    wrapper.vm.source = 'other';
    await nextTick();
    await wrapper.find('[data-test="start"]').trigger('click');
    await flushPromises();
}

async function reachPreview(wrapper) {
    await describeAndStart(wrapper);
    await wrapper.find('[data-test="approve-brief"]').trigger('click');
    await wrapper.find('[data-test="generate-plan"]').trigger('click');
    await flushPromises();
}

const buttonByText = (wrapper, text) => wrapper.findAll('button').find((b) => b.text() === text);

describe('AiProjectCreator guided flow', () => {
    beforeEach(() => {
        apiRequest.mockReset();
        push.mockReset();
        window.EventSource = FakeEventSource;
    });

    it('skips Clarify when the coverage is all met and drafts the brief straight away', async () => {
        routes({ clarify: () => ({ coverage: allMet, round: 1, maxRounds: 2, questions: [], understanding: '' }) });
        const wrapper = mountCreator();
        await describeAndStart(wrapper);

        expect(callsTo(env.AI_PROJECT_CLARIFY)).toHaveLength(1);
        expect(callsTo(env.AI_PROJECT_BRIEF)).toHaveLength(1);
        expect(callsTo(env.AI_PROJECT_BRIEF)[0][2].answers).toEqual([]);
        expect(wrapper.findComponent({ name: 'ClarifyStep' }).exists()).toBe(false);
        expect(wrapper.find('#aipg-brief-draft').element.value).toBe(brief.markdown);
    });

    it('renders the coverage chips and posts { unknown: true } for "I don\'t know yet"', async () => {
        routes({ clarify: () => ({ coverage: twoMissing, round: 1, maxRounds: 2, questions: [question('q1', 'done_when'), question('q2', 'constraints')], understanding: '' }) });
        const wrapper = mountCreator();
        await describeAndStart(wrapper);

        const chips = wrapper.findAll('[data-test="coverage"] .cov__chip');
        expect(chips).toHaveLength(5);
        expect(chips.filter((c) => c.classes('cov__chip--missing'))).toHaveLength(2);

        await buttonByText(wrapper, 'AiProject.unknown_yet').trigger('click');
        await wrapper.find('textarea.cw__textarea').setValue('Six weeks');
        await wrapper.find('.cw__btn--primary').trigger('click');
        await flushPromises();

        expect(callsTo(env.AI_PROJECT_CLARIFY)).toHaveLength(1);
        const { answers } = callsTo(env.AI_PROJECT_BRIEF)[0][2];
        expect(answers).toHaveLength(2);
        expect(answers[0]).toMatchObject({ id: 'q1', point: 'done_when', answer: null, skipped: false, unknown: true });
        expect(answers[1]).toMatchObject({ id: 'q2', point: 'constraints', answer: 'Six weeks', skipped: false, unknown: false });
    });

    it('asks a second round only while a missing point was never asked about', async () => {
        const allMissing = { what_for_whom: 'missing', done_when: 'missing', existing: 'missing', constraints: 'missing', team: 'missing' };
        routes({
            clarify: (body) => (body.previousAnswers
                ? { coverage: allMissing, round: 2, maxRounds: 2, questions: [question('q4', 'constraints')], understanding: '' }
                : { coverage: allMissing, round: 1, maxRounds: 2, questions: [question('q1', 'what_for_whom'), question('q2', 'done_when'), question('q3', 'existing')], understanding: '' })
        });
        const wrapper = mountCreator();
        await describeAndStart(wrapper);

        for (let i = 0; i < 3; i += 1) {
            await buttonByText(wrapper, 'AiProject.unknown_yet').trigger('click');
            await flushPromises();
        }
        expect(callsTo(env.AI_PROJECT_CLARIFY)).toHaveLength(2);
        expect(callsTo(env.AI_PROJECT_CLARIFY)[1][2].previousAnswers).toHaveLength(3);
        expect(wrapper.text()).toContain('Q constraints');

        await buttonByText(wrapper, 'AiProject.unknown_yet').trigger('click');
        await flushPromises();
        expect(callsTo(env.AI_PROJECT_CLARIFY)).toHaveLength(2);
        expect(callsTo(env.AI_PROJECT_BRIEF)[0][2].answers).toHaveLength(4);
    });

    it('keeps Generate plan disabled until the brief is approved and sends the approved markdown', async () => {
        routes({ clarify: () => ({ coverage: allMet, round: 1, maxRounds: 2, questions: [] }) });
        const wrapper = mountCreator();
        await describeAndStart(wrapper);

        const generate = wrapper.find('[data-test="generate-plan"]');
        expect(generate.attributes('disabled')).toBeDefined();
        await generate.trigger('click');
        expect(callsTo(env.AI_PROJECT_PLAN)).toHaveLength(0);

        await wrapper.find('#aipg-brief-draft').setValue(`${brief.markdown}\n- Team: two people`);
        await wrapper.find('[data-test="approve-brief"]').trigger('click');
        expect(wrapper.find('[data-test="generate-plan"]').attributes('disabled')).toBeUndefined();

        await wrapper.find('#aipg-brief-draft').setValue(`${brief.markdown}\n- edited again`);
        expect(wrapper.find('[data-test="generate-plan"]').attributes('disabled')).toBeDefined();
        expect(wrapper.text()).toContain('AiProject.brief_reapprove');

        await wrapper.find('[data-test="approve-brief"]').trigger('click');
        await wrapper.find('[data-test="generate-plan"]').trigger('click');
        await flushPromises();

        const planBody = callsTo(env.AI_PROJECT_PLAN)[0][2];
        expect(planBody.approvedBrief).toBe(`${brief.markdown}\n- edited again`);
        expect(planBody.assumptions).toEqual(brief.assumptions);
    });

    it('shows the split badge per task, the summary line, the assumptions and the guide preview', async () => {
        routes({ clarify: () => ({ coverage: allMet, round: 1, maxRounds: 2, questions: [] }) });
        const wrapper = mountCreator();
        await describeAndStart(wrapper);
        await wrapper.find('[data-test="approve-brief"]').trigger('click');
        await wrapper.find('[data-test="generate-plan"]').trigger('click');
        await flushPromises();

        const badges = wrapper.findAll('[data-test="split-badge"]');
        expect(badges.map((b) => b.classes().find((c) => c.startsWith('sb--')))).toEqual(['sb--agent', 'sb--agent-after', 'sb--person', 'sb--person']);
        expect(badges[0].text()).toContain('qa-review');
        expect(badges[2].text()).toContain('a human decision');
        expect(wrapper.vm.splitSummary).toEqual({ agent: 1, agentAfter: 1, person: 1 });
        expect(wrapper.find('[data-test="split-summary"]').text()).toContain('AiProject.split_summary');
        expect(wrapper.find('[data-test="plan-assumptions"]').text()).toContain('No launch date given');

        const guideBody = callsTo(env.AI_PROJECT_GUIDE)[0][2];
        expect(guideBody.approvedBrief).toBe(brief.markdown);
        expect(guideBody.assumptions).toEqual(brief.assumptions);
        expect(wrapper.text()).toContain('Discovery');
        expect(wrapper.text()).toContain('Payment provider');
    });

    it('counts the split itself when the server sends labels but no totals', async () => {
        routes({ clarify: () => ({ coverage: allMet, round: 1, maxRounds: 2, questions: [] }), planResponse: { ...plan, splitSummary: undefined } });
        const wrapper = mountCreator();
        await describeAndStart(wrapper);
        await wrapper.find('[data-test="approve-brief"]').trigger('click');
        await wrapper.find('[data-test="generate-plan"]').trigger('click');
        await flushPromises();
        expect(wrapper.vm.splitSummary).toEqual({ agent: 1, agentAfter: 1, person: 1 });
    });

    it('executes with the approved brief, assumptions and guide, then shows the queued runs, refusals and guide link', async () => {
        routes({ clarify: () => ({ coverage: allMet, round: 1, maxRounds: 2, questions: [] }) });
        const wrapper = mountCreator();
        await describeAndStart(wrapper);
        await wrapper.find('[data-test="approve-brief"]').trigger('click');
        await wrapper.find('[data-test="generate-plan"]').trigger('click');
        await flushPromises();

        await wrapper.find('[data-test="create-everything"]').trigger('click');
        await flushPromises();

        const body = callsTo(env.AI_PROJECT_EXECUTE)[0][2];
        expect(body.approvedBrief).toBe(brief.markdown);
        expect(body.assumptions).toEqual(brief.assumptions);
        expect(body.guide).toMatchObject({ stages: guide.stages, markdown: guide.markdown });
        expect(wrapper.vm.step).toBe('executing');

        FakeEventSource.last.emit({
            event: 'complete', projectId: 'proj-1', totals: { sprints: 1, tasks: 4 },
            guideAgentId: 'agent-9', runsQueued: 1,
            runsRefused: [{ taskId: 't2', taskName: 'Summarise the theme PR', reason: 'needs a person — a pull-request or branch link on the task' }]
        });
        await flushPromises();

        expect(wrapper.vm.step).toBe('done');
        expect(wrapper.emitted('created')).toBeUndefined();
        expect(wrapper.find('[data-test="runs-refused"]').text()).toContain('a pull-request or branch link');
        expect(wrapper.find('[data-test="outcome"]').text()).toContain('AiProject.runs_queued');

        await wrapper.find('[data-test="open-guide"]').trigger('click');
        expect(push).toHaveBeenCalledWith({ name: 'AiAgent', params: { cid: 'company-1', id: 'agent-9' } });
    });

    it('emits created for the new project only when it is opened', async () => {
        routes({ clarify: () => ({ coverage: allMet, round: 1, maxRounds: 2, questions: [] }) });
        const wrapper = mountCreator();
        await describeAndStart(wrapper);
        await wrapper.find('[data-test="approve-brief"]').trigger('click');
        await wrapper.find('[data-test="generate-plan"]').trigger('click');
        await flushPromises();
        await wrapper.find('[data-test="create-everything"]').trigger('click');
        await flushPromises();
        FakeEventSource.last.emit({ event: 'complete', projectId: 'proj-1', totals: { sprints: 1, tasks: 4 } });
        await flushPromises();

        await wrapper.find('[data-test="open-project"]').trigger('click');
        expect(wrapper.emitted('created')[0]).toEqual([{ projectId: 'proj-1' }]);
    });

    it('keeps Continue disabled and explains why until a source is chosen', async () => {
        routes({ clarify: () => ({ coverage: allMet, round: 1, maxRounds: 2, questions: [] }) });
        const wrapper = mountCreator();
        await describeProject(wrapper);

        const start = wrapper.find('[data-test="start"]');
        expect(start.attributes('disabled')).toBeDefined();
        expect(wrapper.find('[data-test="source-required"]').text()).toBe('AiProject.source_required');
        await start.trigger('click');
        await flushPromises();
        expect(callsTo(env.AI_PROJECT_CLARIFY)).toHaveLength(0);
        expect(wrapper.vm.step).toBe('input');

        wrapper.vm.source = 'upwork';
        await nextTick();
        expect(wrapper.find('[data-test="start"]').attributes('disabled')).toBeUndefined();
        expect(wrapper.find('[data-test="source-required"]').exists()).toBe(false);
    });

    it('never calls execute without a source and keeps the plan for the way back', async () => {
        routes({ clarify: () => ({ coverage: allMet, round: 1, maxRounds: 2, questions: [] }) });
        const wrapper = mountCreator();
        await reachPreview(wrapper);

        wrapper.vm.source = '';
        await wrapper.find('[data-test="create-everything"]').trigger('click');
        await flushPromises();

        expect(callsTo(env.AI_PROJECT_EXECUTE)).toHaveLength(0);
        expect(wrapper.vm.step).toBe('input');
        expect(wrapper.text()).toContain('Projects.source_required');
        expect(buttonByText(wrapper, 'Next →').attributes('disabled')).toBeDefined();

        wrapper.vm.source = 'other';
        await nextTick();
        await buttonByText(wrapper, 'Next →').trigger('click');
        expect(wrapper.vm.step).toBe('preview');
        expect(callsTo(env.AI_PROJECT_PLAN)).toHaveLength(1);
    });

    it('counts subtasks in the task total so the done screen reads N / N', async () => {
        routes({ clarify: () => ({ coverage: allMet, round: 1, maxRounds: 2, questions: [] }) });
        const wrapper = mountCreator();
        await reachPreview(wrapper);
        await wrapper.find('[data-test="create-everything"]').trigger('click');
        await flushPromises();

        const counter = () => wrapper.find('[data-test="progress-tasks"]').text();
        expect(counter()).toBe('0 / 4');

        FakeEventSource.last.emit({ event: 'progress', step: 'tasks', status: 'started', total: 3 });
        FakeEventSource.last.emit({ event: 'progress', step: 'tasks', status: 'progress', completed: 4, total: 3 });
        await nextTick();
        expect(counter()).toBe('4 / 4');

        FakeEventSource.last.emit({ event: 'complete', projectId: 'proj-1', totals: { sprints: 1, tasks: 4 } });
        await flushPromises();
        expect(wrapper.vm.step).toBe('done');
        expect(counter()).toBe('4 / 4');
    });

    it('falls back to the old plan path when the brief endpoint fails', async () => {
        routes({ clarify: () => ({ coverage: allMet, round: 1, maxRounds: 2, questions: [] }) });
        apiRequest.mockImplementation((method, url) => {
            if (url === env.AI_PROJECT_CLARIFY) return ok({ coverage: allMet, round: 1, maxRounds: 2, questions: [] });
            if (url === env.AI_PROJECT_BRIEF) return Promise.reject(new Error('Not found'));
            if (url === env.AI_PROJECT_PLAN) return Promise.resolve({ data: { status: true, plan, planId: 'plan-1' } });
            return Promise.resolve({ data: { status: false } });
        });
        const wrapper = mountCreator();
        await describeAndStart(wrapper);
        expect(wrapper.text()).toContain('AiProject.brief_failed');

        await buttonByText(wrapper, 'AiProject.brief_skip').trigger('click');
        await flushPromises();
        expect(callsTo(env.AI_PROJECT_PLAN)[0][2].approvedBrief).toBeUndefined();
        expect(wrapper.vm.step).toBe('preview');
        expect(callsTo(env.AI_PROJECT_GUIDE)).toHaveLength(0);
    });
});
