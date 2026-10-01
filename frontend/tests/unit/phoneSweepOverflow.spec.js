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

describe('Connections on a phone', () => {
    const css = read('views/Integrations/connections.css');
    const vue = read('views/Integrations/ConnectionsPage.vue');

    test('the single column cannot be widened by the one-line CLI command', () => {
        expect(ruleBody(mediaBlocks(css, '@media (max-width: 900px)'), '.conn__grid')).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    });

    test('the toolbar wraps, with the tabs on a row of their own', () => {
        expect(ruleBody(phone(css), '.ah-page.conn .ah-toolbar')).toMatch(/flex-wrap:\s*wrap/);
        expect(ruleBody(phone(css), '.ah-page.conn .ah-toolbar')).toMatch(/height:\s*auto/);
        expect(ruleBody(phone(css), '.conn__tabs')).toMatch(/order:\s*1/);
        expect(vue).toMatch(/class="ah-tabs conn__tabs"/);
        expect(vue).not.toMatch(/class="ah-tabs"\s+style=/);
    });
});

describe('Project and Tracker timesheets on a phone', () => {
    test('the filter box counts its padding inside its width', () => {
        const css = read('views/Timesheet/style.css');
        expect(ruleBody(mediaBlocks(css, '@media(max-width: 767px)'), '.wf_filter')).toMatch(/box-sizing:\s*border-box/);
    });
});

describe('Skill library on a phone', () => {
    const vue = read('views/Ai/SkillLibrary.vue');

    test('the action table scrolls inside its card', () => {
        expect(vue).toMatch(/<div class="sk-lib__scroll">\s*<table class="ai-table">/);
        expect(ruleBody(vue, '.sk-lib__scroll')).toMatch(/overflow-x:\s*auto/);
    });
});

describe('Audit log on a phone', () => {
    const vue = read('views/Settings/Audit/AuditLog.vue');
    const narrow = mediaBlocks(vue, '@media (max-width: 900px)');

    test('a stacked row is as wide as its card, padding included', () => {
        expect(ruleBody(narrow, '.al__table')).toMatch(/box-sizing:\s*border-box/);
    });

    test('a long name, id or reason wraps inside the row', () => {
        expect(ruleBody(narrow, '.al__actor')).toMatch(/white-space:\s*normal/);
        expect(ruleBody(narrow, '.al__event')).toMatch(/overflow-wrap:\s*anywhere/);
    });

    test('the title stays on one line beside the count and the export button', () => {
        expect(ruleBody(phone(vue), '.al .ah-toolbar__title')).toMatch(/white-space:\s*nowrap/);
        expect(ruleBody(phone(vue), '.al.ah-page .ah-toolbar')).toMatch(/padding:\s*0 16px/);
    });
});

describe('The upgrade wall', () => {
    test('is as wide as the page it covers, padding included', () => {
        expect(ruleBody(read('components/atom/UpgradYourPlanComponent/UpgradYourPlanComponent.vue'), '.upw')).toMatch(/box-sizing:\s*border-box/);
    });
});

describe('Settings > Projects on a phone', () => {
    const listing = mediaBlocks(read('components/molecules/ProjectsListingSetting/style.css'), '@media (max-width: 576px)');
    const page = mediaBlocks(read('views/Settings/Projects/style.css'), '@media (max-width: 576px)');

    test('the project name takes the room the row has, not a fifth of it', () => {
        expect(listing).not.toMatch(/max-width:\s*20%/);
        expect(ruleBody(listing, '.projectInfoTopLine p')).toMatch(/max-width:\s*none/);
        expect(ruleBody(listing, '.projectInfoTopLine p')).toMatch(/min-width:\s*0/);
        expect(ruleBody(listing, '.projectInfoTopLine a')).toMatch(/flex:\s*none/);
    });

    test('the two tabs stay on one line each, above a full-width search', () => {
        expect(ruleBody(page, '.totalCountActiveClose')).toMatch(/flex-wrap:\s*wrap-reverse/);
        expect(ruleBody(page, '.totalCountActiveClose .tab-option')).toMatch(/white-space:\s*nowrap/);
        expect(ruleBody(page, '.totalCountActiveClose .project-search')).toMatch(/flex:\s*1 1 100%/);
    });
});

describe('Project billing on a phone', () => {
    const css = phone(read('views/Billing/style.css'));

    test('the toolbar grows to hold its tabs instead of laying them over the page', () => {
        expect(ruleBody(css, '.ah-page.billing .billing__bar')).toMatch(/flex-wrap:\s*wrap/);
        expect(ruleBody(css, '.ah-page.billing .billing__bar')).toMatch(/height:\s*auto/);
        expect(ruleBody(css, '.billing__tabs')).toMatch(/order:\s*1/);
    });

    test('the contract and its totals share one scroll', () => {
        expect(ruleBody(css, '.billing__body')).toMatch(/overflow-y:\s*auto/);
        expect(ruleBody(css, '.billing__body .billing__main')).toMatch(/overflow:\s*visible/);
    });
});

describe('Planner tray', () => {
    test('a card keeps the height of its text when the list is full', () => {
        expect(ruleBody(read('views/Planner/style.css'), '.planner__card')).toMatch(/flex:\s*none/);
    });
});

describe('People on a phone', () => {
    const css = phone(read('views/People/PeopleDirectory.vue'));

    test('the toolbar wraps and the search takes a row of its own', () => {
        expect(ruleBody(css, '.pd.ah-page .pd__bar')).toMatch(/flex-wrap:\s*wrap/);
        expect(ruleBody(css, '.pd.ah-page .pd__bar')).toMatch(/height:\s*auto/);
        expect(ruleBody(css, '.pd__search')).toMatch(/flex:\s*1 1 100%/);
        expect(ruleBody(css, '.pd__count')).toMatch(/white-space:\s*nowrap/);
    });
});

describe('Trash', () => {
    const vue = read('views/Trash/TrashPage.vue');

    test('a long name ends in an ellipsis instead of running under the Restore button', () => {
        expect(vue).toMatch(/<span class="tr__row-name">\{\{ row\.title \}\}<\/span>/);
        expect(ruleBody(vue, '.tr__row-name')).toMatch(/text-overflow:\s*ellipsis/);
        expect(ruleBody(vue, '.tr__row-title .ah-chip')).toMatch(/flex:\s*none/);
    });
});
