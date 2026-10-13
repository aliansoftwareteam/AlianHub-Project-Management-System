import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { contrastOn, inkOf, worstContrast } from '../wcagContrast';

vi.mock('@/services', () => ({ apiRequest: vi.fn(() => Promise.resolve({ status: 200, data: {} })) }));
vi.mock('@/utils/TaskOperations', () => ({ default: { updateTags: vi.fn(() => Promise.resolve()) } }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ makeUniqueId: () => 'u1', checkPermission: () => true, checkApps: () => true })
}));

import TagChip from '@/components/atom/TagChip/TagChip.vue';
import CreateTagPopup from '@/components/molecules/TagList/CreateTagPopup.vue';

const tagOf = (uid, tagName, colour) => ({ uid, tagName, tagColor: colour, tagBgColor: `${colour}35` });
const navy = tagOf('tag-navy', 'Navy', '#2f3990');
const lemon = tagOf('tag-lemon', 'Lemon', '#ffff00');
const ids = { companyId: 'company-1', projectId: 'p1', sprintId: 's1', taskId: 't1', tagsArray: [navy.uid] };
const OpenDropDown = { name: 'DropDown', template: '<div><slot name="button" /><slot name="head" /><slot name="options" /></div>' };
const stubs = { DropDown: OpenDropDown, ConfirmationSidebar: true, InputText: true, SpinnerComp: true };

const mountChip = (tag, props = {}) => mount(TagChip, {
    props: { data: tag, ids, tagsArray: [navy, lemon], taskId: 't1', sprintId: 's1', ...props },
    global: { stubs }
});

function expectLightInk(chip) {
    const style = chip.element.style;
    expect(inkOf(style), 'the text colour set on the chip').toMatch(/^#[0-9a-f]{6}$/i);
    expect(worstContrast(inkOf(style), style.background, 'light'), chip.get('.tagname').text()).toBeGreaterThanOrEqual(4.5);
}

describe('tag chips painted from a tag colour', () => {
    it.each([navy, lemon])('keeps $tagName readable on its tint in both themes where the chip follows the theme', (tag) => {
        const wrapper = mountChip(tag);
        const chip = wrapper.get('.tagListContent');
        expect(chip.classes()).toContain('ah-status-ink');
        expectLightInk(chip);
        expect(worstContrast(chip.element.style.getPropertyValue('--status-ink-dark'), chip.element.style.background, 'dark')).toBeGreaterThanOrEqual(4.5);
        expect(wrapper.get('.tagname').element.style.color).toBe('');
    });

    it.each([navy, lemon])('keeps the light text for $tagName on a surface that stays white in the dark theme', (tag) => {
        const chip = mountChip(tag, { lightSurface: true }).get('.tagListContent');
        expect(chip.classes()).not.toContain('ah-status-ink');
        expectLightInk(chip);
    });

    it("keeps the tag picker's chips and tag names readable on its white menu", () => {
        const wrapper = mount(CreateTagPopup, {
            props: { task: { _id: 't1', sprintId: 's1', TaskName: 'Tag the release notes', tagsArray: [navy.uid] }, project: { _id: 'p1', isGlobalPermission: true, tagsArray: [navy, lemon] } },
            global: { stubs }
        });
        const chip = wrapper.get('.chipDiv-wrapper .tagListContent');
        expect(chip.get('.tagname').text()).toBe('Navy');
        expect(chip.classes()).not.toContain('ah-status-ink');
        expectLightInk(chip);

        const option = wrapper.get('.taglist-options .tag_name');
        expect(option.text()).toBe('Lemon');
        expect(contrastOn(option.element.style.color, '#ffffff', '#ffffff')).toBeGreaterThanOrEqual(4.5);
    });
});
