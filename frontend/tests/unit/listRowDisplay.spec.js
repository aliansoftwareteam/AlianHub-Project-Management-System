/* PR 3 — list rows: the priority word comes from the company vocabulary, the risk cell
   reads like the Table's, empty status groups collapse, and every declared grid track
   has a cell to fill it. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref } from 'vue';

import ListRow from '@/views/Projects/ListView/ListRow.vue';
import { priorityMeta } from '@/components/molecules/Home/homeFormat';
import { groupCount, groupRef, isGroupOpen, sprintTotal } from '@/views/Projects/ListView/listGroups';
import en from '@/locales/en';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../src');

/* The workspace this app runs against defines exactly these three; there is no URGENT,
   and PATCH /api/v2/tasks validates nothing, so any other string can reach a row. */
const COMPANY_PRIORITIES = [
    { name: 'High', value: 'HIGH' },
    { name: 'Medium', value: 'MEDIUM' },
    { name: 'Low', value: 'LOW' }
];

const store = (priorities = COMPANY_PRIORITIES) => createStore({
    getters: {
        'settings/companyPriority': () => priorities,
        'settings/companyMembers': () => [],
        'projectData/currentProjectDetails': () => ({}),
        'settings/teams': () => []
    }
});

const task = (overrides = {}) => ({
    _id: 't1',
    TaskName: 'Point the apex domain at the new load balancer',
    TaskKey: 'SHOP-12',
    isParentTask: true,
    statusType: 'active',
    AssigneeUserId: [],
    ...overrides
});

const renderRow = (data, priorities) => mount(ListRow, {
    props: { data },
    global: {
        plugins: [store(priorities)],
        provide: {
            $defaultUserAvatar: ref(''),
            $defaultGhostCustomUserImg: ref(''),
            $defaultTaskStatusImg: ref('')
        },
        stubs: { ShellIcon: true, ProvenanceBadge: true }
    }
});

const prioChip = (wrapper) => wrapper.find('.lv2__c-prio .ah-chip');

describe('the priority word comes from the company vocabulary', () => {
    test('MEDIUM reads "Medium", the word settings actually defines', () => {
        const chip = prioChip(renderRow(task({ Task_Priority: 'MEDIUM' })));
        expect(chip.exists()).toBe(true);
        expect(chip.text()).toBe('Medium');
    });

    test('"Normal" is gone from the row and from the Home key it came from', () => {
        expect(prioChip(renderRow(task({ Task_Priority: 'MEDIUM' }))).text()).not.toBe('Normal');
        expect(en.Home.priority_medium).toBe('Medium');
    });

    test('a workspace that renames a priority sees its own name, not a built-in one', () => {
        const renamed = [{ name: 'Blocker', value: 'HIGH' }, { name: 'Normal-ish', value: 'MEDIUM' }];
        expect(prioChip(renderRow(task({ Task_Priority: 'HIGH' }), renamed)).text()).toBe('Blocker');
    });

    test('the chip tone still keys off the built-in key, so a renamed HIGH stays warn', () => {
        const renamed = [{ name: 'Blocker', value: 'HIGH' }];
        expect(prioChip(renderRow(task({ Task_Priority: 'HIGH' }), renamed)).classes()).toContain('ah-chip--warn');
    });

    test('a value the settings cannot produce states nothing at all', () => {
        expect(prioChip(renderRow(task({ Task_Priority: 'P1' }))).exists()).toBe(false);
    });

    test('priorityMeta no longer names an unknown value after MEDIUM', () => {
        expect(priorityMeta('P1')).toEqual({ key: 'P1', label: '', cls: '' });
        expect(priorityMeta('MEDIUM').label).toBe('Home.priority_medium');
    });

    test('the row uses one chip primitive, not a private copy', () => {
        const wrapper = renderRow(task({ Task_Priority: 'HIGH' }));
        expect(wrapper.find('.lv2__prio').exists()).toBe(false);
        expect(wrapper.find('.lv2__c-prio .ah-chip').exists()).toBe(true);
    });
});

describe('the risk cell reads like the Table view\'s', () => {
    const overdue = task({
        Task_Priority: 'HIGH',
        DueDate: new Date(Date.now() - 30 * 86400000).toISOString(),
        statusType: 'active'
    });

    test('the level is on the row, not only in a title attribute', () => {
        const cell = renderRow(overdue).find('.lv2__risk');
        expect(cell.exists()).toBe(true);
        expect(cell.text()).toMatch(/^List\.risk_(low|med|high) · \d+$/);
    });
});

describe('every cell is announced as one', () => {
    test('the row is a row and each of its eight cells carries a cell role', () => {
        const wrapper = renderRow(task({ Task_Priority: 'HIGH' }));
        expect(wrapper.find('[role="row"]').exists()).toBe(true);
        expect(wrapper.findAll('[role="row"] > [role="cell"]')).toHaveLength(8);
    });
});

