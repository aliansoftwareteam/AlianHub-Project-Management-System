import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import AgentPicker from '@/views/Ai/AgentPicker.vue';

const source = readFileSync(resolve(__dirname, '../../src/views/Ai/AgentPicker.vue'), 'utf8');

const task = { _id: 't1', TaskKey: 'AL-7', TaskName: 'Summarise the sprint', status: 'In progress' };
const workspaceAgent = { _id: 'a1', name: 'Reviewer', account: 'workspace', autonomy: 1 };
const personalAgent = { _id: 'a2', name: 'Scribe', account: 'personal', autonomy: 2 };
const pausedAgent = { _id: 'a3', name: 'Sleeper', account: 'workspace', autonomy: 1, paused: true };
const asha = { id: 'u1', name: 'Asha Rao', load: 40, capacityHours: 40, loggedHours: 10 };
const ben = { id: 'u2', name: 'Ben Ito', load: 130, pto: { active: true, to: '2026-10-09T00:00:00Z' } };
const registryActions = [{ key: 'task.update', write: true, label: 'Update task' }, { key: 'task.delete', write: true, label: 'Delete task' }];

const mountPicker = (props = {}) => mount(AgentPicker, {
    props: { task, agents: [workspaceAgent, personalAgent, pausedAgent], people: [asha, ben], registryActions, ...props },
    global: { stubs: { ShellIcon: true } }
});
const rows = (wrapper) => wrapper.findAll('.picker__row');
const rowFor = (wrapper, name) => rows(wrapper).find((r) => r.text().includes(name));
const assignButton = (wrapper) => wrapper.get('.ah-btn--primary');
const search = (wrapper, text) => wrapper.get('#assignee-search').setValue(text);
const facts = (wrapper) => Object.fromEntries(wrapper.findAll('.picker__facts > div').map((d) => [d.get('dt').text(), d.get('dd').text()]));

describe('AgentPicker header', () => {
    it('shows the task key, name and status', () => {
        const head = mountPicker().get('.picker__head');
        expect(head.text()).toContain('AL-7');
        expect(head.text()).toContain('Summarise the sprint');
        expect(head.text()).toContain('In progress');
    });

    it('falls back to i18n keys for a task with no name or status', () => {
        const head = mountPicker({ task: { _id: 't2' } }).get('.picker__head');
        expect(head.text()).toContain('Parity.untitled_task');
        expect(head.text()).toContain('Parity.no_status');
    });

    it('uses the status type when there is no status text', () => {
        expect(mountPicker({ task: { _id: 't2', statusType: 'active' } }).get('.picker__head .ah-chip').text()).toBe('active');
    });
});

describe('AgentPicker states', () => {
    it('says there are no agents and no people when both lists are empty', () => {
        const wrapper = mountPicker({ agents: [], people: [] });
        const empties = wrapper.findAll('.picker__empty').map((p) => p.text());
        expect(empties).toEqual(expect.arrayContaining(['Parity.no_agents_yet', 'Parity.no_people_match', 'Parity.pick_someone']));
        expect(rows(wrapper)).toHaveLength(0);
        expect(assignButton(wrapper).attributes('disabled')).toBeDefined();
    });

    it('lists agents and people in their groups', () => {
        const wrapper = mountPicker();
        expect(wrapper.findAll('.picker__group .ah-label').map((l) => l.text())).toEqual(['Parity.best_fit', 'Parity.people']);
        expect(wrapper.findAll('.picker__row:not(.picker__row--person) strong').map((s) => s.text())).toEqual(expect.arrayContaining(['Reviewer', 'Scribe', 'Sleeper']));
        expect(wrapper.findAll('.picker__row--person strong').map((s) => s.text())).toEqual(['Asha Rao', 'Ben Ito']);
    });

    it('shows a paused agent as blocked and not selectable, after the eligible ones', async () => {
        const wrapper = mountPicker();
        const names = wrapper.findAll('.picker__row:not(.picker__row--person) strong').map((s) => s.text());
        expect(names[names.length - 1]).toBe('Sleeper');
        const blocked = rowFor(wrapper, 'Sleeper');
        expect(blocked.attributes('disabled')).toBeDefined();
        expect(blocked.classes()).toContain('is-blocked');
        expect(blocked.get('.picker__fit').text()).toBe('Parity.not_eligible');
        expect(blocked.find('.picker__row-facts').exists()).toBe(false);
        await blocked.trigger('click');
        expect(blocked.classes()).not.toContain('is-chosen');
    });

    it('shows the plain labels for an agent with no history', () => {
        const row = rowFor(mountPicker(), 'Reviewer');
        expect(row.get('.picker__fit').text()).toBe('Parity.no_history_yet');
        expect(row.get('.picker__row-facts').text()).toContain('Parity.time_unknown');
        expect(row.get('.picker__row-facts').text()).toContain('Parity.cost_unknown');
    });

    it('shows a percentage and estimate for an agent with finished runs', () => {
        const runs = [1, 2, 3].map((n) => ({ agentId: 'a1', status: 'done', kind: 'general', spend: { usd: 0.5 }, elapsedMs: 300000 + n }));
        const row = rowFor(mountPicker({ runs }), 'Reviewer');
        expect(row.get('.picker__fit').text()).toBe('Parity.percent_fit');
        expect(row.get('.picker__row-facts').text()).toContain('Parity.about_minutes');
        expect(row.get('.picker__row-facts').text()).toContain('Parity.about_usd');
    });

    it('marks the badge with whose key pays', () => {
        const wrapper = mountPicker();
        expect(rowFor(wrapper, 'Reviewer').get('.ah-chip--agent').text()).toContain('Parity.badge_workspace');
        expect(rowFor(wrapper, 'Scribe').get('.ah-chip--agent').text()).toContain('Parity.badge_personal');
    });

    it('flags a person who is over capacity and one who is away', () => {
        const wrapper = mountPicker();
        const busy = rowFor(wrapper, 'Ben Ito');
        expect(busy.get('.picker__row-why').classes()).toContain('picker__row-over');
        expect(busy.get('.picker__row-why').text()).toBe('Parity.away_until · Parity.percent_loaded');
        const free = rowFor(wrapper, 'Asha Rao');
        expect(free.get('.picker__row-why').classes()).not.toContain('picker__row-over');
        expect(free.get('.picker__row-why').text()).toBe('Parity.free_hours');
    });

    it('shows an error from the parent', () => {
        const wrapper = mountPicker({ error: 'Could not assign' });
        expect(wrapper.get('.ah-field__error').text()).toBe('Could not assign');
        expect(mountPicker().find('.ah-field__error').exists()).toBe(false);
    });

    it('shows a busy state on the assign button and blocks it', () => {
        const wrapper = mountPicker({ busy: true });
        expect(assignButton(wrapper).text()).toBe('Parity.assigning');
        expect(assignButton(wrapper).attributes('disabled')).toBeDefined();
        expect(mountPicker().get('.ah-btn--primary').text()).toBe('Parity.assign');
    });
});

