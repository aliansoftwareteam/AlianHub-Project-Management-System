import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import fs from 'node:fs';
import path from 'node:path';
import en from '@/locales/en';

const OWNER = '6a8ee9720000000000000001';
const TASK = '6a9954186dd786246031e496';
const PROPOSAL = '6ab3ef040000000000000002';

const { apiRequest, route, people, agents } = vi.hoisted(() => ({ apiRequest: vi.fn(), route: { query: {} }, people: {}, agents: { registry: { actions: [], never: [] } } }));

vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay: vi.fn(() => Promise.resolve(null)) }));
vi.mock('vue-router', () => ({ useRoute: () => route }));
vi.mock('vue-toast-notification', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/composable/agentProposals', () => ({ sendProposalDecision: vi.fn() }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: (id) => people[id] || null }) }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/views/Ai/AiSidebar.vue', () => ({ default: { name: 'AiSidebar', render: () => null } }));
vi.mock('@/views/Ai/agentAccess', () => ({ useAgentAccess: () => ({ canManage: false }) }));
vi.mock('@/views/Ai/useAgents', async () => {
    const { ref } = await import('vue');
    return {
        reasonOf: (error) => error.message,
        useAgents: () => ({
            registryManifest: ref(agents.registry), skillManifest: ref([]),
            loadRegistry: vi.fn(), loadSkills: vi.fn(), loadCatalogues: vi.fn(() => Promise.resolve({})), loadSkill: vi.fn(), retireSkill: vi.fn(), dryRunSkill: vi.fn(),
        }),
    };
});

import AuditLog from '@/views/Settings/Audit/AuditLog.vue';
import ApprovalQueue from '@/views/Inbox/ApprovalQueue.vue';
import SkillLibrary from '@/views/Ai/SkillLibrary.vue';
import { plainReason } from '@/views/Ai/auditWords';

const words = () => createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
const { t, te } = words().global;
const source = (rel) => fs.readFileSync(path.resolve(__dirname, '../../src', rel), 'utf8');

let wrapper;
afterEach(() => { wrapper?.unmount(); wrapper = null; });
beforeEach(() => {
    apiRequest.mockReset();
    route.query = {};
    Object.keys(people).forEach((id) => delete people[id]);
    people[OWNER] = { Employee_Name: 'Olivia Owner' };
});

