/* Task 092: the People filter of the Time reports offers teams above the people. */
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import EverythingFilterChip from '@/views/Everything/EverythingFilterChip.vue';
import ReportFilterBar from '@/views/Timesheet/report/ReportFilterBar.vue';
import { groupMatching, groupState, toggleGroup } from '@/views/Everything/filterGroups';

vi.mock('@/views/Timesheet/report/ReportDateChip.vue', () => ({ default: { name: 'ReportDateChip', render: () => null } }));

const design = { value: 't1', label: 'Design', color: '', members: ['ann', 'bob'] };
const web = { value: 't2', label: 'Web', color: '', members: ['bob', 'cat'] };
const people = ['ann', 'bob', 'cat', 'dan'].map((value) => ({ value, label: value.toUpperCase() }));

describe('a group picks its members', () => {
    it('reads as picked, partly picked or not picked', () => {
        expect(groupState(design, ['ann', 'bob', 'dan'])).toBe('all');
        expect(groupState(design, ['bob'])).toBe('some');
        expect(groupState(design, ['dan'])).toBe('none');
    });

    it('adds all members when not fully picked, keeping who else is picked', () => {
        expect(toggleGroup(design, ['dan', 'bob'], [design, web])).toEqual(['dan', 'bob', 'ann']);
    });

    it('takes its members out, but keeps those another fully picked group holds', () => {
        expect(toggleGroup(design, ['ann', 'bob', 'dan'], [design, web])).toEqual(['dan']);
        expect(toggleGroup(design, ['ann', 'bob', 'cat'], [design, web])).toEqual(['bob', 'cat']);
    });

    it('names the group when the picked people are exactly its members', () => {
        expect(groupMatching([design, web], ['bob', 'ann'])).toBe(design);
        expect(groupMatching([design, web], ['ann', 'bob', 'cat'])).toBeNull();
        expect(groupMatching([{ ...design, members: ['ann'] }], ['ann'])).toBeNull();
    });
});

const mountChip = (props = {}) => mount(EverythingFilterChip, {
    props: { name: 'people', label: 'People', options: people, groups: [design, web], groupsLabel: 'Teams', optionsLabel: 'People', bulk: true, ...props },
});
const openChip = async (wrapper) => { await wrapper.find('[data-test="evr-filter-people"]').trigger('click'); };

describe('the People chip with teams', () => {
    it('lists the teams above the people, each with its member count and state', async () => {
        const wrapper = mountChip({ modelValue: ['bob'] });
        await openChip(wrapper);
        const rows = wrapper.findAll('[data-test="evr-group"]');
        expect(rows.map((row) => row.text())).toEqual(['Design2', 'Web2']);
        expect(rows.map((row) => row.attributes('data-state'))).toEqual(['some', 'some']);
        expect(rows[0].attributes('aria-label')).toContain('Everything.some_picked');
        const html = wrapper.html();
        expect(html.indexOf('evr-group')).toBeLessThan(html.indexOf('evr-option'));
    });

    it('picks a team\'s members on click and takes them out again', async () => {
        const wrapper = mountChip({ modelValue: ['dan'] });
        await openChip(wrapper);
        await wrapper.findAll('[data-test="evr-group"]')[0].trigger('click');
        expect(wrapper.emitted('update:modelValue').at(-1)[0]).toEqual(['dan', 'ann', 'bob']);
        await wrapper.setProps({ modelValue: ['dan', 'ann', 'bob'] });
        expect(wrapper.findAll('[data-test="evr-group"]')[0].attributes('aria-selected')).toBe('true');
        await wrapper.findAll('[data-test="evr-group"]')[0].trigger('click');
        expect(wrapper.emitted('update:modelValue').at(-1)[0]).toEqual(['dan']);
    });

    it('shows the team name on the chip when exactly that team is picked', () => {
        expect(mountChip({ modelValue: ['ann', 'bob'] }).find('.evr__chip-n').text()).toBe('Design');
        expect(mountChip({ modelValue: ['ann', 'bob', 'dan'] }).find('.evr__chip-n').text()).toBe('3');
    });

    it('finds teams and people with the same search', async () => {
        const wrapper = mountChip({ options: [...people, ...'efghij'.split('').map((value) => ({ value, label: value }))] });
        await openChip(wrapper);
        await wrapper.find('input[type="search"]').setValue('des');
        expect(wrapper.findAll('[data-test="evr-group"]').map((row) => row.text())).toEqual(['Design2']);
        expect(wrapper.findAll('[data-test="evr-option"]')).toHaveLength(0);
        expect(wrapper.find('.evr__pop-empty').exists()).toBe(false);
    });

    it('shows no Teams section without teams', async () => {
        const wrapper = mountChip({ groups: [] });
        await openChip(wrapper);
        expect(wrapper.find('[data-test="evr-groups"]').exists()).toBe(false);
        expect(wrapper.find('.ah-pop__label').exists()).toBe(false);
    });
});

describe('the report filter bar', () => {
    const store = createStore({
        modules: {
            settings: {
                namespaced: true,
                getters: { teams: () => [{ _id: 't1', name: 'Design', assigneeUsersArray: ['ann', 'bob', 'gone'] }] },
            },
        },
    });
    const mountBar = (props = {}) => mount(ReportFilterBar, {
        props: { filters: { people: [], projects: [] }, presets: ['this_week'], fields: ['people', 'projects'], options: { people, projects: [] }, ...props },
        global: { plugins: [store] },
    });

    it('gives the People filter the company\'s teams, kept to the people listed', () => {
        const chips = mountBar().findAllComponents(EverythingFilterChip);
        expect(chips[0].props('groups')).toEqual([expect.objectContaining({ value: 't1', label: 'Design', members: ['ann', 'bob'] })]);
        expect(chips[1].props('groups')).toEqual([]);
    });

    it('offers no teams where the filter holds one person', () => {
        expect(mountBar({ singlePerson: true }).findAllComponents(EverythingFilterChip)[0].props('groups')).toEqual([]);
    });
});
