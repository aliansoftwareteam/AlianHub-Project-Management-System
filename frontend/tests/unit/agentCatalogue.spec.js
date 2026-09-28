import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { createI18n } from 'vue-i18n';
import en from '@/locales/en';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => key } } }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import AgentCatalogue from '@/views/Ai/AgentCatalogue.vue';
import AgentWizard from '@/views/Ai/AgentWizard.vue';
import { CATALOGUE_CATEGORIES, CATALOGUE_TEMPLATES, filterTemplates, templateToPrefill, draftToPrefill } from '@/views/Ai/agentCatalogue';
import { applyAiAvailability, resetAiAvailability, AI_STATE } from '@/composable/aiAvailability';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
const t = i18n.global.t;

const PROJECTS = [{ _id: 'p1', ProjectName: 'Mobile app' }, { _id: 'p2', ProjectName: 'Website' }];
const store = createStore({
    modules: {
        settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType: 1 }) } },
        projectData: { namespaced: true, getters: { projects: () => ({ data: PROJECTS }) } }
    }
});

const REGISTRY = {
    actions: [
        { key: 'task.get', label: 'Read a task brief', risk: 'low' },
        { key: 'tasks.search', label: 'Search own tasks', risk: 'low' },
        { key: 'task.comment', label: 'Comment on a task', risk: 'low' },
        { key: 'subtask.create', label: 'Create a subtask', risk: 'low' },
        { key: 'deploy.staging', label: 'Propose a staging deploy', risk: 'high', proposeOnly: true, gate: 'owner_admin' }
    ],
    never: ['project.delete']
};
const SKILLS = ['brief.parse', 'digest.ceo', 'project.guide', 'pr.summary', 'qa-review'].map((key) => ({ key, name: key, source: 'code', requires: null, unavailable: null }));

const DRAFT = {
    name: 'Deadline Watcher',
    description: 'Watches due dates.',
    skills: ['digest.ceo'],
    allowedActions: ['task.get', 'task.comment', 'deploy.staging'],
    autonomy: 1,
    projectIds: ['p1', 'p-hidden'],
    spendCapUsd: 10,
    cadence: 'daily',
    why: { name: 'It watches deadlines.', skills: 'The digest lists what is overdue.', actions: 'It only reads and comments.', autonomy: 'Start by suggesting.', scope: 'You named Mobile app.', spendCap: 'A digest is cheap.' }
};

const ok = (data) => Promise.resolve({ data: { status: true, data } });
const serve = () => apiRequest.mockImplementation((type, url) => {
    if (type === 'post' && url === '/api/v2/agents/draft') return ok(DRAFT);
    if (type === 'post' && url === '/api/v2/agents') return ok({ _id: 'new' });
    if (url === '/api/v2/agents/registry') return ok(REGISTRY);
    if (url.startsWith('/api/v2/agents/skills')) return ok(SKILLS);
    return ok([]);
});

const mounted = [];
const mountWith = async (component, props = {}) => {
    const wrapper = mount(component, {
        props,
        attachTo: document.body,
        global: { plugins: [store, i18n], mocks: { $t: t }, stubs: { teleport: true } }
    });
    mounted.push(wrapper);
    await flushPromises();
    return wrapper;
};

beforeEach(() => {
    apiRequest.mockReset();
    serve();
    resetAiAvailability();
    applyAiAvailability({ state: AI_STATE.ON });
});

afterEach(() => {
    mounted.splice(0).forEach((w) => w.unmount());
});

const slugsOf = (list) => list.map((tpl) => tpl.slug);