describe('the audit log\'s Event column', () => {
    const row = (id, over = {}) => ({ _id: id, action: 'member.update', actorId: OWNER, actorName: 'Olivia Owner', createdAt: new Date().toISOString(), meta: {}, ...over });
    const agentRow = (id, action, over = {}) => row(id, { action: 'agent.action', meta: { actorType: 'agent', agentName: 'Claude', action, reason: 'Asked to' }, ...over });
    const open = async (rows) => {
        apiRequest.mockResolvedValue({ data: { status: true, data: rows, metadata: { total: rows.length, page: 1, totalPages: 1 } } });
        const i18n = words();
        wrapper = mount(AuditLog, { global: { plugins: [i18n], mocks: { $t: i18n.global.t } } });
        await flushPromises();
    };
    const cells = (selector) => wrapper.findAll('.al__row').map((line) => (line.find(selector).exists() ? line.find(selector).text() : ''));
    const events = () => wrapper.findAll('.al__action');

    it('says what happened in words for the rows a person or the server wrote', async () => {
        const keys = ['agent.project_policy_changed', 'agent.workspace_policy_changed', 'automation.task.comment', 'member.update', 'oauth.grant_created', 'sso.config_update'];
        await open(keys.map((action, at) => row(`r${at}`, { action })));
        expect(events().map((event) => event.text())).toEqual(keys.map((key) => en.AuditEvents[key.replace(/\./g, '_')]));
        expect(events().map((event) => event.attributes('title'))).toEqual(keys);
        expect(events().some((event) => event.classes().includes('ah-mono'))).toBe(false);
    });

    it('says what an agent did or tried in words, whether its registry holds the action or not', async () => {
        await open([
            agentRow('a', 'tasks.search', { action: 'agent.action_refused' }),
            agentRow('b', 'docs.read', { action: 'agent.action_refused' }),
            agentRow('c', 'model.call', { action: 'agent.action_refused' }),
            agentRow('d', 'workflow.automation_rule'),
            agentRow('e', 'sprint.start', { action: 'agent.action_refused' }),
            agentRow('f', 'task.status.set'),
        ]);
        expect(events().map((event) => event.text())).toEqual([
            en.AgentActions.tasks_search, en.AgentActions.docs_read, en.AuditActions.model_call, en.AuditActions.workflow_automation_rule, en.AuditActions.sprint_start, en.AgentActions.task_status_set,
        ]);
        expect(events().map((event) => event.attributes('title'))).toEqual(['tasks.search', 'docs.read', 'model.call', 'workflow.automation_rule', 'sprint.start', 'task.status.set']);
    });

    it('words a decision on a proposal, an undone change and a standing approval', async () => {
        await open([
            row('a', { action: 'agent.proposal_decided', entityType: 'agent_proposal', entityId: PROPOSAL, meta: { decision: 'approved', agentName: 'Claude' } }),
            row('b', { action: 'agent.proposal_decided', entityType: 'agent_proposal', entityId: PROPOSAL, meta: { decision: 'declined: wrong_tone', agentName: 'Claude' } }),
            row('c', { action: 'agent.action_undone', meta: { action: 'task.comment' } }),
            row('d', { action: 'agent.standing_approval_made', entityType: 'project', entityId: TASK, meta: { action: 'task.comment' } }),
        ]);
        expect(events().map((event) => event.text())).toEqual([
            en.Audit.proposal_approved,
            en.Audit.proposal_declined,
            t('Audit.event_undid', { action: en.AgentActions.task_comment }),
            t('Audit.event_with_action', { event: en.AuditEvents.agent_standing_approval_made, action: en.AgentActions.task_comment }),
        ]);
        expect(cells('.al__reason')[1]).toBe(en.Ai.decline_reason_wrong_tone);
    });

    it('never shows a key it has no words for', async () => {
        await open([row('a', { action: 'something.unheard_of' }), agentRow('b', 'tasks.frobnicate', { action: 'agent.action_refused' })]);
        expect(events().map((event) => event.text())).toEqual([en.Audit.event_unnamed, en.Audit.event_unnamed]);
        expect(events().map((event) => event.attributes('title'))).toEqual(['something.unheard_of', 'tasks.frobnicate']);
    });

    it('names what the row is about, and leaves an id it cannot name to the details', async () => {
        await open([
            agentRow('named', 'task.comment', { entityType: 'task', entityId: TASK, entityName: 'Fix login' }),
            agentRow('resolved', 'task.comment', { entityType: 'task', entityId: TASK, entityLabel: 'Fix login' }),
            agentRow('unnamed', 'task.comment', { entityType: 'task', entityId: TASK }),
            row('workspace', { action: 'agent.workspace_policy_changed', entityType: 'company', entityId: OWNER }),
            row('person', { entityType: 'member', entityId: OWNER }),
            row('handle', { action: 'connector.connect', entityType: 'connector', entityId: 'slack', entityName: 'Slack' }),
        ]);
        expect(cells('.al__entity')).toEqual(['Fix login', 'Fix login', '', '', 'Olivia Owner', 'Slack']);
        const shown = wrapper.findAll('.al__row').map((line) => line.find('.al__event').text());
        shown.forEach((text) => expect(text).not.toMatch(/[a-f0-9]{24}/));
        const details = wrapper.findAll('.al__row')[2].find('[data-test="row-details"]');
        expect(details.element.tagName).toBe('DETAILS');
        expect(details.find('summary').text()).toBe(en.Audit.details);
        expect(details.text()).toContain('agent.action · task.comment');
        expect(details.text()).toContain(`task ${TASK}`);
    });

    it('names a refused permission, with its key on hover', async () => {
        await open([row('p', { action: 'permission.refused', entityType: 'permission', entityId: 'task.task_priority', entityName: 'task.task_priority', meta: { reason: 'role_not_allowed', mode: 'enforce' } })]);
        expect(wrapper.find('.al__entity').text()).toBe(en.SecurityAndPermission.task_priority);
        expect(wrapper.find('.al__entity').attributes('title')).toBe('task.task_priority');
        expect(wrapper.find('.al__reason').text()).toBe(en.AuditReasons.role_not_allowed);
    });

    it('gives the reason as a sentence, and keeps what was recorded in the details', async () => {
        const reasons = [
            'not_visible: the task is not one the person behind this token can open',
            'spend_cap_exceeded: the next call is estimated at $0.0312 (5200 tokens) but the run cap of $0.5000 has $0.0100 left',
            `approved proposal ${PROPOSAL} by ${OWNER}`,
            'brief.parse finding',
            'via REST',
            'undo_window_passed',
            'Asked in chat to tidy the backlog',
        ];
        await open(reasons.map((reason, at) => agentRow(`r${at}`, 'task.comment', { action: at < 2 || at === 5 ? 'agent.action_refused' : 'agent.action', meta: { actorType: 'agent', agentName: 'Claude', action: 'task.comment', reason } })));
        expect(cells('.al__reason')).toEqual([
            en.AuditReasons.not_visible_task,
            t('AuditReasons.spend_cap_exceeded_detail', { cost: '0.03', limit: '0.50', left: '0.01' }),
            t('AuditReasons.approved_by', { person: 'Olivia Owner' }),
            t('AuditReasons.skill_finding', { skill: en.Ai.skill_label_brief_parse }),
            en.AuditReasons.via_rest,
            en.AuditReasons.undo_window_passed,
            'Asked in chat to tidy the backlog',
        ]);
        const kept = wrapper.findAll('[data-test="row-details"]').map((details) => details.text());
        expect(kept[0]).toContain(reasons[0]);
        expect(kept[2]).toContain(reasons[2]);
        expect(kept[6]).not.toContain(reasons[6]);
    });
});

