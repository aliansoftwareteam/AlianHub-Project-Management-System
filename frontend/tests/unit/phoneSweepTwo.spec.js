import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, test } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const ruleBody = (css, selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`(^|[\\s,}])${escaped}\\s*(,[^{]*)?\\{([^}]*)\\}`, 'm').exec(css);
    return match ? match[3] : '';
};

const mediaBlocks = (css, query) => {
    const blocks = [];
    for (let at = css.indexOf(query); at !== -1; at = css.indexOf(query, at + 1)) {
        const open = css.indexOf('{', at);
        let depth = 1;
        let end = open + 1;
        for (; end < css.length && depth; end += 1) depth += css[end] === '{' ? 1 : css[end] === '}' ? -1 : 0;
        blocks.push(css.slice(open + 1, end - 1));
    }
    return blocks.join('\n');
};

const phone = (css) => mediaBlocks(css, '@media (max-width: 767px)');

describe('Sign-in & SSO on a phone', () => {
    const vue = read('views/Settings/Sso/SsoSettings.vue');

    test('a long value cannot widen the form past the card', () => {
        expect(ruleBody(vue, '.sso__form-grid')).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\) minmax\(0,\s*1fr\)/);
        expect(ruleBody(phone(vue), '.sso__form-grid')).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s*;/);
        expect(ruleBody(mediaBlocks(vue, '@media (max-width: 1279px)'), '.sso')).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    });
});

describe('Docs hub on a phone', () => {
    test('the view picker shrinks to the room the toolbar has, whatever the longest project name', () => {
        const css = phone(read('views/Pages/PagesSpace.vue'));
        expect(ruleBody(css, '.hub__view-select')).toMatch(/min-width:\s*0/);
        expect(ruleBody(css, '.hub__view-select')).toMatch(/flex:\s*0 1 auto/);
    });
});

describe('Task panel', () => {
    const css = read('components/organisms/TaskDetailOverlay/style.css');

    test('a long title wraps inside the panel instead of pushing the copy button past its edge', () => {
        expect(ruleBody(css, '.ah-detail__title .task-detail-title .task-name')).toMatch(/min-width:\s*0/);
        expect(ruleBody(css, '.ah-detail__title .task-name .title-name__edit')).toMatch(/white-space:\s*normal/);
        expect(ruleBody(css, '.ah-detail__title .task-name .copy-icon__btn')).toMatch(/flex:\s*none/);
    });

    test('a custom field value counts its padding inside its width', () => {
        const fields = read('plugins/customFieldView/component/atom/customFieldTaskView/customFieldListing/style.css');
        expect(ruleBody(fields, '.formkit__content-wrapper .formkit-inner')).toMatch(/box-sizing:\s*border-box/);
        expect(ruleBody(fields, '.formkit__content-wrapper .formkit-inner')).toMatch(/min-width:\s*0/);
    });
});

describe('Inbox on a phone', () => {
    const vue = read('views/Inbox/Inbox.vue');

    test('"needs your approval" drops to a line of its own instead of hiding behind the ellipsis', () => {
        expect(ruleBody(phone(vue), '.ibx__what .ibx__dim')).toMatch(/display:\s*block/);
        expect(ruleBody(phone(vue), '.ibx__dot')).toMatch(/display:\s*none/);
        expect(vue.match(/<span class="ibx__dim"><span class="ibx__dot">· <\/span>/g)).toHaveLength(2);
    });

    test('a proposal in the approval queue wraps what it wants to do instead of cutting it off', () => {
        const queue = read('views/Inbox/ApprovalQueue.vue');
        expect(ruleBody(queue, '.aq__what')).toMatch(/overflow-wrap:\s*anywhere/);
        expect(ruleBody(queue, '.aq__what')).not.toMatch(/text-overflow/);
    });
});

describe('Home setup steps', () => {
    test('each step is a target of at least the hit minimum', () => {
        const css = read('components/molecules/Home/style.css');
        expect(ruleBody(css, '.hc-setup__step button')).toMatch(/min-height:\s*var\(--hit-min\)/);
        expect(ruleBody(css, '.hc-setup__step')).toMatch(/min-height:\s*var\(--hit-min\)/);
    });
});

describe('Report tabs on a phone', () => {
    const css = phone(read('views/Projects/Reports/reportsV2.css'));

    test('the six tabs fit the row, and a longer language scrolls without a scrollbar', () => {
        expect(ruleBody(css, '.rp-tab')).toMatch(/padding:\s*6px 6px/);
        expect(ruleBody(css, '.rp-tabs')).toMatch(/scrollbar-width:\s*none/);
    });
});

describe('Milestone report on a phone', () => {
    test('the table ends above the tab bar, so its scrollbar is on screen', () => {
        const css = read('views/MilestoneReport/MilestoneReport.css');
        expect(ruleBody(phone(css), '.milestone_table_filter_wrapper')).toMatch(/height:\s*calc\(100dvh - var\(--tabbar-h\) - 148px\)/);
    });
});

describe('The toolbar on a phone', () => {
    test('its height is a floor, so a page that wraps it does not depend on which stylesheet loads last', () => {
        const css = phone(read('assets/css/tokens.css'));
        expect(ruleBody(css, '.ah-toolbar')).toMatch(/height:\s*auto/);
        expect(ruleBody(css, '.ah-toolbar')).toMatch(/min-height:\s*var\(--toolbar-h\)/);
    });
});

describe('Menu rows', () => {
    test('a link row is as wide as a button row, padding included, so the More sheet does not pan', () => {
        expect(ruleBody(read('assets/css/tokens.css'), '.ah-pop__item')).toMatch(/box-sizing:\s*border-box/);
    });
});
