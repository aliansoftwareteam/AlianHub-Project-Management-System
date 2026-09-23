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

describe('coloured chips in dark mode', () => {
    const css = read('assets/css/tokens.css');

    test('no theme rule out-specifies the chip variants', () => {
        expect(css).not.toMatch(/data-theme="dark"\]\s*\.ah-chip\s*\{/);
    });

    test('the neutral chip follows the theme through a token', () => {
        expect(ruleBody(css, '.ah-chip')).toMatch(/background:\s*var\(--fill\)/);
    });
});

describe('instance console cards', () => {
    const vue = read('views/Settings/Instance/InstanceShell.vue');

    test('paragraphs inside a card take the card gap only', () => {
        expect(ruleBody(vue, '.in-card')).toMatch(/gap:\s*8px/);
        expect(ruleBody(vue, '.in-card > p')).toMatch(/margin:\s*0/);
    });
});

const phoneBlock = (css) => {
    const start = css.indexOf('@media (max-width: 767px)');
    return start === -1 ? '' : css.slice(start);
};

describe('a board card on a phone', () => {
    const phone = phoneBlock(read('views/Projects/Kanban/new-style.css'));

    test('the always-visible task menu does not paint over the due date', () => {
        expect(ruleBody(phone, '.kanban-card .option-list')).toMatch(/background:\s*transparent/);
        const trigger = ruleBody(phone, '.kanban-card .option-list__trigger');
        expect(trigger).toMatch(/min-height:\s*36px/);
        expect(trigger).toMatch(/min-width:\s*44px/);
    });
});

describe('the project calendar grid', () => {
    const css = read('views/Projects/ProjectCalendarView/style.css');
    const phone = read('views/Projects/ProjectCalendarView/calendar-phone.css');

    test('draws each day card on the frame, so no rounded cell corners meet across the collapsed table', () => {
        expect(ruleBody(css, '.cv__grid :deep(.fc-daygrid-day)')).not.toMatch(/border-radius|border:/);
        const frame = ruleBody(css, '.cv__grid :deep(.fc-daygrid-day-frame)');
        expect(frame).toMatch(/border-radius:\s*10px/);
        expect(frame).toMatch(/min-height:\s*100%/);
        expect(ruleBody(css, '.cv__grid :deep(.fc-scrollgrid-sync-table td)')).toMatch(/padding:\s*3px/);
        expect(phone).not.toMatch(/:deep\(\.fc-daygrid-day\)\s*\{/);
    });

    test.each([
        'components/organisms/SprinstList/style.css',
        'plugins/tasklistDashboard/components/organisms/SprintListing/style.css',
    ])('%s no longer paints the other-month day strip outside its own wrapper', (file) => {
        const legacy = read(file);
        const selectors = (legacy.match(/[^{}]+\{[^}]*#fafbfc[^}]*\}/gi) || [])
            .flatMap((block) => block.split('{')[0].split(',').map((s) => s.trim()));
        expect(selectors.length).toBeGreaterThan(0);
        expect(selectors.filter((s) => !s.startsWith('.calendar__view-wrapper'))).toEqual([]);
    });
});

describe('the getting-started card', () => {
    test('draws its 10 px tick with a stroke that stays over a pixel wide', () => {
        const tick = /<ShellIcon v-if="item\.done" name="check" :size="10" :stroke="(\d+(?:\.\d+)?)"/.exec(read('components/organisms/Tour/TourComponet.vue'));
        expect(tick).not.toBeNull();
        expect(Number(tick[1]) * 10 / 24).toBeGreaterThanOrEqual(1.2);
    });
});

describe('switch knobs', () => {
    const tokens = read('assets/css/tokens.css');
    const darkBlock = tokens.slice(tokens.indexOf(':root[data-theme="dark"] {'));

    test('stay white in light mode and turn soft grey in dark', () => {
        expect(ruleBody(tokens, ':root')).toMatch(/--knob:\s*#ffffff/i);
        expect(ruleBody(darkBlock, ':root[data-theme="dark"]')).toMatch(/--knob:\s*#d6d4de/i);
        expect(ruleBody(tokens, ':root')).toMatch(/--on-brand:\s*#ffffff/i);
    });

    test.each([
        ['components/molecules/Setting/AhSwitch.vue', '.ah-switch__knob', '.ah-switch.is-on .ah-switch__knob'],
        ['views/Workflows/style.css', '.wb__knob', '.wb__toggle.is-on .wb__knob'],
        ['views/Automations/style.css', '.au__knob', '.au__toggle.is-on .au__knob'],
        ['views/Projects/RecurringTasks/RecurringTasksManager.vue', '.rtx__toggle-knob', '.rtx__toggle.is-on .rtx__toggle-knob'],
    ])('%s: the knob follows --knob, and --on-brand on the brand track', (file, knob, on) => {
        const css = read(file);
        expect(ruleBody(css, knob)).toMatch(/background:\s*var\(--knob\)/);
        expect(ruleBody(css, on)).toMatch(/background:\s*var\(--on-brand\)/);
    });

    test('the legacy toggle knob is dark on its coloured track in dark mode only', () => {
        const css = read('components/atom/Toggle/style.css');
        expect(ruleBody(css, '.toggle-button')).toMatch(/background-color:\s*#fff/);
        expect(ruleBody(css, ':root[data-theme="dark"] .toggle-button')).toMatch(/background-color:\s*var\(--on-brand\)/);
    });
});

describe('the setup checklist outside Home', () => {
    test('brings its own stylesheet, so Instance → Health renders it styled on a direct visit', () => {
        expect(read('components/molecules/Home/SetupChecklist.vue')).toMatch(/import\s+["']\.\/style\.css["']/);
        expect(ruleBody(read('components/molecules/Home/style.css'), '.hc-setup')).toMatch(/display:\s*flex/);
    });
});
