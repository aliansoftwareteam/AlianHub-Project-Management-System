import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import fs from 'node:fs';
import path from 'node:path';

const { apiRequest, toast, sendProposalDecision } = vi.hoisted(() => ({ apiRequest: vi.fn(), toast: { success: vi.fn(), error: vi.fn() }, sendProposalDecision: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('vue-router', () => ({ useRoute: () => ({ params: { cid: 'c1' } }) }));
vi.mock('@/composable', () => ({
    useGetterFunctions: () => ({ getUser: (id) => (id === 'u-priya' ? { Employee_Name: 'Priya' } : null) }),
}));
vi.mock('@/composable/agentProposals', () => ({ sendProposalDecision }));

import ProjectManagerCard from '@/views/Projects/ProjectDetail/ProjectManagerCard.vue';
import ApprovalQueue from '@/views/Inbox/ApprovalQueue.vue';
import en from '@/locales/en';

const URL = '/api/v2/agents/project-manager/p1';
const CARD = path.resolve(__dirname, '../../src/views/Projects/ProjectDetail/ProjectManagerCard.vue');
const ok = (data) => Promise.resolve({ data: { status: true, data } });
const refused = (statusText) => Promise.reject(Object.assign(new Error('Request failed'), { response: { status: 403, data: { status: false, statusText } } }));

const finding = (rule, facts = {}, over = {}) => ({ id: `f-${rule}`, rule, taskId: 't1', userId: '', facts: { taskKey: 'AP-12', taskName: 'Ship the page', ...facts }, canDecide: false, openedAt: '2026-10-07T09:00:00.000Z', ...over });
const ONE_OF_EACH = [
    finding('slipping', { daysLate: 3 }),
    finding('slipping', { taskKey: 'AP-13', daysLate: 0, days: 2, blockerKey: 'AP-9', blockerName: 'Sign the contract' }, { id: 'f-waits', proposalId: 'pr-1', canDecide: true }),
    finding('blocked', { blockerKey: 'AP-9', blockerName: 'Sign the contract', quietDays: 4 }),
    finding('overloaded', { plannedHours: 42, capacityHours: 40 }, { userId: 'u-priya' }),
    finding('no_owner'),
    finding('no_estimate'),
    finding('stale', { quietDays: 5 }, { proposalId: 'pr-2', canDecide: true }),
    finding('untriaged', { origin: 'email' }),
];
const answer = (over = {}) => ({ on: false, level: 'suggest', canEdit: true, findings: [], ...over });

let wrapper;
const i18n = () => createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
const mountCard = async (data = answer(), onPut = null) => {
    apiRequest.mockImplementation((type, url, body) => (type === 'get' ? ok(data) : (onPut || (() => ok(answer({ ...data, ...body }))))(type, url, body)));
    wrapper = mount(ProjectManagerCard, { props: { projectId: 'p1' }, global: { plugins: [i18n()], stubs: { RouterLink: { props: ['to'], template: '<a :data-to="JSON.stringify(to)"><slot /></a>' } } } });
    await flushPromises();
    return wrapper;
};
const toggle = () => wrapper.find('[data-test="manager-switch"]');
const rowTexts = () => wrapper.findAll('[data-test="finding"]').map((row) => row.text());

beforeEach(() => { apiRequest.mockReset(); toast.success.mockReset(); });
afterEach(() => { wrapper?.unmount(); wrapper = null; });

describe('ProjectManagerCard', () => {
    it('is off at first, says what it does and that it only proposes', async () => {
        await mountCard();
        expect(apiRequest).toHaveBeenCalledWith('get', URL, undefined);
        expect(toggle().attributes('aria-checked')).toBe('false');
        expect(wrapper.text()).toContain(en.ProjectManager.lead);
        expect(wrapper.find('[data-test="manager-level"]').text()).toContain(en.ProjectManager.level_suggest);
        expect(wrapper.find('[data-test="findings"]').exists()).toBe(false);
    });

    it('turns on with one press and shows what the first look found', async () => {
        await mountCard(answer(), () => ok(answer({ on: true, findings: [finding('no_owner')] })));
        await toggle().trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenLastCalledWith('put', URL, { on: true });
        expect(toggle().attributes('aria-checked')).toBe('true');
        expect(toast.success).toHaveBeenCalledTimes(1);
        expect(rowTexts()).toHaveLength(1);
    });

    it('puts the switch back and says why when the server refuses it', async () => {
        await mountCard(answer(), () => refused('Owner/admin only.'));
        await toggle().trigger('click');
        await flushPromises();
        expect(toggle().attributes('aria-checked')).toBe('false');
        expect(wrapper.find('[data-test="error"]').text()).toBe('Owner/admin only.');
    });

    it('is read-only for someone who may not change it', async () => {
        await mountCard(answer({ canEdit: false, on: true }));
        expect(toggle().attributes('disabled')).toBeDefined();
        expect(wrapper.find('[data-test="read-only"]').exists()).toBe(true);
    });

    it('says a look found nothing when the project is on and clean', async () => {
        await mountCard(answer({ on: true }));
        expect(wrapper.find('[data-test="findings-empty"]').text()).toBe(en.ProjectManager.empty);
    });

    it('writes each finding with its facts and what is offered', async () => {
        await mountCard(answer({ on: true, findings: ONE_OF_EACH }));
        const rows = rowTexts();
        expect(rows).toHaveLength(8);
        expect(rows[0]).toContain('AP-12');
        expect(rows[0]).toContain('Ship the page');
        expect(rows[0]).toContain('Due 3 days ago');
        expect(rows[1]).toContain('Waits on AP-9, which now ends 2 days after this task starts');
        expect(rows[2]).toContain('Waits on AP-9, which has not changed for 4 working days');
        expect(rows[3]).toContain('Priya');
        expect(rows[3]).toContain('42 hours planned this week, and the week holds 40');
        expect(rows[4]).toContain('Nobody owns this task');
        expect(rows[5]).toContain('This task has no estimate');
        expect(rows[6]).toContain('No change for 5 working days');
        expect(rows[7]).toContain('Came in by email and has no owner and no estimate');
        expect(rows[4]).toContain(en.ProjectManager.offer_no_owner);
    });

    it('links a ready change to the Inbox only for a person who may decide it', async () => {
        await mountCard(answer({ on: true, findings: ONE_OF_EACH }));
        const links = wrapper.findAll('[data-test="finding-review"]');
        expect(links).toHaveLength(2);
        expect(JSON.parse(links[0].attributes('data-to'))).toEqual({ name: 'inbox', params: { cid: 'c1' }, query: { tab: 'approval' } });
        expect(wrapper.findAll('[data-test="finding"]')[0].find('[data-test="finding-review"]').exists()).toBe(false);
    });

    it('has a sentence in en.js for every string it shows, in plain words', () => {
        const source = fs.readFileSync(CARD, 'utf8');
        const keys = [...new Set(source.match(/ProjectManager\.[a-z_]+/g))].filter((key) => !key.endsWith('_'));
        expect(keys.length).toBeGreaterThan(8);
        keys.forEach((key) => expect(en.ProjectManager[key.split('.')[1]], key).toEqual(expect.any(String)));
        ['slipping', 'slipping_waits', 'blocked', 'overloaded', 'no_owner', 'no_estimate', 'stale', 'untriaged'].forEach((rule) => {
            expect(en.ProjectManager[`reason_${rule}`], rule).toEqual(expect.any(String));
            expect(en.ProjectManager[`offer_${rule}`], rule).toEqual(expect.any(String));
        });
        expect(Object.values(en.ProjectManager).join(' ')).not.toMatch(/\b(triage|cron|heuristic|LLM|model|sprint)\b/i);
    });

    it('colours with tokens only', () => {
        const source = fs.readFileSync(CARD, 'utf8');
        const style = source.slice(source.indexOf('<style'));
        expect(style).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
        expect(style).not.toMatch(/var\(--ink-3\)/);
        expect(style).toMatch(/min-width: 0/);
    });
});

describe('a change the rules propose, in the Inbox', () => {
    const row = {
        sourceType: 'proposal', sourceId: 'pr-2', proposalId: 'pr-2', kind: 'proposal', agentName: 'System for Website', source: 'system', requestedBy: '',
        what: 'Ask for an update on AP-12', why: 'No change for 5 working days.',
        finding: { rule: 'stale', projectName: 'Website', facts: { taskKey: 'AP-12', taskName: 'Ship the page', quietDays: 5 } },
        changes: [{ action: 'task.comment', params: { taskId: 't1', body: 'Is it still moving?' }, label: 'Comment on AP-12: "Is it still moving?"', reversible: true }],
        gate: null, locked: false, editable: true, createdAt: '2026-10-07T09:00:00.000Z', unread: true,
    };

    it('reads as filed by the system for the project, never by a person, with the reason from the rule', () => {
        wrapper = mount(ApprovalQueue, { attachTo: document.body, props: { proposals: [row] }, global: { plugins: [i18n()], stubs: { ShellIcon: true } } });
        const text = wrapper.find('[data-test="queue-row"]').text();
        expect(text).toContain('The system, for Website');
        expect(text).toContain('ask for an update on AP-12');
        expect(text).toContain('No change for 5 working days');
        expect(text).toContain('Is it still moving?');
        expect(wrapper.find('[data-test="queue-approve"]').exists()).toBe(true);
    });
});
