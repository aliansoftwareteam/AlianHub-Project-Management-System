/* The Gantt, the project calendar and the planner, read from the stylesheets: every size follows the
   look, the classic look still computes the sizes it had, and the libraries that lay out in pixels
   (dhtmlx, FullCalendar) are retoned through tokens rather than edited. */
import { describe, expect, it } from 'vitest';
import { readLookLength } from '@/utils/lookTokens';
import {
    ENV, LEGACY_CLASS, LOOKS, classesIn, declared, fixedFontSizes, hexColours, inkThreeText, literalColours,
    onPhone, px, read, size, styleOf, templateOf, text, unsetWithoutFallback, within,
} from '../tokenSheets';

const GANTT = 'views/Projects/GanttView/style.css';
const GANTT_VIEW = 'views/Projects/GanttView/GanttView.vue';
const CAL = 'views/Projects/ProjectCalendarView/style.css';
const CAL_PHONE = 'views/Projects/ProjectCalendarView/calendar-phone.css';
const CAL_VIEW = 'views/Projects/ProjectCalendarView/CalendarViewComponent.vue';
const PLANNER = 'views/Planner/style.css';
const CONVERTED = [GANTT, CAL, CAL_PHONE, PLANNER];
const TABLET = '(max-width: 768px)';
const POINTER = '(min-width: 768px)';
const deep = (root, inner) => `${root} :deep(${inner})`;

describe('the gantt, calendar and planner stylesheets', () => {
    it.each(CONVERTED)('%s names no hex colour', (rel) => {
        expect(hexColours(rel)).toEqual([]);
    });

    it.each(CONVERTED)('%s paints from the colour tokens only', (rel) => {
        expect(literalColours(rel)).toEqual([]);
    });

    it.each(CONVERTED)('%s sets no font size a look cannot change', (rel) => {
        expect(fixedFontSizes(rel)).toEqual([]);
    });

    it.each(CONVERTED)('%s reads no token the classic look un-sets without a fallback', (rel) => {
        expect(unsetWithoutFallback(rel)).toEqual([]);
    });

    it.each(CONVERTED)('%s never sets text in --ink-3', (rel) => {
        expect(inkThreeText(rel)).toEqual([]);
    });

    it.each([GANTT_VIEW, CAL_VIEW, 'views/Planner/Planner.vue', 'views/Planner/PlannerTray.vue'])('%s carries no legacy size or colour class', (rel) => {
        expect(classesIn(templateOf(rel)).filter((name) => LEGACY_CLASS.test(name))).toEqual([]);
    });

    it('the library stylesheets are not edited: their chrome is retoned from the view', () => {
        expect(styleOf(GANTT)).toMatch(/\.gv__chart :deep\(\.gantt_container\)/);
        expect(styleOf(CAL)).toMatch(/\.cv__grid :deep\(\.fc\)/);
        expect(read(GANTT_VIEW)).toMatch(/<style scoped src="\.\/style\.css"><\/style>/);
        expect(read(CAL_VIEW)).toMatch(/<style scoped src="\.\/style\.css"><\/style>/);
    });
});

