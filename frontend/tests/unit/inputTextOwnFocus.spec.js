import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref } from 'vue';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import InputText from '@/components/atom/InputText/InputText.vue';
import InputTextarea from '@/components/atom/InputTextarea/InputTextarea.vue';

const mounted = [];
const put = (component, props = {}) => {
    const wrapper = mount(component, { props, attachTo: document.body, global: { provide: { $clientWidth: ref(1280) } } });
    mounted.push(wrapper);
    return wrapper;
};

afterEach(() => { mounted.splice(0).forEach((wrapper) => wrapper.unmount()); });

describe.each([['InputText', InputText], ['InputTextarea', InputTextarea]])('%s', (name, component) => {
    it('takes the focus itself when another one is already open behind it', () => {
        const listRow = put(component, { isDirectFocus: true });
        expect(document.activeElement).toBe(listRow.element);
        const panelRow = put(component, { isDirectFocus: true });
        expect(document.activeElement).toBe(panelRow.element);
    });

    it('carries no id unless it is given one', () => {
        const [first, second] = [put(component), put(component)];
        expect(first.attributes('id')).toBeUndefined();
        expect(second.attributes('id')).toBeUndefined();
        expect(put(component, { inputId: 'refCompanyName' }).attributes('id')).toBe('refCompanyName');
    });

    it('leaves the focus alone when it is not asked to take it', () => {
        const open = put(component, { isDirectFocus: true });
        put(component);
        expect(document.activeElement).toBe(open.element);
    });
});

describe('the add row', () => {
    it('styles its placeholder without the id every input used to share', () => {
        const source = readFileSync(resolve(__dirname, '../../src/components/atom/CreateTask/CreateTask.vue'), 'utf8');
        expect(source).not.toContain('#inputId');
        expect(source).toContain('.create__task-inputtext::placeholder');
    });
});
