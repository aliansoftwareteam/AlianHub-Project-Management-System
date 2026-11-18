import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, test } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const template = (rel) => { const vue = read(rel); return vue.slice(0, vue.lastIndexOf('</template>')).replace(/<!--[\s\S]*?-->/g, ''); };
const styles = (rel) => [...read(rel).matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');

const ruleBody = (css, selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`(^|[\\s,}])${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css);
    return match ? match[2] : '';
};
const tagWith = (rel, tag, marker) => (template(rel).match(new RegExp(`<${tag}\\b(?:"[^"]*"|[^>"])*>`, 'g')) || []).find((found) => found.includes(marker)) || '';
const classOf = (tag) => (/(?:^|\s)class="([^"]*)"/.exec(tag)?.[1] || '').split(/\s+/).filter(Boolean);
const mediaBlock = (css, query) => {
    const start = css.indexOf(query);
    if (start === -1) return '';
    let depth = 0;
    for (let i = css.indexOf('{', start); i < css.length; i += 1) {
        if (css[i] === '{') depth += 1;
        else if (css[i] === '}' && (depth -= 1) === 0) return css.slice(css.indexOf('{', start) + 1, i);
    }
    return '';
};

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(css|scss|vue)$/.test(entry.name) ? [full] : [];
});

const LITERAL = /#[0-9a-f]{3,8}\b|\brgba?\(|\bwhite\b/i;
const TOKEN_CARD = [/background:\s*var\(--surface\)/, /(^|[;\s])color:\s*var\(--ink\)/, /color-scheme:\s*var\(--scheme\)/];
const expectTokenCard = (rel, selector) => {
    const body = ruleBody(styles(rel), selector);
    TOKEN_CARD.forEach((declaration) => expect(body, `${rel} ${selector}`).toMatch(declaration));
};

describe('Story point scale dialog', () => {
    const rel = 'components/molecules/EstimationScale/EstimationScaleModal.vue';

    test('the scale is the shared field, so its value takes the ink of the theme', () => {
        expect(classOf(tagWith(rel, 'select', 'v-model="scale"'))).toEqual(['ah-input', 'esc__select']);
        expect(ruleBody(styles(rel), '.esc__select')).toBe('');
    });

    test('Cancel and Save are shared buttons', () => {
        const [cancel, save] = template(rel).match(/<button\b(?:"[^"]*"|[^>"])*>/g);
        expect(classOf(cancel)).toEqual(expect.arrayContaining(['ah-btn', 'ah-btn--secondary']));
        expect(classOf(save)).toEqual(expect.arrayContaining(['ah-btn', 'ah-btn--primary']));
        expect(styles(rel)).not.toMatch(/esc__ghost-btn/);
    });

    test('the card pairs the surface with the ink and the controls of the theme', () => {
        expectTokenCard(rel, '.esc__card');
    });
});

describe('dialogs opened from the project toolbar inherit its theme ink', () => {
    test.each([
        ['components/molecules/ExportTasks/ExportTasksDropdown.vue', '.export-tasks__card'],
        ['components/molecules/Burndown/BurndownModal.vue', '.burndown__card'],
        ['components/molecules/Epics/EpicsPanel.vue', '.epics__card'],
        ['components/molecules/ImportJira/ImportJiraModal.vue', '.jimport__card'],
        ['components/molecules/ImportTrello/ImportTrelloModal.vue', '.timport__card'],
        ['components/molecules/ImportAsana/ImportAsanaModal.vue', '.aimport__card'],
        ['components/molecules/ImportMonday/ImportMondayModal.vue', '.mimport__card']
    ])('%s is a card of the theme', (rel, selector) => {
        expectTokenCard(rel, selector);
    });

    test.each([
        'components/molecules/ExportTasks/ExportTasksDropdown.vue',
        'components/molecules/Burndown/BurndownModal.vue',
        'components/molecules/ImportJira/ImportJiraModal.vue',
        'components/molecules/ImportTrello/ImportTrelloModal.vue',
        'components/molecules/ImportAsana/ImportAsanaModal.vue',
        'components/molecules/ImportMonday/ImportMondayModal.vue'
    ])('%s paints nothing with a fixed colour', (rel) => {
        const fixed = [...styles(rel).matchAll(/(?:^|[;{\s])((?:background|color|border)[\w-]*)\s*:\s*([^;}]*)/g)]
            .filter(([, , value]) => LITERAL.test(value.replace(/var\([^)]*\)/g, '')))
            .map(([, property, value]) => `${property}: ${value.trim()}`);
        expect(fixed).toEqual([]);
    });

    test.each([
        ['components/molecules/Burndown/BurndownModal.vue', 'v-model="selectedSprintId"'],
        ['components/molecules/ImportJira/ImportJiraModal.vue', 'v-model="selectedSprintId"'],
        ['components/molecules/ImportTrello/ImportTrelloModal.vue', 'v-model="selectedSprintId"'],
        ['components/molecules/ImportAsana/ImportAsanaModal.vue', 'v-model="selectedSprintId"'],
        ['components/molecules/ImportMonday/ImportMondayModal.vue', 'v-model="selectedSprintId"'],
        ['components/molecules/Epics/EpicsPanel.vue', 'v-model="newEpicPriority"']
    ])('the list field of %s is the shared field', (rel, marker) => {
        expect(classOf(tagWith(rel, 'select', marker))).toContain('ah-input');
    });

    test('the Export buttons are shared buttons', () => {
        const buttons = template('components/molecules/ExportTasks/ExportTasksDropdown.vue').match(/<button\b(?:"[^"]*"|[^>"])*>/g);
        expect(buttons).toHaveLength(2);
        buttons.forEach((button) => expect(classOf(button)).toEqual(expect.arrayContaining(['ah-btn', 'ah-btn--primary'])));
    });

    test('the fields of the epics panel take the ink of the theme', () => {
        const rel = 'components/molecules/Epics/EpicsPanel.vue';
        expect(classOf(tagWith(rel, 'input', 'v-model="newEpicName"'))).toContain('ah-input');
        expect(classOf(tagWith(rel, 'input', 'v-model="newEpicStartDate"'))).toContain('ah-input');
        expect(classOf(tagWith(rel, 'input', 'v-model="newEpicDueDate"'))).toContain('ah-input');
        expect(ruleBody(styles(rel), '.epics__status-select')).toMatch(/(^|[;\s])color:\s*var\(--ink\)/);
    });
});

describe('project page with an empty state in its body', () => {
    const rel = 'views/Projects/Projects.vue';

    test('the body is the canvas of the theme when it shows an empty state', () => {
        expect(template(rel)).toMatch(/bodyOnTokens \? 'list-view-body--detail' : 'bg-light-gray'/);
        const declared = /const bodyOnTokens = computed\(\(\) => ([^;]+);/.exec(read(rel));
        expect(declared).toBeTruthy();
        ['TOKEN_BODY_TABS.includes(activeTab.value)', 'folderGone.value', 'folderWithNoLists.value', 'searchFailed.value']
            .forEach((part) => expect(declared[1]).toContain(part));
    });

    test('that body sets the canvas, the ink and the controls of the theme', () => {
        const body = ruleBody(read('views/Projects/style.css'), '.list-view-body--detail');
        expect(body).toMatch(/background:\s*var\(--canvas\)/);
        expect(body).toMatch(/color:\s*var\(--ink\)/);
        expect(body).toMatch(/color-scheme:\s*var\(--scheme\)/);
    });
});

describe('status chip that opens the status list', () => {
    test('drops the browser border wherever the chip is a button', () => {
        const rule = ruleBody(read('views/Projects/ListView/style.css'), 'button.lv2__status-chip');
        expect(rule).toMatch(/border:\s*0/);
        expect(rule).toMatch(/cursor:\s*pointer/);
    });

    test('shows a focus ring outside the Table too', () => {
        expect(ruleBody(read('views/Projects/ListView/style.css'), 'button.lv2__status-chip:focus-visible')).toMatch(/box-shadow:\s*var\(--focus\)/);
    });
});

describe('AI side nav as an icon rail', () => {
    const narrow = mediaBlock(read('views/Ai/sidebar.css').replace(/\/\*[\s\S]*?\*\//g, ''), '@media (max-width: 1280px)');

    test('the count is a brand pill with the ink that reads on it, chosen or not', () => {
        const pill = /([^{}]*)\{([^{}]*background:\s*var\(--brand\)[^{}]*)\}/.exec(narrow);
        expect(pill).toBeTruthy();
        expect(pill[2]).toMatch(/(^|[;\s])color:\s*var\(--on-brand\)/);
        const selectors = pill[1].split(',').map((selector) => selector.trim());
        expect(selectors).toContain('.ai-side__item.router-link-active .ai-side__count');
    });

    test('the pill belongs to the nav item, so a count in a tab stays in its tab', () => {
        expect(narrow).not.toMatch(/(^|[},])\s*\.ai-side__count\s*[,{]/);
    });
});

describe('controls that lost their rule', () => {
    test('no template uses .btn_btn, which no stylesheet defines', () => {
        const users = walk(SRC).filter((file) => file.endsWith('.vue') && /class="[^"]*\bbtn_btn\b/.test(fs.readFileSync(file, 'utf8')));
        expect(users.map((file) => path.relative(SRC, file))).toEqual([]);
    });

    test('Change password saves with a shared button', () => {
        const save = tagWith('views/Settings/ChangePassword/ChangePassword.vue', 'button', 'handleChangePassword');
        expect(classOf(save)).toEqual(expect.arrayContaining(['ah-btn', 'ah-btn--primary', 'mysetting_save_btn']));
    });

    test('a template\'s page goes back and deletes with shared buttons', () => {
        const rel = 'components/templates/CreateProject/TemplateDetail.vue';
        expect(classOf(tagWith(rel, 'button', 'backButtonTemplateList'))).toEqual(expect.arrayContaining(['ah-btn', 'ah-btn--ghost']));
        expect(classOf(tagWith(rel, 'button', 'deleteTemplateBtn'))).toEqual(expect.arrayContaining(['ah-btn', 'ah-btn--ghost']));
        expect(ruleBody(styles(rel), '.ah-btn.deleteTemplateBtn')).toMatch(/color:\s*var\(--danger-ink\)/);
    });

    test('the "no colour" swatch of a project is not a browser button', () => {
        const rule = ruleBody(styles('components/templates/CreateProject/ProjectProfileForm.vue'), '.imageColorPickerDiv button');
        expect(rule).toMatch(/border:\s*0/);
        expect(rule).toMatch(/background:\s*transparent/);
    });
});

describe('light boxes under token text', () => {
    test('the alert box is a card of the theme', () => {
        const rel = 'components/atom/AlertBox/AlertBox.vue';
        const card = tagWith(rel, 'div', 'alert-box ');
        expect(classOf(card)).not.toContain('bg-white');
        expect(classOf(card)).toContain('alert-box');
        expectTokenCard(rel, '.alert-box');
    });

    test('the chosen status row of the milestone card is a tint of the theme', () => {
        expect(ruleBody(styles('components/organisms/MilestoneReportCard/MilestoneReportCard.vue'), '.mrc-bar-row--active')).toMatch(/background:\s*var\(--ok-bg\)/);
    });
});

describe('brand text on a brand fill', () => {
    test('a mention in my own chat bubble on a phone takes the ink that reads on the brand', () => {
        const phone = mediaBlock(read('components/organisms/MainChat/style.css').replace(/\/\*[\s\S]*?\*\//g, ''), '@media (max-width: 767px)');
        expect(ruleBody(phone, '.mc-msg.is-me .mc-msg-body')).toMatch(/background:\s*var\(--brand\)/);
        expect(ruleBody(phone, '.mc-msg.is-me .mc-msg-body :is(a, .mc-mention, .mention)')).toMatch(/color:\s*var\(--on-brand\)/);
    });
});