describe('the gantt reads the tokens', () => {
    it.each([
        ['.gv__bar', 'height', 'calc(var(--control-h-lg, 32px) + var(--sp-5))'],
        ['.gv__bar', 'padding', '0 var(--page-pad-x, 20px)'],
        ['.gv__toggle', 'height', 'var(--control-h, 28px)'],
        ['.gv__shift', 'padding', 'var(--card-pad-y, 14px) var(--card-pad-x, 16px)'],
        ['.gv__shift', 'border-radius', 'var(--r-card)'],
        ['.gv__replan-close', 'width', 'var(--hit-min)'],
        ['.gv__replan-close', 'height', 'var(--hit-min)'],
        [deep('.gv__chart', '.gantt_cell'), 'font-size', 'var(--fs-md, 12.5px)'],
        [deep('.gv__chart', '.gantt_grid_head_cell'), 'font', 'var(--text-label)'],
        [deep('.gv__chart', '.gantt_task_line'), 'background', 'var(--brand)'],
        [deep('.gv__chart', '.gantt_task_line.gv-critical'), 'background', 'var(--danger)'],
        [deep('.gv__chart', '.gantt_task_cell.gv-off'), 'background', 'var(--fill)'],
        [deep('.gv__chart', '.gantt_scale_cell.gv-off'), 'background', 'var(--fill)'],
        [deep('.gv__chart', '.gantt_task_cell'), 'border-right', '1px solid var(--hairline)'],
        [deep('.gv__chart', '.gantt_grid_scale'), 'background', 'var(--surface)'],
        [deep('.gv__chart', '.gantt_marker.gv-today'), 'border-left', '1.5px dashed var(--danger)'],
        [deep('.gv__chart', '.gantt_marker.gv-today .gantt_marker_content'), 'color', 'var(--surface)'],
        [deep('.gv__chart', '.gantt_task_progress'), 'background', 'color-mix(in srgb, var(--rail-ink-strong) 35%, transparent)'],
        [deep('.gv__chart', '.gv-link-collision .gantt_line_wrapper div'), 'background', 'var(--warn)'],
    ])('%s { %s } is %s', (selector, property, expected) => {
        expect(declared(GANTT, selector, property)).toBe(expected);
    });

    it('a row is as tall as a List row in the look, and the scale header 2px under it', () => {
        const view = read(GANTT_VIEW);
        expect(view).toMatch(/const lookRowHeight = \(\) => readLookLength\('--row-h', 36\);/);
        expect(view).toMatch(/gantt\.config\.row_height = lookRowHeight\(\);/);
        expect(view).toMatch(/gantt\.config\.scale_height = lookRowHeight\(\) - 2;/);
        expect(view).not.toMatch(/row_height = \d|scale_height = \d/);
        expect(LOOKS.map((look) => px('var(--row-h)', ENV[look]))).toEqual([32, 36, 40, 48]);
    });

    it('a length token is read from the page, and the former size stands in where it is missing', () => {
        const el = document.createElement('div');
        document.body.appendChild(el);
        el.style.setProperty('--row-h', '32px');
        expect(readLookLength('--row-h', 36, el)).toBe(32);
        el.style.removeProperty('--row-h');
        expect(readLookLength('--row-h', 36, el)).toBe(36);
        el.remove();
    });

    it('the dense default: a 42px toolbar on the page padding, 26px toggles, 13px rows', () => {
        expect(size(GANTT, '.gv__bar', 'height', 'dense')).toBe(42);
        expect(text(GANTT, '.gv__bar', 'padding', 'dense')).toBe('0 16px');
        expect(size(GANTT, '.gv__toggle', 'height', 'dense')).toBe(26);
        expect(text(GANTT, deep('.gv__chart', '.gantt_cell'), 'font-size', 'dense')).toBe('13px');
        expect(text(GANTT, '.gv__shift', 'padding', 'dense')).toBe('10px 12px');
        expect(text(GANTT, '.gv__tray-item', 'padding', 'dense')).toBe('7px 8px');
        expect(text(GANTT, '.gv__tray-item', 'border-radius', 'dense')).toBe('6px');
        expect(size(GANTT, deep('.gv__chart', '.gv-owner'), 'width', 'dense')).toBe(18);
    });

    it.each([
        ['.gv__bar', 'height', '44px'],
        ['.gv__bar', 'padding', '0 20px'],
        ['.gv__bar', 'gap', '8px'],
        ['.gv__toggle', 'height', '28px'],
        ['.gv__count', 'font-size', '11px'],
        ['.gv__msg code', 'border-radius', '5px'],
        ['.gv__tray', 'padding', '14px'],
        ['.gv__tray-item', 'padding', '9px 10px'],
        ['.gv__tray-item', 'gap', '6px'],
        ['.gv__tray-item', 'border-radius', '9px'],
        ['.gv__replan', 'right', '16px'],
        ['.gv__replan', 'bottom', '14px'],
        ['.gv__replan', 'padding', '10px 30px 10px 12px'],
        ['.gv__replan', 'line-height', '1.5'],
        ['.gv__replan-close', 'font-size', '16px'],
        ['.gv__shift', 'top', '12px'],
        ['.gv__shift', 'right', '16px'],
        ['.gv__shift', 'padding', '14px 16px'],
        ['.gv__shift-row', 'padding', '5px 0'],
        ['.gv__shift-days', 'font-size', '11px'],
        ['.gv__shift-warn', 'padding', '6px 8px'],
        ['.gv__shift-warn', 'border-radius', '6px'],
        ['.gv__shift-note', 'font-size', '11.5px'],
        ['.gv__shift-actions', 'margin-top', '12px'],
        [deep('.gv__chart', '.gantt_cell'), 'font-size', '12.5px'],
        [deep('.gv__chart', '.gantt_task_line'), 'border-radius', '5px'],
        [deep('.gv__chart', '.gantt_task_line.gv-group'), 'border-radius', '4px'],
        [deep('.gv__chart', '.gantt_marker.gv-today .gantt_marker_content'), 'font', '600 9px/1.4 var(--font-mono)'],
        [deep('.gv__chart', '.gv-owner'), 'width', '20px'],
        [deep('.gv__chart', '.gv-owner'), 'font', '600 9px/1 var(--font-ui)'],
        [deep('.gv__chart', '.gv-unassigned'), 'font-size', '10px'],
    ])('classic: %s { %s } is still %s', (selector, property, former) => {
        expect(text(GANTT, selector, property, 'classic')).toBe(former);
    });

    it.each(LOOKS)('the toggles and the close button of the re-plan note are 24px targets in %s', (look) => {
        expect(size(GANTT, '.gv__toggle', 'height', look)).toBeGreaterThanOrEqual(24);
        expect(size(GANTT, '.gv__replan-close', 'width', look)).toBeGreaterThanOrEqual(24);
        expect(size(GANTT, '.gv__replan-close', 'height', look)).toBeGreaterThanOrEqual(24);
        expect(parseFloat(text(GANTT, '.gv__replan', 'padding', look).split(' ')[1])).toBeGreaterThanOrEqual(size(GANTT, '.gv__replan-close', 'width', look));
    });
});