describe('empty status groups collapse to a chip', () => {
    const item = (over = {}) => ({ key: 'k', isExpanded: true, searchKey: 'statusKey', searchValue: 3, ...over });
    const sprint = { id: 's1' };
    const refFor = (i) => groupRef(sprint, i);

    test('a status with no tasks does not draw a group panel', () => {
        const i = item();
        expect(isGroupOpen({ statusKey_3: 0 }, i, new Set(), refFor(i))).toBe(false);
    });

    test('a status with tasks still draws one', () => {
        const i = item();
        expect(isGroupOpen({ statusKey_3: 7 }, i, new Set(), refFor(i))).toBe(true);
    });

    test('opening an empty group by hand keeps it open', () => {
        const i = item();
        const opened = new Set([refFor(i)]);
        expect(isGroupOpen({ statusKey_3: 0 }, i, opened, refFor(i))).toBe(true);
    });

    test('a user-collapsed group stays collapsed however many tasks it holds', () => {
        const i = item({ isExpanded: false });
        expect(isGroupOpen({ statusKey_3: 42 }, i, new Set(), refFor(i))).toBe(false);
    });

    test('a sprint whose counts have not landed hides nothing', () => {
        const i = item();
        expect(isGroupOpen(undefined, i, new Set(), refFor(i))).toBe(true);
    });

    test('groups of different statuses get distinct keys, so opening one opens one', () => {
        expect(refFor(item())).not.toBe(refFor(item({ searchValue: 4 })));
    });

    test('the chip still shows a real count', () => {
        expect(groupCount({ statusKey_3: 12 }, item())).toBe(12);
        expect(groupCount(undefined, item())).toBe(0);
    });
});

describe('the real empty state is reached only when the project is really empty', () => {
    test('a sprint reports the total it carries', () => {
        expect(sprintTotal({ id: 's1', tasks: 52 }, undefined)).toBe(52);
    });

    test('with no reported total the loaded group counts stand in', () => {
        expect(sprintTotal({ id: 's1' }, { statusKey_1: 3, statusKey_2: 4 })).toBe(7);
    });

    test('a sprint with neither counts nor a total reads zero', () => {
        expect(sprintTotal({ id: 's1' }, undefined)).toBe(0);
    });
});

describe('the grid declares one track per cell it still shows', () => {
    const css = fs.readFileSync(path.join(SRC, 'views/Projects/ListView/style.css'), 'utf8');
    const METADATA = ['lv2__c-assignee', 'lv2__c-due', 'lv2__c-prio', 'lv2__c-est', 'lv2__c-risk', 'lv2__c-done'];

    /* Rebuilds what the cascade leaves at a width: the last --lv2-cols whose query
       matches, and every metadata cell not hidden by a matching query. */
    const at = (width) => {
        const blocks = [{ query: Infinity, body: css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '') }];
        const media = /@media \(max-width: (\d+)px\) \{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g;
        let hit;
        while ((hit = media.exec(css)) !== null) blocks.push({ query: Number(hit[1]), body: hit[2] });
        const live = blocks.filter((b) => width <= b.query);

        let tracks = 0;
        const hidden = new Set();
        live.forEach((block) => {
            const cols = [...block.body.matchAll(/--lv2-cols:([^;]+);/g)].pop();
            if (cols) tracks = cols[1].trim().replace(/minmax\([^)]*\)/g, 'x').split(/\s+/).length;
            [...block.body.matchAll(/([^{}]+)\{[^{}]*display:\s*none[^{}]*\}/g)].forEach((rule) => {
                rule[1].split(',').forEach((sel) => METADATA.forEach((c) => { if (sel.includes(c)) hidden.add(c); }));
            });
        });
        return { tracks, cells: 2 + METADATA.filter((c) => !hidden.has(c)).length };
    };

    test.each([1440, 1280, 1200, 1100, 1024, 900, 767, 375])('%ipx', (width) => {
        const { tracks, cells } = at(width);
        expect(tracks).toBeGreaterThan(0);
        expect(tracks).toBe(cells);
    });
});

describe('the metadata columns are sized for content and right-aligned', () => {
    const css = fs.readFileSync(path.join(SRC, 'views/Projects/ListView/style.css'), 'utf8');
    const rootCols = css.match(/\.lv2 \{\s*--lv2-cols:([^;]+);/)[1].trim();
    const fixedPx = (value) => value.split(/\s+/).filter((t) => /^\d+px$/.test(t)).slice(1).reduce((sum, t) => sum + parseInt(t, 10), 0);

    test('the six metadata tracks no longer reserve the old 504px', () => {
        expect(fixedPx(rootCols)).toBeLessThanOrEqual(420);
    });

    test('a value that outgrows its fixed track overflows rather than doubling the row', () => {
        expect(css).toMatch(/\.lv2__c-due, \.lv2__c-est, \.lv2__c-risk, \.lv2__c-prio \{ white-space: nowrap; \}/);
    });

    test('cells sit at the end of their track, with the name and checkbox stretched', () => {
        expect(css).toMatch(/\.lv2__row \{[^}]*justify-items: end/);
        expect(css).toMatch(/\.lv2__cols \{[^}]*justify-items: end/);
        expect(css).toMatch(/\.lv2__c-select, \.lv2__c-title \{ justify-self: stretch; \}/);
    });

    test('the header pins to the top of the scroller it lives in', () => {
        expect(css).toMatch(/\.lv2__cols \{[^}]*position: sticky[^}]*top: 0/);
        expect(css).toMatch(/\.lv2__cols \{[^}]*background: var\(--canvas\)/);
    });

    test('the header gutter matches the indent, border and padding under it', () => {
        expect(css).toMatch(/\.lv2__cols \{[^}]*padding: 14px 13px 8px 29px/);
        expect(css).toMatch(/\.lv2__sprint > \.lv2__group,\s*\.lv2__sprint > \.lv2__collapsed-item \{ margin-left: 16px; \}/);
    });

    /* A sticky box cannot rise above its containing block, so a padded scroller would
       leave a strip of rows on show above the pinned header. */
    test('the scroller keeps no top padding for the sticky header to be trapped under', () => {
        expect(css).toMatch(/\.lv2__scroll \{[^}]*padding: 0 20px 24px/);
    });
});