describe('AgentPicker choosing', () => {
    it('picks the best eligible agent at once and says what will happen', () => {
        const wrapper = mountPicker();
        const chosen = wrapper.findAll('.is-chosen');
        expect(chosen).toHaveLength(1);
        expect(chosen[0].text()).not.toContain('Sleeper');
        expect(wrapper.find('.picker__confirm').exists()).toBe(true);
        expect(Object.keys(facts(wrapper))).toEqual(['Parity.runs_as', 'Parity.cost_to_you', 'Parity.starts', 'Parity.will_set', 'Parity.wont']);
        expect(assignButton(wrapper).attributes('disabled')).toBeUndefined();
    });

    it('lists what the agent will and will not do from the action registry', async () => {
        const wrapper = mountPicker({ agents: [{ ...workspaceAgent, allowedActions: ['task.get', 'task.comment', 'task.update'] }] });
        const info = facts(wrapper);
        expect(info['Parity.will_set']).toBe('Update task');
        expect(info['Parity.wont']).toContain('Delete task');
    });

    it('shows nothing-yet when the agent has nothing it will set', () => {
        const wrapper = mountPicker({ agents: [workspaceAgent], registryActions: [] });
        expect(facts(wrapper)['Parity.will_set']).toBe('Parity.nothing_yet');
    });

    it('shows a personal-key agent as free and a workspace one as costing the budget', async () => {
        const wrapper = mountPicker();
        await rowFor(wrapper, 'Scribe').trigger('click');
        expect(facts(wrapper)['Parity.runs_as']).toBe('Parity.runs_personal');
        expect(wrapper.get('.picker__free').text()).toBe('$0');
        await rowFor(wrapper, 'Reviewer').trigger('click');
        expect(facts(wrapper)['Parity.runs_as']).toBe('Parity.runs_workspace');
        expect(facts(wrapper)['Parity.cost_to_you']).toBe('Parity.cost_unknown');
        expect(wrapper.find('.picker__free').exists()).toBe(false);
    });

    it('switches to the person summary when a person is clicked', async () => {
        const wrapper = mountPicker();
        await rowFor(wrapper, 'Ben Ito').trigger('click');
        expect(rowFor(wrapper, 'Ben Ito').classes()).toContain('is-chosen');
        expect(wrapper.find('.picker__facts').exists()).toBe(false);
        expect(wrapper.get('.picker__person strong').text()).toBe('Ben Ito');
        expect(wrapper.get('.picker__confirm .picker__note').text()).toBe('Parity.away_until · Parity.percent_loaded');
    });

    it('draws a person initial in the avatar', () => {
        expect(rowFor(mountPicker(), 'Asha Rao').get('.ah-avatar').text()).toBe('A');
    });
});

