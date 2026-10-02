import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import en from '@/locales/en';
import IntentPreview from '@/components/molecules/IntentPreview/IntentPreview.vue';
import { intentTitle } from '@/components/molecules/IntentPreview/intentLines';

const i18n = () => createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
const t = (key, named) => i18n().global.t(key, named);

let wrapper;
const mountCard = (preview) => {
    wrapper = mount(IntentPreview, { attachTo: document.body, props: { preview }, global: { plugins: [i18n()], stubs: { ShellIcon: true } } });
    return wrapper;
};
const rows = () => wrapper.findAll('[data-test="intent-line"]').map((el) => [el.attributes('data-kind'), el.find('dt').text(), el.find('dd').text()]);
const heading = () => [wrapper.find('[data-test="intent-kind"]').text(), wrapper.find('[data-test="intent-title"]').text()];

afterEach(() => { wrapper?.unmount(); wrapper = null; });

describe('the preview card for a folder an agent wants to create', () => {
    const folder = {
        kind: 'folder',
        title: 'Launch <b>plan</b>',
        lines: [
            { kind: 'place', project: 'Open', list: '' },
            { kind: 'inFolder', name: 'Q3' },
            { kind: 'newLists', names: ['Kickoff'] },
            { kind: 'movedLists', names: ['Twin list'], others: 2 },
            { kind: 'subfolder', name: 'Week one' },
            { kind: 'newLists', names: ['Inner list'] },
            { kind: 'movedLists', names: [], others: 1 },
        ],
    };

    it('says it is a new folder, where it goes, and what is made in it or moved into it', () => {
        mountCard(folder);
        expect(heading()).toEqual(['New folder', 'Launch <b>plan</b>']);
        expect(rows()).toEqual([
            ['place', 'Where', 'Open'],
            ['inFolder', 'Inside', 'Q3'],
            ['newLists', 'New lists', 'Kickoff'],
            ['movedLists', 'Lists moved in', 'Twin list, and 2 lists you cannot open'],
            ['subfolder', 'Subfolder', 'Week one'],
            ['newLists', 'New lists', 'Inner list'],
            ['movedLists', 'Lists moved in', '1 list you cannot open'],
        ]);
        expect(wrapper.find('b').exists()).toBe(false);
        expect(intentTitle(t, folder)).toBe('create the folder “Launch <b>plan</b>”');
    });

    it('leaves out a line that names nothing', () => {
        mountCard({ kind: 'folder', title: 'Empty', lines: [{ kind: 'inFolder', name: ' ' }, { kind: 'subfolder' }, { kind: 'movedLists', names: [], others: 0 }] });
        expect(rows()).toEqual([]);
    });
});

describe('the preview card for a list an agent wants to run as a sprint', () => {
    const sprint = {
        kind: 'sprint',
        title: 'Sprint 9',
        lines: [
            { kind: 'place', project: 'Open', list: '' },
            { kind: 'sprintDays', from: '2026-10-05', to: '2026-10-18' },
            { kind: 'sprintDaysNow', from: '2026-09-01T10:00:00.000Z', to: '2026-09-14T10:00:00.000Z' },
        ],
    };

    it('names the list, the days asked for and the days it has now', () => {
        mountCard(sprint);
        expect(heading()).toEqual(['Sprint', 'Sprint 9']);
        expect(rows()).toEqual([
            ['place', 'Where', 'Open'],
            ['sprintDays', 'Runs', 'Oct 5, 2026 to Oct 18, 2026'],
            ['sprintDaysNow', 'Runs now', 'Sep 1, 2026 to Sep 14, 2026'],
        ]);
        expect(intentTitle(t, sprint)).toBe('run “Sprint 9” as a sprint');
    });

    it('leaves out days it cannot read', () => {
        mountCard({ kind: 'sprint', title: 'Sprint 9', lines: [{ kind: 'sprintDays', from: 'soon', to: '2026-10-18' }, { kind: 'sprintDaysNow', from: '2026-09-01T10:00:00.000Z' }] });
        expect(rows()).toEqual([]);
    });
});