describe('a reason in a sentence', () => {
    const plain = (reason, name = () => '') => plainReason(t, te, reason, name);

    it('words each thing a person behind an agent could not open', () => {
        expect(plain('not_visible: the task\'s comment thread is not one the person behind this agent can open')).toBe(en.AuditReasons.not_visible_thread);
        expect(plain('not_visible: the project is not one the person behind this agent can open')).toBe(en.AuditReasons.not_visible_project);
        expect(plain('not_visible: the list is not one the person behind this agent can open in that project')).toBe(en.AuditReasons.not_visible_list);
        expect(plain('not_visible')).toBe(en.AuditReasons.not_visible);
        expect(plain('permission_denied: task.task_assign is not something the person may do')).toBe(en.AuditReasons.permission_denied);
    });

    it('words what an agent may not do', () => {
        expect(plain('Agents cannot perform project.delete (never_listed)')).toBe(en.AuditReasons.agents_never);
        expect(plain('Agents cannot perform task.archive (not in this agent\'s skills)')).toBe(en.AuditReasons.agents_not_in_skills);
        expect(plain('Agents cannot perform page.create directly — it must be proposed')).toBe(en.AuditReasons.agents_must_propose);
        expect(plain('Agents cannot perform task.status.set("Done")')).toBe(t('AuditReasons.agents_cannot_status', { status: 'Done' }));
        expect(plain('Agents cannot perform sprint.start')).toBe(en.AuditReasons.agents_cannot);
        expect(plain('Agents cannot perform (unknown action)')).toBe(en.AuditReasons.agents_cannot);
    });

    it('words the same refusals as the server writes them now', () => {
        expect(plain('not_visible: that task was not found, or the person cannot open its comments. Ask the person which task they mean.')).toBe(en.AuditReasons.not_visible_thread);
        expect(plain('not_visible: that task was not found, or the person cannot open it. Ask the person which task they mean.')).toBe(en.AuditReasons.not_visible_task);
        expect(plain('not_visible: that project was not found, or the person cannot open it. Ask the person which project they mean.')).toBe(en.AuditReasons.not_visible_project);
        expect(plain('not_visible: that list was not found in that project, or the person cannot open it. Ask the person which list they mean.')).toBe(en.AuditReasons.not_visible_list);
        expect(plain('An agent is never allowed to do this (never_listed). The person has to do it in AlianHub.')).toBe(en.AuditReasons.agents_never);
        expect(plain('An agent is never allowed to do this (project.delete). The person has to do it in AlianHub.')).toBe(en.AuditReasons.agents_never);
        expect(plain('An agent is not allowed to do this (sprint.start). The person has to do it in AlianHub.')).toBe(en.AuditReasons.agents_cannot);
        expect(plain('That action is not available to agents (none named).')).toBe(en.AuditReasons.agents_cannot);
        expect(plain('task.archive is not switched on for this connection. Ask the person to allow it in AlianHub.')).toBe(en.AuditReasons.agents_not_in_skills);
        expect(plain('page.create needs a person\'s approval first, so it has to be sent as a proposal.')).toBe(en.AuditReasons.agents_must_propose);
        expect(plain('You cannot set a task to "Done". Use In progress or In review, and a person closes the task.')).toBe(t('AuditReasons.agents_cannot_status', { status: 'Done' }));
        expect(plain('task.update cannot change TaskKey, ProjectID. Leave that out.')).toBe(en.AuditReasons.agents_cannot_fields);
    });

    it('words a step that was refused, and a change made under a standing approval', () => {
        expect(plain('step credential refused: credential_expired (step s1 of run r1)')).toBe(en.AuditReasons.step_credential_refused);
        expect(plain('external agent step refused: grant_not_live (session s1: the grant was revoked or has expired)')).toBe(en.AuditReasons.external_grant_not_live);
        expect(plain('external agent step refused: something_new (x)')).toBe(en.AuditReasons.external_refused);
        expect(plain(`task.comment (standing approval ${PROPOSAL}, made by ${OWNER})`, () => 'Olivia Owner')).toBe(t('AuditReasons.always_by', { person: 'Olivia Owner' }));
        expect(plain(`Weekly tidy (standing approval ${PROPOSAL}, made by ${OWNER})`)).toBe(t('AuditReasons.said_and', { said: 'Weekly tidy', also: en.AuditReasons.always }));
        expect(plain(`approved proposal ${PROPOSAL} by ${OWNER}`)).toBe(en.AuditReasons.approved_by_someone);
    });

    it('leaves a person\'s or an agent\'s own words alone', () => {
        ['Asked in chat to tidy the backlog', 'duplicate', 'changed since you read it: this task was changed after you last read it.', ''].forEach((said) => expect(plain(said)).toBe(said));
    });

    it('shows no 24-character id and no code in any sentence it makes', () => {
        const made = [
            'not_visible: the task is not one the person behind this token can open', 'spend_cap_exceeded: over', `approved proposal ${PROPOSAL} by ${OWNER}`,
            `x (standing approval ${PROPOSAL}, made by ${OWNER})`, 'target_not_visible', 'project_not_visible', 'unlisted', 'private_address', 'txt_record_missing',
        ].map((reason) => plain(reason));
        made.forEach((sentence) => {
            expect(sentence).not.toMatch(/[a-f0-9]{24}/);
            expect(sentence).not.toMatch(/[a-z]_[a-z]/);
        });
    });
});