describe('the project calendar reads the tokens', () => {
    it.each([
        ['.cv__bar', 'height', 'calc(var(--control-h-lg, 32px) + var(--sp-3))'],
        ['.cv__bar', 'padding', '0 var(--page-pad-x, 16px)'],
        ['.cv__filter', 'height', 'var(--control-h, 26px)'],
        ['.cv__filter', 'border-radius', 'var(--r-input)'],
        ['.cv__band', 'background', 'var(--fill)'],
        ['.cv__card.is-dragging', 'box-shadow', 'var(--shadow-pop)'],
        ['.cv__chip', 'font-size', 'var(--fs-sm, 11.5px)'],
        ['.cv__chip', 'border-radius', 'var(--r-sm, 5px)'],
        [deep('.cv__grid', '.fc-daygrid-day-frame'), 'border-radius', 'var(--r-lg, 10px)'],
        [deep('.cv__grid', '.fc-daygrid-day-frame'), 'padding', 'var(--sp-2)'],
        [deep('.cv__grid', '.fc-day-today .fc-daygrid-day-frame'), 'border', '1.5px solid var(--brand)'],
        [deep('.cv__grid', '.fc-col-header-cell-cushion'), 'font', 'var(--text-label)'],
        [deep('.cv__grid', '.cv__daynum'), 'font', 'var(--text-data)'],
        [deep('.cv__grid', '.fc-popover'), 'background', 'var(--surface)'],
    ])('%s { %s } is %s', (selector, property, expected) => {
        expect(declared(CAL, selector, property)).toBe(expected);
    });

    it('a weekend day is a half-strength surface in light, and the second surface in dark', () => {
        const weekend = '.cv__grid :deep(.fc-day-sat .fc-daygrid-day-frame)';
        expect(declared(CAL, weekend, 'background')).toBe('color-mix(in srgb, var(--surface) 50%, transparent)');
        expect(declared(CAL, `:root[data-theme="dark"] ${weekend}`, 'background')).toBe('var(--surface-2)');
    });

    /* The toolbar above opens the month picker over the grid. FullCalendar's own z-indexes (header 3,
       events 6, popover 9999) sat in the page's stacking context and painted over it. */
    it('the grid is its own stacking context, so the month picker opens above it', () => {
        expect(declared(CAL, '.cv__body', 'isolation')).toBe('isolate');
        expect(read('components/atom/MonthlyCalendarMilestone/MonthlyCalendarMilestone.vue')).toMatch(/class="calendar_wrapper z-index-2"/);
    });

    it('the dense default: a 38px bar, 26px filters, 6px day cards, 11.5px chips', () => {
        expect(size(CAL, '.cv__bar', 'height', 'dense')).toBe(38);
        expect(size(CAL, '.cv__filter', 'height', 'dense')).toBe(26);
        expect(text(CAL, '.cv__filter', 'border-radius', 'dense')).toBe('4px');
        expect(text(CAL, '.cv__main', 'padding', 'dense')).toBe('12px 16px');
        expect(text(CAL, deep('.cv__grid', '.fc-daygrid-day-frame'), 'border-radius', 'dense')).toBe('6px');
        expect(text(CAL, deep('.cv__grid', '.fc-daygrid-day-frame'), 'padding', 'dense')).toBe('4px');
        expect(text(CAL, '.cv__chip', 'font-size', 'dense')).toBe('11.5px');
        expect(text(CAL, '.cv__chip', 'padding', 'dense')).toBe('3px 5px');
        expect(text(CAL, '.cv__card', 'padding', 'dense')).toBe('7px 8px');
        expect(text(CAL, '.cv__tray', 'padding', 'dense')).toBe('12px');
    });

    it.each([
        ['.cv__bar', 'height', '40px'],
        ['.cv__bar', 'gap', '6px'],
        ['.cv__bar', 'padding', '0 16px'],
        ['.cv__filter', 'height', '26px'],
        ['.cv__filter', 'padding', '0 10px'],
        ['.cv__filter', 'border-radius', '8px'],
        ['.cv__main', 'padding', '14px 16px'],
        ['.cv__main', 'gap', '6px'],
        ['.cv__band', 'padding', '0 8px'],
        ['.cv__band', 'border-radius', '5px'],
        ['.cv__tray', 'padding', '14px'],
        ['.cv__tray', 'gap', '8px'],
        ['.cv__card', 'padding', '9px 10px'],
        ['.cv__card', 'border-radius', '9px'],
        ['.cv__proposal', 'padding', '9px 10px'],
        ['.cv__proposal', 'line-height', '1.45'],
        ['.cv__chip', 'gap', '4px'],
        ['.cv__chip', 'padding', '3px 7px'],
        ['.cv__chip', 'border-radius', '5px'],
        ['.cv__chip', 'font-size', '11.5px'],
        [deep('.cv__grid', '.fc-col-header-cell'), 'padding-bottom', '6px'],
        [deep('.cv__grid', '.fc-daygrid-day-frame'), 'padding', '6px'],
        [deep('.cv__grid', '.fc-daygrid-day-frame'), 'border-radius', '10px'],
        [deep('.cv__grid', '.cv__pto'), 'font-size', '10.5px'],
        [deep('.cv__grid', '.fc-daygrid-more-link'), 'font-size', '10.5px'],
        [deep('.cv__grid', '.fc-daygrid-more-link'), 'padding', '0 7px'],
        [deep('.cv__grid', '.fc-popover'), 'border-radius', '10px'],
    ])('classic: %s { %s } is still %s', (selector, property, former) => {
        expect(text(CAL, selector, property, 'classic')).toBe(former);
    });

    it.each(LOOKS)('a filter and, with a pointer, the "more" link are 24px targets in %s', (look) => {
        expect(size(CAL, '.cv__filter', 'height', look)).toBeGreaterThanOrEqual(24);
        expect(px(within(CAL, POINTER, deep('.cv__grid', '.fc-daygrid-more-link'), 'min-height'), ENV[look])).toBeGreaterThanOrEqual(24);
    });

    it('on a phone a filter is at the 40px floor, and the month grid keeps its small type', () => {
        expect(px(onPhone(CAL, '.cv__filter', 'height'), ENV.phone)).toBe(40);
        expect(px(onPhone(CAL_PHONE, '.cv__chip', 'font-size'), ENV.classic)).toBe(10);
        expect(px(onPhone(CAL_PHONE, '.cv__chip', 'font-size'), ENV.phone)).toBe(10);
        expect(px(onPhone(CAL_PHONE, deep('.cv__grid', '.cv__daynum'), 'font-size'), ENV.classic)).toBe(11);
    });
});