describe('the template catalogue as data', () => {
    it('files every template under known categories and names only real skills', () => {
        const real = ['brief.parse', 'digest.ceo', 'project.guide', 'pr.summary', 'qa-review'];
        CATALOGUE_TEMPLATES.forEach((tpl) => {
            expect(tpl.categories.length).toBeGreaterThan(0);
            tpl.categories.forEach((c) => expect(CATALOGUE_CATEGORIES).toContain(c));
            tpl.skills.forEach((key) => expect(real).toContain(key));
            expect(tpl.autonomy).toBeLessThanOrEqual(1);
            expect(t(`AgentCatalogue.tpl_${tpl.slug}_name`)).not.toBe(`AgentCatalogue.tpl_${tpl.slug}_name`);
            expect(t(`AgentCatalogue.tpl_${tpl.slug}_about`)).not.toBe(`AgentCatalogue.tpl_${tpl.slug}_about`);
            if (!tpl.blockedBy) expect(tpl.skills.length).toBeGreaterThan(0);
        });
    });

    it('filters by category', () => {
        const scheduled = filterTemplates(t, CATALOGUE_TEMPLATES, { category: 'scheduling' });
        expect(scheduled.length).toBeGreaterThan(0);
        scheduled.forEach((tpl) => expect(tpl.categories).toContain('scheduling'));
    });

    it('searches names, descriptions and skill labels', () => {
        expect(slugsOf(filterTemplates(t, CATALOGUE_TEMPLATES, { query: 'deadline' }))).toContain('deadline_watch');
        expect(slugsOf(filterTemplates(t, CATALOGUE_TEMPLATES, { query: 'pull request' }))).toContain('release_notes');
        expect(filterTemplates(t, CATALOGUE_TEMPLATES, { query: 'zzzz-nothing' })).toEqual([]);
    });

    it('combines search and category', () => {
        const hits = filterTemplates(t, CATALOGUE_TEMPLATES, { query: 'status', category: 'projects' });
        expect(slugsOf(hits)).toEqual(['status_reporter']);
    });

    it('turns a template into a wizard prefill that suggests changes and names no project', () => {
        const tpl = CATALOGUE_TEMPLATES.find((x) => x.slug === 'status_reporter');
        expect(templateToPrefill(t, tpl)).toMatchObject({ source: 'template', slug: 'status_reporter', name: 'Status Reporter', skills: ['digest.ceo'], autonomy: 1, projectIds: [] });
    });

    it('keeps a draft to what it may hold', () => {
        const prefill = draftToPrefill({ ...DRAFT, autonomy: 3, spendCapUsd: 500 });
        expect(prefill.source).toBe('builder');
        expect(prefill.autonomy).toBe(1);
        expect(prefill.spendCapUsd).toBeLessThanOrEqual(30);
        expect(prefill.why.autonomy).toBe('Start by suggesting.');
    });
});

describe('the catalogue dialog', () => {
    it('lists a chip per category and every template as a card', async () => {
        const wrapper = await mountWith(AgentCatalogue);
        expect(wrapper.findAll('[data-test="catalogue-chip"]')).toHaveLength(CATALOGUE_CATEGORIES.length + 1);
        expect(wrapper.findAll('[data-test="catalogue-card"]')).toHaveLength(CATALOGUE_TEMPLATES.length);
    });

    it('narrows the cards as you type', async () => {
        const wrapper = await mountWith(AgentCatalogue);
        await wrapper.find('[data-test="catalogue-search"]').setValue('deadline');
        const cards = wrapper.findAll('[data-test="catalogue-card"]');
        expect(cards.map((c) => c.attributes('data-slug'))).toContain('deadline_watch');
        expect(cards.length).toBeLessThan(CATALOGUE_TEMPLATES.length);
    });

    it('narrows the cards by category chip and marks the chip pressed', async () => {
        const wrapper = await mountWith(AgentCatalogue);
        const chip = wrapper.findAll('[data-test="catalogue-chip"]').find((c) => c.attributes('data-category') === 'product');
        await chip.trigger('click');
        expect(chip.attributes('aria-pressed')).toBe('true');
        wrapper.findAll('[data-test="catalogue-card"]').forEach((card) => {
            const tpl = CATALOGUE_TEMPLATES.find((x) => x.slug === card.attributes('data-slug'));
            expect(tpl.categories).toContain('product');
        });
    });

    it('shows what a template does, its skills, its autonomy and what it needs', async () => {
        const wrapper = await mountWith(AgentCatalogue);
        const card = wrapper.find('[data-slug="deadline_watch"]');
        expect(card.text()).toContain('Deadline Watch');
        expect(card.text()).toContain('Write a project digest');
        expect(card.text()).toContain('Suggests changes');
        expect(card.find('[data-test="catalogue-schedule"]').exists()).toBe(true);
        expect(card.find('[data-test="catalogue-needs"]').exists()).toBe(true);
    });

    it('picking a template hands the wizard its prefill', async () => {
        const wrapper = await mountWith(AgentCatalogue);
        await wrapper.find('[data-slug="status_reporter"] [data-test="catalogue-use"]').trigger('click');
        const [prefill] = wrapper.emitted('pick')[0];
        expect(prefill).toMatchObject({ source: 'template', name: 'Status Reporter', skills: ['digest.ceo'], autonomy: 1 });
    });

    it('keeps a template that needs something missing visible but not selectable', async () => {
        const wrapper = await mountWith(AgentCatalogue);
        const card = wrapper.find('[data-slug="field_filler"]');
        expect(card.find('[data-test="catalogue-use"]').attributes('disabled')).toBeDefined();
        expect(card.text()).toContain(t('AgentCatalogue.blocked_ai_fields'));
    });

    it('drafts from a sentence and hands the wizard the draft, saving nothing', async () => {
        const wrapper = await mountWith(AgentCatalogue);
        await wrapper.find('[data-test="builder-input"]').setValue('Every morning tell the mobile team what is overdue.');
        await wrapper.find('[data-test="builder-draft"]').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('post', '/api/v2/agents/draft', { description: 'Every morning tell the mobile team what is overdue.' });
        expect(apiRequest).not.toHaveBeenCalledWith('post', '/api/v2/agents', expect.anything());
        const [prefill] = wrapper.emitted('pick')[0];
        expect(prefill).toMatchObject({ source: 'builder', name: 'Deadline Watcher', skills: ['digest.ceo'], autonomy: 1 });
    });

    it('hides the builder while AI is off and keeps the templates', async () => {
        applyAiAvailability({ state: AI_STATE.OFF_WORKSPACE });
        const wrapper = await mountWith(AgentCatalogue);
        expect(wrapper.find('[data-test="builder-input"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="builder-off"]').exists()).toBe(true);
        expect(wrapper.findAll('[data-test="catalogue-card"]').length).toBeGreaterThan(0);
    });
});

