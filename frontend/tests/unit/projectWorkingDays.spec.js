import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import ProjectWorkingDays from '@/components/molecules/WorkingDaysPicker/ProjectWorkingDays.vue';

const SUN_TO_THU = [0, 1, 2, 3, 4];
const COMPANY = { _id: 'company-1', workingDays: [1, 2, 3, 4, 5, 6] };

const open = (props) => mount(ProjectWorkingDays, { props: { company: COMPANY, editable: true, ...props } });
const inherit = (wrapper) => wrapper.find('input[data-inherit]');
const dayBoxes = (wrapper) => wrapper.findAll('input[data-day]');
const checked = (wrapper) => dayBoxes(wrapper).filter((box) => box.element.checked).map((box) => Number(box.attributes('data-day')));
const toggle = (box, on) => {
    box.element.checked = on;
    return box.trigger('change');
};

describe('ProjectWorkingDays', () => {
    it.each([['no override', {}], ['a cleared override', { workingDays: null }], ['an empty list', { workingDays: [] }]])(
        'shows the company\'s week, locked, for a project with %s',
        (_label, project) => {
            const wrapper = open({ project });
            expect(inherit(wrapper).element.checked).toBe(true);
            expect(checked(wrapper)).toEqual([1, 2, 3, 4, 5, 6]);
            expect(dayBoxes(wrapper).every((box) => box.element.disabled)).toBe(true);
        }
    );

    it('starts an override from the company\'s week', async () => {
        const wrapper = open({ project: {} });
        await toggle(inherit(wrapper), false);
        expect(wrapper.emitted('update')).toEqual([[[1, 2, 3, 4, 5, 6]]]);
    });

    it('shows the project\'s own week and lets it change', async () => {
        const wrapper = open({ project: { workingDays: SUN_TO_THU } });
        expect(inherit(wrapper).element.checked).toBe(false);
        expect(checked(wrapper)).toEqual([1, 2, 3, 4, 0]);
        await toggle(wrapper.find('input[data-day="5"]'), true);
        expect(wrapper.emitted('update')).toEqual([[[0, 1, 2, 3, 4, 5]]]);
    });

    it('goes back to the company\'s week by sending null', async () => {
        const wrapper = open({ project: { workingDays: SUN_TO_THU } });
        await toggle(inherit(wrapper), true);
        expect(wrapper.emitted('update')).toEqual([[null]]);
    });

    it('is read-only for someone who cannot edit the project', () => {
        const wrapper = open({ project: { workingDays: SUN_TO_THU }, editable: false });
        expect(inherit(wrapper).element.disabled).toBe(true);
        expect(dayBoxes(wrapper).every((box) => box.element.disabled)).toBe(true);
    });
});