describe('a reason in the AI Inbox', () => {
    const proposal = (why) => ({
        sourceType: 'proposal', sourceId: 'p1', proposalId: 'p1', kind: 'proposal', agentName: 'Planner', source: '', requestedBy: '',
        what: 'Archive AP-7', why, changes: [{ action: 'task.archive', params: { taskId: 't1' }, label: 'Archive AP-7', reversible: true }], gate: null, locked: false, editable: false,
        createdAt: '2026-10-02T09:00:00.000Z', unread: true,
    });

    it('is a sentence on an approval card', () => {
        wrapper = mount(ApprovalQueue, { attachTo: document.body, props: { proposals: [proposal('brief.parse finding')] }, global: { plugins: [words()], stubs: { ShellIcon: true } } });
        expect(wrapper.find('.aq__why').text()).toContain(t('AuditReasons.skill_finding', { skill: en.Ai.skill_label_brief_parse }));
        expect(wrapper.find('.aq__why').text()).not.toContain('brief.parse');
    });

    it('is a sentence in the list, the detail and the note about what could not be applied', () => {
        const inbox = source('views/Ai/AiInbox.vue');
        expect(inbox).toContain('<div class="ai-item__why">{{ whyOf(p) }}</div>');
        expect(inbox).toContain('<p class="ai-detail__why">{{ whyOf(selected) }}</p>');
        expect(inbox).toContain('error: plain(unapplied[0].error)');
        expect(inbox).not.toMatch(/\{\{ (p|selected)\.why \}\}/);
    });
});

describe('the count of pages in Docs', () => {
    it('says one page and two pages', () => {
        expect(t('Docs.pages_count', { n: 1 }, 1)).toBe('1 PAGE');
        expect(t('Docs.pages_count', { n: 2 }, 2)).toBe('2 PAGES');
        expect(t('Docs.pages_count', { n: 0 }, 0)).toBe('0 PAGES');
    });

    it('is asked for with the number, in the head and on the Wiki tab', () => {
        const page = source('views/Pages/PagesSpace.vue');
        expect(page).toContain("$t('Docs.pages_count', { n: pages.length }, pages.length)");
        expect(page).toContain("$t('Docs.pages_count', { n: wikiPages.length }, wikiPages.length)");
    });
});

describe('the table of actions in the Skill library', () => {
    it('names each action in words, with its key on hover', async () => {
        agents.registry = {
            never: [],
            actions: [
                { key: 'task.sprint.move', label: 'Move a task between sprints', risk: 'low', undoable: true },
                { key: 'tasks.search', label: 'Search own tasks', risk: 'low', undoable: false },
                { key: 'something.new', label: 'Do a new thing', risk: 'low', undoable: false },
            ],
        };
        const i18n = words();
        wrapper = mount(SkillLibrary, {
            global: { plugins: [i18n], mocks: { $t: i18n.global.t }, provide: { $companyId: { value: 'c1' } }, stubs: { EmptyState: true, SkillEditor: true, SkillDryRunPanel: true, RunTaskPicker: true } },
        });
        await flushPromises();
        const names = wrapper.findAll('[data-test="action-name"]');
        expect(names.map((cell) => cell.text())).toEqual([en.AgentActions.task_sprint_move, en.AgentActions.tasks_search, 'Do a new thing']);
        expect(names.map((cell) => cell.attributes('title'))).toEqual(['task.sprint.move', 'tasks.search', 'something.new']);
        expect(wrapper.find('.ai-table').text()).not.toMatch(/task\.sprint\.move|tasks\.search|something\.new/);
    });
});