describe('the wizard opened from the catalogue', () => {
    it('opens pre-filled from a template', async () => {
        const prefill = templateToPrefill(t, CATALOGUE_TEMPLATES.find((x) => x.slug === 'work_breakdown'));
        const wrapper = await mountWith(AgentWizard, { prefill });
        expect(wrapper.find('#aw-name').element.value).toBe('Work Breakdown');
        await wrapper.find('.aw__foot .ah-btn--primary').trigger('click');
        const checked = wrapper.findAll('.aw__action input:checked').map((i) => i.element.value);
        expect(checked).toEqual(expect.arrayContaining(['subtask.create', 'task.comment']));
    });

    it('opens pre-filled from a draft, with a why line per choice, and drops what it may not hold', async () => {
        const wrapper = await mountWith(AgentWizard, { prefill: draftToPrefill(DRAFT) });
        expect(wrapper.find('#aw-name').element.value).toBe('Deadline Watcher');
        expect(wrapper.find('[data-test="why-name"]').text()).toContain('It watches deadlines.');
        await wrapper.find('.aw__foot .ah-btn--primary').trigger('click');
        expect(wrapper.find('[data-test="why-actions"]').text()).toContain('It only reads and comments.');
        await wrapper.find('.aw__foot .ah-btn--primary').trigger('click');
        expect(wrapper.find('[data-test="why-autonomy"]').text()).toContain('Start by suggesting.');
        expect(wrapper.find('input[type="radio"]:checked').element.value).toBe('1');
        const scoped = wrapper.findAll('.ai-radios input[type="checkbox"]:checked').map((i) => i.element.value);
        expect(scoped).toEqual(['p1']);

        await wrapper.find('.aw__foot .ah-btn--primary').trigger('click');
        await flushPromises();
        const save = apiRequest.mock.calls.find(([type, url]) => type === 'post' && url === '/api/v2/agents');
        expect(save[2]).toMatchObject({ name: 'Deadline Watcher', autonomy: 1, projectIds: ['p1'], spendCapUsd: 10 });
        expect(save[2].allowedActions).not.toContain('deploy.staging');
        expect(save[2].skills.map((s) => s.key)).toEqual(['digest.ceo']);
        expect(save[2].schedule).toBeUndefined();
    });

    it('still refuses to go on without a name', async () => {
        const wrapper = await mountWith(AgentWizard, { prefill: draftToPrefill({ ...DRAFT, name: '' }) });
        await wrapper.find('.aw__foot .ah-btn--primary').trigger('click');
        expect(wrapper.find('.ah-field__error').exists()).toBe(true);
        expect(wrapper.find('#aw-name').exists()).toBe(true);
    });
});