describe('the planner reads the tokens', () => {
    it.each([
        ['.planner__corner', 'height', 'calc(var(--row-h) + 10px)'],
        ['.planner__day-head', 'height', 'calc(var(--row-h) + 10px)'],
        ['.planner__block', 'border-radius', 'var(--r-input)'],
        ['.planner__block', 'font', '600 var(--fs-sm, 11.5px)/var(--lh-snug, 1.25) var(--font-ui)'],
        ['.planner__card', 'font', 'var(--fw-strong, 500) var(--fs-md, 12.5px)/var(--lh-snug, 1.35) var(--font-ui)'],
        ['.planner__card', 'border-radius', 'var(--r-lg, 9px)'],
        ['.planner__range button', 'min-height', 'var(--hit-min)'],
        ['.planner__col.is-today', 'background-color', 'var(--brand-tint)'],
        ['.planner__now', 'background', 'var(--danger)'],
    ])('%s { %s } is %s', (selector, property, expected) => {
        expect(declared(PLANNER, selector, property)).toBe(expected);
    });

    it('the dense default: a 42px day header, 13px tray cards, 4px blocks', () => {
        expect(size(PLANNER, '.planner__day-head', 'height', 'dense')).toBe(42);
        expect(size(PLANNER, '.planner__corner', 'height', 'dense')).toBe(42);
        expect(text(PLANNER, '.planner__card', 'font', 'dense')).toBe('500 13px/1.25 var(--font-ui)');
        expect(text(PLANNER, '.planner__card', 'padding', 'dense')).toBe('7px 9px');
        expect(text(PLANNER, '.planner__card', 'margin', 'dense')).toBe('0 12px 6px');
        expect(text(PLANNER, '.planner__block', 'border-radius', 'dense')).toBe('4px');
        expect(text(PLANNER, '.planner__block', 'padding', 'dense')).toBe('3px 6px');
        expect(text(PLANNER, '.planner__tray-title', 'padding', 'dense')).toBe('10px 12px 6px');
    });

    it.each([
        ['.planner__range button', 'padding', '4px 6px'],
        ['.planner__range button', 'border-radius', '6px'],
        ['.planner__corner', 'height', '46px'],
        ['.planner__day-head', 'height', '46px'],
        ['.planner__day-head', 'font', '600 12px/1 var(--font-ui)'],
        ['.planner__hour', 'right', '8px'],
        ['.planner__block', 'left', '4px'],
        ['.planner__block', 'border-radius', '8px'],
        ['.planner__block', 'padding', '5px 8px'],
        ['.planner__block', 'font', '600 11.5px/1.25 var(--font-ui)'],
        ['.planner__tray-empty', 'margin', '0 14px'],
        ['.planner__tray-title', 'padding', '12px 14px 8px'],
        ['.planner__tray-tabs', 'padding', '0 14px 10px'],
        ['.planner__tray-foot', 'padding', '10px 14px'],
        ['.planner__card', 'margin', '0 14px 8px'],
        ['.planner__card', 'padding', '9px 11px'],
        ['.planner__card', 'border-radius', '9px'],
        ['.planner__card', 'font', '500 12.5px/1.35 var(--font-ui)'],
        ['.planner__card-meta', 'gap', '8px'],
    ])('classic: %s { %s } is still %s', (selector, property, former) => {
        expect(text(PLANNER, selector, property, 'classic')).toBe(former);
    });

    it.each(LOOKS)('the week arrows are 24px targets in %s', (look) => {
        expect(size(PLANNER, '.planner__range button', 'min-width', look)).toBeGreaterThanOrEqual(24);
        expect(size(PLANNER, '.planner__range button', 'min-height', look)).toBeGreaterThanOrEqual(24);
    });

    it('on a phone the arrows, a day and a block keep the 44px they had, and no arrow is narrower than the floor', () => {
        expect(within(PLANNER, TABLET, '.planner__range button', 'min-height')).toBe('44px');
        expect(px(within(PLANNER, TABLET, '.planner__range button', 'min-width'), ENV.phone)).toBe(40);
        expect(within(PLANNER, TABLET, '.planner__day', 'min-height')).toBe('44px');
        expect(within(PLANNER, TABLET, '.planner__block', 'min-height')).toBe('44px');
    });
});
