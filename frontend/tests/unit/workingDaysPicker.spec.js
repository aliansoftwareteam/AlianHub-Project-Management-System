import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import WorkingDaysPicker from '@/components/molecules/WorkingDaysPicker/WorkingDaysPicker.vue';

const open = (props) => mount(WorkingDaysPicker, { props });
const boxes = (wrapper) => wrapper.findAll('input[type="checkbox"]');
const checked = (wrapper) => boxes(wrapper).filter((box) => box.element.checked).map((box) => Number(box.attributes('data-day')));
const toggle = (wrapper, day, on) => {
    const box = wrapper.find(`input[data-day="${day}"]`);
    box.element.checked = on;
    return box.trigger('change');
};

describe('WorkingDaysPicker', () => {
    it('lists the week from Monday and ticks the working days', () => {
        const wrapper = open({ modelValue: [1, 2, 3, 4, 5] });
        expect(boxes(wrapper).map((box) => Number(box.attributes('data-day')))).toEqual([1, 2, 3, 4, 5, 6, 0]);
        expect(checked(wrapper)).toEqual([1, 2, 3, 4, 5]);
        expect(wrapper.text()).toContain('weekName.mon');
    });

    it('adds a day and sends the week sorted', async () => {
        const wrapper = open({ modelValue: [1, 2, 3, 4, 5] });
        await toggle(wrapper, 0, true);
        expect(wrapper.emitted('update:modelValue')).toEqual([[[0, 1, 2, 3, 4, 5]]]);
    });

    it('removes a day', async () => {
        const wrapper = open({ modelValue: [1, 2, 3, 4, 5] });
        await toggle(wrapper, 5, false);
        expect(wrapper.emitted('update:modelValue')).toEqual([[[1, 2, 3, 4]]]);
    });

    it('keeps the last working day ticked and says why', async () => {
        const wrapper = open({ modelValue: [3] });
        await toggle(wrapper, 3, false);
        expect(wrapper.emitted('update:modelValue')).toBeUndefined();
        expect(checked(wrapper)).toEqual([3]);
        expect(wrapper.find('[role="status"]').text()).toBe('Settings.working_days_min');
    });

    it('cannot be changed while disabled', () => {
        const wrapper = open({ modelValue: [1, 2, 3, 4, 5], disabled: true });
        expect(boxes(wrapper).every((box) => box.element.disabled)).toBe(true);
    });

    it('names the group for a screen reader', () => {
        const wrapper = open({ modelValue: [1], label: 'Project week' });
        expect(wrapper.find('[role="group"]').attributes('aria-label')).toBe('Project week');
    });
});
