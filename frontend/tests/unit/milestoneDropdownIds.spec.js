import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ids = vi.hoisted(() => ({ next: 0 }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ debounce: (fn) => fn, makeUniqueId: () => `u${++ids.next}` }),
    useConvertDate: () => ({ convertDateFormat: (value) => String(value) }),
    useGetterFunctions: () => ({ getUser: () => ({ Employee_Name: 'Member', Employee_profileImageURL: '' }) }),
}));
vi.mock('@/composable/Validation', () => ({
    useValidation: () => ({ checkErrors: vi.fn(), checkAllFields: vi.fn(() => Promise.resolve(true)) }),
}));
vi.mock('@/composable/DefaultValidationFunction', () => ({ ValidationFunction: { onlyNumberMilestone: vi.fn() } }));

import FixMilestoneTd from '@/components/atom/FixMilestoneTd/FixMilestoneTd.vue';
import HourlyMilestoneTd from '@/components/atom/HourlyMilestoneTd/HourlyMilestoneTd.vue';

const settingStatus = [{ value: 'RELEASED', name: 'Released', backgroundColor: '#123456' }];
const milestone = (id) => ({
    _id: id,
    milestoneName: `Milestone ${id}`,
    startDate: '2026-01-01',
    endDate: '2026-02-01',
    dueDate: '2026-02-01',
    hours: 2,
    minute: 0,
    amountPerHours: 50,
    amount: 100,
    refundedAmount: [{ amount: 10 }],
    statusArray: [{ milestoneStatusColor: 'RELEASED', statusDateValue: '2026-01-15' }],
});
const common = { focusInputForFix: () => {}, currencyMilestone: { symbol: '$' }, settingStatus, options: [], permissionData: true, planCondition: true };
const MENUS = { refunds: 'Milestone.refund_details', status: 'Milestone.status_history' };
const stubs = { InputText: true, MilestoneDate: true, UserProfile: true };

const ROWS = {
    fixed: {
        component: FixMilestoneTd,
        props: (id, index) => ({ ...common, editfixMilestone: 1, fixMilestoneProps: milestone(id), fixMilestoneIndex: index }),
    },
    hourly: {
        component: HourlyMilestoneTd,
        props: (id, index) => ({
            ...common,
            milestoneArray: milestone(id),
            hourlyMilestoneIndex: index,
            userArray: { [id]: { assigneeArray: [{ id: 'user-1', individualLogTime: 60 }], loggedHours: 60 } },
        }),
    },
};

let wrapper;
const mountRows = async (kind) => {
    const { component, props } = ROWS[kind];
    wrapper = mount(defineComponent({
        components: { Row: component },
        setup: () => ({ rows: [props('m1', 0), props('m2', 1)] }),
        template: '<table><tbody><tr v-for="row in rows" :key="row.fixMilestoneIndex ?? row.hourlyMilestoneIndex"><Row v-bind="row" /></tr></tbody></table>',
    }), { attachTo: '#app', global: { stubs } });
    await flushPromises();
};

const rows = () => [...document.querySelectorAll('#app tr')];
const triggersIn = (row) => [...row.querySelectorAll('[aria-haspopup]')];
const triggerByLabel = (row, label) => row.querySelector(`[aria-haspopup][aria-label="${label}"]`);
const openPanel = () => document.querySelector('#my-dropdown .drop-down-menu');
const press = async (el, key) => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    await flushPromises();
};

beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="my-dropdown"></div><div id="app"></div>';
});

afterEach(() => {
    wrapper?.unmount();
    vi.useRealTimers();
});

describe.each(['fixed', 'hourly'])('%s milestone rows', (kind) => {
    it('give every dropdown trigger, panel and list its own id', async () => {
        await mountRows(kind);
        const [first, second] = rows().map(triggersIn);
        expect(first.length).toBeGreaterThan(0);
        expect(second).toHaveLength(first.length);
        const triggerIds = [...first, ...second].map((el) => el.id);
        const controls = [...first, ...second].map((el) => el.getAttribute('aria-controls'));
        expect(new Set(triggerIds).size).toBe(triggerIds.length);
        expect(new Set(controls).size).toBe(controls.length);
        const ids = [...document.querySelectorAll('[id]')].map((el) => el.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('returns focus to the second row\'s trigger when its status menu closes', async () => {
        await mountRows(kind);
        const trigger = triggerByLabel(rows()[1], MENUS.status);
        trigger.click();
        await flushPromises();
        const item = document.querySelector('#my-dropdown [role="menuitem"]');
        expect(document.activeElement).toBe(item);
        await press(item, 'Escape');
        expect(document.activeElement).toBe(trigger);
    });

    it('marks each opened panel with the class its styling hangs on', async () => {
        await mountRows(kind);
        const row = rows()[1];
        const expected = [
            [MENUS.status, 'milestone_status_panel'],
            [MENUS.refunds, 'milestone_refund_panel'],
        ];
        for (const [label, panelClass] of expected) {
            triggerByLabel(row, label).click();
            await flushPromises();
            expect(openPanel().classList.contains(panelClass)).toBe(true);
            await press(document.querySelector('#my-dropdown [role="menuitem"]'), 'Escape');
            vi.advanceTimersByTime(150);
            await flushPromises();
        }
    });
});

it('marks the hourly members listbox panel with its class', async () => {
    await mountRows('hourly');
    const trigger = triggersIn(rows()[1]).find((el) => el.getAttribute('aria-haspopup') === 'listbox');
    trigger.click();
    await flushPromises();
    expect(openPanel().classList.contains('milestone_members_panel')).toBe(true);
});

describe('FixMilestoneTr.css', () => {
    const css = readFileSync(resolve(__dirname, '../../src/components/atom/FixMilestoneTr/FixMilestoneTr.css'), 'utf8');
    const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, selector, body]) => ({
        selector: selector.trim().replace(/\s+/g, ' '),
        declarations: body.split(';').map((d) => d.replace(/\s+/g, '')).filter(Boolean).sort(),
    }));
    const declarationsFor = (pattern) => rules.filter((rule) => pattern.test(rule.selector)).map((rule) => rule.declarations);

    it('no longer styles milestone dropdown panels by a per-dropdown id', () => {
        expect(css).not.toMatch(/#dd_/);
    });

    it.each([
        [/\.milestone_status_panel$/, ['border-radius:6px!important', 'width:295px']],
        [/\.milestone_status_panel \.dropdown_option$/, ['padding:0!important']],
        [/\.milestone_status_panel \.drop-down-options$/, ['max-height:166px!important']],
        [/\.milestone_refund_panel \.drop-down-options$/, ['max-height:159px!important']],
        [/\.milestone_members_panel \.dropdown_option$/, ['padding:0!important']],
    ])('keeps the old declarations on %s', (pattern, declarations) => {
        expect(declarationsFor(pattern)).toEqual([declarations]);
    });

    it('keeps the old id-level specificity by scoping the panel classes to the dropdown layer', () => {
        const panelRules = rules.filter((rule) => /milestone_(status|refund|members)_panel/.test(rule.selector));
        expect(panelRules).toHaveLength(5);
        panelRules.forEach((rule) => expect(rule.selector.startsWith('#my-dropdown ')).toBe(true));
    });
});
