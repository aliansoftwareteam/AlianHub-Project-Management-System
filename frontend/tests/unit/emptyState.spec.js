import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';

import EmptyState from '@/components/atom/EmptyState/EmptyState.vue';
import EmptyIllustration, { ILLUSTRATIONS } from '@/components/atom/EmptyState/EmptyIllustration.vue';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const source = (name) => fs.readFileSync(path.resolve(HERE, '../../src/components/atom/EmptyState', name), 'utf8');

const store = (helpLink = '') => createStore({
    modules: { brandSettingTab: { namespaced: true, getters: { brandSettings: () => ({ helpLink }) } } }
});

const mountEmpty = (props = {}, options = {}) => mount(EmptyState, {
    props: { title: 'Nothing here', ...props },
    global: { plugins: [store(options.helpLink)] },
    slots: options.slots
});

describe('the empty state', () => {
    it('draws its title as a third-level heading unless told otherwise', () => {
        expect(mountEmpty().find('h3.empty-state__title').text()).toBe('Nothing here');
        const second = mountEmpty({ headingLevel: 2 });
        expect(second.find('h2.empty-state__title').exists()).toBe(true);
        expect(second.find('h3').exists()).toBe(false);
    });

    it('offers its action and says when it is taken', async () => {
        const wrapper = mountEmpty({ actionLabel: 'Create task' });
        const button = wrapper.find('.empty-state__btn');
        expect(button.text()).toBe('Create task');
        await button.trigger('click');
        expect(wrapper.emitted('action')).toHaveLength(1);
    });

    it('hides the action from someone who may not take it', () => {
        const wrapper = mountEmpty({ actionLabel: 'Create task', actionAllowed: false });
        expect(wrapper.find('.empty-state__btn').exists()).toBe(false);
        expect(wrapper.find('.empty-state__actions').exists()).toBe(false);
    });

    it('offers a second, quieter choice', async () => {
        const wrapper = mountEmpty({ actionLabel: 'New doc', secondaryLabel: 'Templates' });
        const link = wrapper.find('.empty-state__link');
        expect(link.text()).toBe('Templates');
        expect(link.element.tagName).toBe('BUTTON');
        await link.trigger('click');
        expect(wrapper.emitted('secondary')).toHaveLength(1);
        expect(wrapper.emitted('action')).toBeUndefined();
    });

    it('keeps the help link for a workspace that has a help site', () => {
        expect(mountEmpty({ helpPath: 'tasks' }).find('.empty-state__help').exists()).toBe(false);
        const linked = mountEmpty({ helpPath: '/tasks' }, { helpLink: 'https://help.example.com/' });
        expect(linked.find('.empty-state__help').attributes('href')).toBe('https://help.example.com/tasks');
    });

    it('takes the help line as a prop or as a slot', () => {
        expect(mountEmpty({ message: 'One line of help' }).find('.empty-state__msg').text()).toBe('One line of help');
        const slotted = mountEmpty({}, { slots: { default: '<button type="button" class="in-help">Open it</button>' } });
        expect(slotted.find('.empty-state__msg .in-help').exists()).toBe(true);
        expect(mountEmpty().find('.empty-state__msg').exists()).toBe(false);
    });

    it('draws an inline illustration that assistive technology skips, never an image file', () => {
        const wrapper = mountEmpty({ illustration: 'tasks', image: '/img/old.svg' });
        const art = wrapper.find('svg');
        expect(art.attributes('aria-hidden')).toBe('true');
        expect(art.attributes('data-illustration')).toBe('tasks');
        expect(wrapper.find('img').exists()).toBe(false);
        expect(wrapper.attributes('image')).toBeUndefined();
    });
});

describe('the illustrations', () => {
    it('cover tasks, docs, chat, time, no results, inbox zero, people and a generic one', () => {
        expect([...ILLUSTRATIONS].sort()).toEqual(['chat', 'docs', 'generic', 'inbox', 'people', 'search', 'tasks', 'time']);
        ILLUSTRATIONS.forEach((name) => {
            const art = mount(EmptyIllustration, { props: { name } });
            expect(art.attributes('data-illustration')).toBe(name);
            expect(art.element.children.length, name).toBeGreaterThan(0);
        });
    });

    it('fall back to the generic one for a name they do not know', () => {
        expect(mount(EmptyIllustration, { props: { name: 'nope' } }).attributes('data-illustration')).toBe('generic');
    });

    it('are coloured only by currentColor and tokens', () => {
        ['EmptyIllustration.vue', 'EmptyState.vue'].forEach((file) => {
            const text = source(file);
            expect(text, file).not.toMatch(/#[0-9a-f]{3,8}\b/i);
            expect(text, file).not.toMatch(/\b(rgba?|hsla?)\(/i);
            expect(text, file).not.toMatch(/<img\b|\.(png|jpe?g|gif|svg)\b/i);
        });
        const art = source('EmptyIllustration.vue');
        expect(art).toMatch(/currentColor/);
        const painted = [...art.matchAll(/\b(?:fill|stroke|color):\s*([^;]+);/g)].map((m) => m[1].trim());
        expect(painted.length).toBeGreaterThan(0);
        painted.forEach((value) => expect(value).toMatch(/^(var\(--[a-z0-9-]+\)|currentColor|none)$/));
    });

    it('fade in with the token timing and stand still for reduced motion', () => {
        const text = source('EmptyState.vue');
        expect(text).toMatch(/animation:\s*empty-state-in var\(--t-panel\) var\(--ease\)/);
        expect(text).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*{\s*\.empty-state\s*{\s*animation:\s*none;/);
    });
});