describe('AgentPicker search', () => {
    it('labels the field and gives it an i18n placeholder', () => {
        const wrapper = mountPicker();
        expect(wrapper.get('label[for="assignee-search"]').text()).toBe('Parity.assignee');
        expect(wrapper.get('#assignee-search').attributes('placeholder')).toBe('Parity.search_people_agents');
    });

    it('filters people and agents by name, ignoring case', async () => {
        const wrapper = mountPicker();
        await search(wrapper, ' BEN ');
        expect(wrapper.findAll('.picker__row--person strong').map((s) => s.text())).toEqual(['Ben Ito']);
        expect(wrapper.findAll('.picker__row:not(.picker__row--person)')).toHaveLength(0);
        expect(wrapper.findAll('.picker__empty').map((p) => p.text())).toContain('Parity.no_agents_yet');
        await search(wrapper, 'scri');
        expect(rows(wrapper).map((r) => r.find('strong').text())).toEqual(['Scribe']);
    });

    it('says no one matches when the person list is filtered empty', async () => {
        const wrapper = mountPicker();
        await search(wrapper, 'zzz');
        expect(wrapper.findAll('.picker__empty').map((p) => p.text())).toContain('Parity.no_people_match');
    });

    // The choice survives a search that hides it: the summary says nobody is picked, yet Assign stays on.
    it.fails('does not offer Assign for a choice that a search has hidden', async () => {
        const wrapper = mountPicker();
        await search(wrapper, 'zzz');
        expect(wrapper.get('.picker__aside .picker__empty').text()).toBe('Parity.pick_someone');
        expect(assignButton(wrapper).attributes('disabled')).toBeDefined();
    });
});

describe('AgentPicker assigning', () => {
    it('emits the chosen agent with the default options', async () => {
        const wrapper = mountPicker();
        await assignButton(wrapper).trigger('click');
        const [payload] = wrapper.emitted('assign')[0];
        expect(payload).toMatchObject({ kind: 'agent', notifyMe: true, stopOverCap: false, capUsd: 0 });
        expect(payload.id).toBe(payload.fit.agentId);
        expect(['a1', 'a2']).toContain(payload.id);
    });

    it('emits a person assignment', async () => {
        const wrapper = mountPicker();
        await rowFor(wrapper, 'Asha Rao').trigger('click');
        await assignButton(wrapper).trigger('click');
        expect(wrapper.emitted('assign')[0][0]).toMatchObject({ kind: 'person', id: 'u1', fit: null });
    });

    it('emits nothing when nobody is available to pick', async () => {
        const wrapper = mountPicker({ agents: [pausedAgent], people: [] });
        await assignButton(wrapper).trigger('click');
        expect(wrapper.emitted('assign')).toBeUndefined();
    });

    it('reveals a spend cap field with the default when the cap box is ticked', async () => {
        const wrapper = mountPicker();
        expect(wrapper.find('.picker__cap').exists()).toBe(false);
        const boxes = wrapper.findAll('.picker__also input[type="checkbox"]');
        expect(wrapper.get('.picker__also').text()).toContain('Parity.notify_me');
        expect(wrapper.get('.picker__also').text()).toContain('Parity.stop_over_cap');
        await boxes[1].setValue(true);
        const cap = wrapper.get('.picker__cap input');
        expect(cap.element.value).toBe('2');
        expect(wrapper.get('.picker__cap').text()).toContain('Parity.cap_usd');
        await cap.setValue('5');
        await boxes[0].setValue(false);
        await assignButton(wrapper).trigger('click');
        expect(wrapper.emitted('assign')[0][0]).toMatchObject({ notifyMe: false, stopOverCap: true, capUsd: 5 });
    });

    it('falls back to the default cap when the field is emptied', async () => {
        const wrapper = mountPicker();
        await wrapper.findAll('.picker__also input[type="checkbox"]')[1].setValue(true);
        await wrapper.get('.picker__cap input').setValue('');
        await assignButton(wrapper).trigger('click');
        expect(wrapper.emitted('assign')[0][0].capUsd).toBe(2);
    });

    it('closes from Cancel', async () => {
        const wrapper = mountPicker();
        const cancel = wrapper.findAll('.picker__actions button').find((b) => b.text() === 'Parity.cancel');
        await cancel.trigger('click');
        expect(wrapper.emitted('close')).toHaveLength(1);
    });
});

describe('AgentPicker keyboard and text', () => {
    it('uses real buttons and inputs only, in reading order, with no positive tabindex', () => {
        const wrapper = mountPicker();
        expect(wrapper.findAll('[tabindex]').filter((el) => Number(el.attributes('tabindex')) > 0)).toEqual([]);
        expect(wrapper.findAll('.picker__row').every((r) => r.element.tagName === 'BUTTON' && r.attributes('type') === 'button')).toBe(true);
        const order = wrapper.findAll('input, button').map((el) => el.element.tagName + (el.attributes('type') || ''));
        expect(order[0]).toBe('INPUTtext');
        expect(order.slice(-2)).toEqual(['BUTTONbutton', 'BUTTONbutton']);
    });

    it('has no bare words in its template', () => {
        const template = source.slice(0, source.indexOf('<script'));
        const bareText = [...template.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)].map((m) => m[1].trim()).filter(Boolean);
        expect(bareText).toEqual([]);
        expect([...template.matchAll(/\s(?:title|placeholder|alt|aria-label)="([^"]+)"/g)]).toEqual([]);
    });
});
