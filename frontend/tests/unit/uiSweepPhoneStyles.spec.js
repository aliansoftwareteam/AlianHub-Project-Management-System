import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, test } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const ruleBody = (css, selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`(^|[\\s,}])${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css);
    return match ? match[2] : '';
};

const phoneBlocks = (css) => css.split('@media (max-width: 767px)').slice(1).join('\n');

describe('Home on a phone', () => {
    const phone = phoneBlocks(read('views/Home/style.css'));

    test('the planner follows My Work in the page scroll instead of covering it', () => {
        expect(ruleBody(phone, '.home .ah-page__body')).toMatch(/flex-direction:\s*column/);
        expect(ruleBody(phone, '.home .ah-page__body')).toMatch(/overflow-y:\s*auto/);
        expect(ruleBody(phone, '.home__planner')).toMatch(/position:\s*static/);
    });

    test('the planner toggle is not hidden, so a closed planner can be reopened', () => {
        expect(ruleBody(phone, '.home__planner-toggle')).not.toMatch(/display:\s*none/);
    });
});

describe('Settings → Members rows below 900px', () => {
    const css = read('views/Settings/Members/style.css');
    const narrow = css.slice(css.indexOf('@media (max-width: 900px)'));

    test('the menu sits beside the person and last-active beside the role', () => {
        expect(ruleBody(narrow, '.mbv__actions')).toMatch(/grid-row:\s*1;\s*grid-column:\s*2/);
        expect(ruleBody(narrow, '.mbv__role')).toMatch(/grid-row:\s*2;\s*grid-column:\s*1/);
        expect(ruleBody(narrow, '.mbv__seen')).toMatch(/grid-row:\s*2;\s*grid-column:\s*2/);
    });
});

describe('dark mode icons and checkboxes', () => {
    test('the board card checkbox opts into the dark scheme', () => {
        const css = read('views/Projects/Kanban/new-style.css');
        expect(ruleBody(css, ':root[data-theme="dark"] .kanban-card-multi-select input[type="checkbox"]')).toMatch(/color-scheme:\s*dark/);
    });

    test('the add-assignee icon has no white disc of its own', () => {
        expect(read('assets/images/svg/Assign_white.svg')).not.toMatch(/fill="white"|fill="#fff(fff)?"/i);
    });

    test('the date field icon is a mid grey that reads on both themes', () => {
        expect(read('assets/images/svg/date_icon.svg')).not.toMatch(/fill="black"|fill="#000(000)?"/i);
    });

    test('date fields and picked dates take the theme ink', () => {
        const css = read('components/atom/CalenderCompo/style.css');
        expect(ruleBody(css, ':root[data-theme="dark"] .calendar-comp')).toMatch(/color:\s*var\(--ink\)/);
        expect(ruleBody(css, ':root[data-theme="dark"] .due_date-listing[style*="color: black"]')).toMatch(/color:\s*var\(--ink\)\s*!important/);
    });

    test('the task title copy icon is inverted on the dark panel', () => {
        const css = read('components/molecules/TaskDetailTitle/style.css');
        expect(ruleBody(css, ':root[data-theme="dark"] .task-name .copy-icon')).toMatch(/filter:\s*invert\(1\)/);
    });
});

describe('the project calendar on a phone', () => {
    test('no stylesheet forces FullCalendar to a fixed 1050px table', () => {
        expect(read('components/organisms/SprinstList/style.css')).not.toMatch(/fc-scrollgrid[^{]*\{[^}]*width:\s*1050px/);
    });

    test('the compact phone rules are loaded by the calendar', () => {
        expect(read('views/Projects/ProjectCalendarView/CalendarViewComponent.vue')).toMatch(/<style scoped src="\.\/calendar-phone\.css">/);
        const phone = phoneBlocks(read('views/Projects/ProjectCalendarView/calendar-phone.css'));
        expect(ruleBody(phone, '.cv__grid :deep(.fc-daygrid-day-frame)')).toMatch(/padding:/);
    });
});

describe('phone touch targets', () => {
    test('Home controls reach at least 32px', () => {
        const phone = phoneBlocks(read('components/molecules/Home/style.css'));
        expect(ruleBody(phone, '.home .ah-tbtn--icon')).toMatch(/width:\s*40px/);
        expect(ruleBody(phone, '.hc-tab')).toMatch(/min-height:\s*36px/);
        expect(ruleBody(phone, '.hc-agenda__nav button')).toMatch(/min-height:\s*32px/);
        expect(ruleBody(phone, '.hp-days button')).toMatch(/min-height:\s*36px/);
        expect(ruleBody(phone, '.hp-panel__close')).toMatch(/padding:\s*13px/);
    });

    test('Members row controls reach 40px', () => {
        const phone = phoneBlocks(read('views/Settings/Members/style.css'));
        expect(ruleBody(phone, '.mbv__role-select')).toMatch(/height:\s*40px/);
        expect(ruleBody(phone, '.mbv__actions .mbv__dots')).toMatch(/height:\s*40px/);
    });
});
