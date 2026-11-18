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
const copyOf = (...lines) => ({ kind: 'projectCopy', title: 'Sandbox <b>copy</b>', lines: [{ kind: 'copyOf', project: 'QA Sandbox' }, { kind: 'copyParts' }, ...lines, { kind: 'members', only: 'approver' }] });
const PARTS = ['copyParts', 'Copied', 'Its folders, lists, statuses, fields, views and settings. Its automations come too, switched off, where you may manage them.'];
const PRIVATE = ['members', 'On it', 'Only the person who approves it, at first. It starts private; add people in the project afterwards.'];

afterEach(() => { wrapper?.unmount(); wrapper = null; });

describe('the preview card for a copy of a project an agent asks for', () => {
    it('says it is a copy, of which project, what is copied, that no task comes with it and that it starts private', () => {
        const preview = copyOf({ kind: 'copyTasks', asked: false });
        mountCard(preview);
        expect(heading()).toEqual(['Project copy', 'Sandbox <b>copy</b>']);
        expect(rows()).toEqual([['copyOf', 'Copy of', 'QA Sandbox'], PARTS, ['copyTasks', 'Tasks', 'None. Only the setup is copied.'], PRIVATE]);
        expect(wrapper.find('b').exists()).toBe(false);
        expect(intentTitle(t, preview)).toBe('copy a project as “Sandbox <b>copy</b>”');
    });

    it('says how many tasks would be copied, and that the dates are kept', () => {
        mountCard(copyOf({ kind: 'copyTasks', asked: true, count: 12, limit: 0 }, { kind: 'copyDates' }));
        expect(rows().slice(2, 4)).toEqual([
            ['copyTasks', 'Tasks', '12 tasks you can open, without their assignees'],
            ['copyDates', 'Dates', 'Kept as they are in the project'],
        ]);
    });

    it('words one task, and a project with no task the person can open', () => {
        mountCard(copyOf({ kind: 'copyTasks', asked: true, count: 1, limit: 0 }));
        expect(rows()[2]).toEqual(['copyTasks', 'Tasks', '1 task you can open, without its assignees']);
        wrapper.unmount();
        mountCard(copyOf({ kind: 'copyTasks', asked: true, count: 0, limit: 0 }));
        expect(rows()[2]).toEqual(['copyTasks', 'Tasks', 'None: it has no task you can open.']);
    });

    it('says when the tasks are too many, and that approving makes nothing', () => {
        mountCard(copyOf({ kind: 'copyTasks', asked: true, count: 412, limit: 300 }));
        expect(rows()[2][2]).toBe('412 tasks, and a copy made this way takes at most 300. Approving it makes nothing: decline it, then ask for the copy without its tasks or duplicate the project yourself.');
    });

    it('leaves out a line that names no project', () => {
        mountCard({ kind: 'projectCopy', title: 'Copy', lines: [{ kind: 'copyOf', project: ' ' }] });
        expect(rows()).toEqual([]);
    });
});
