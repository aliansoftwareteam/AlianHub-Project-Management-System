import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import AiResultPreview from '@/components/molecules/AiPreview/AiResultPreview.vue';

function mountWithTrigger(props = {}) {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const wrapper = mount(AiResultPreview, { props: { text: 'Drafted text', ...props }, attachTo: host });
    return { wrapper, trigger };
}

afterEach(() => { document.body.innerHTML = ''; });

describe('AiResultPreview', () => {
    it('shows the result and the actions asked for, with Replace, Try again and Cancel by default', () => {
        const { wrapper } = mountWithTrigger();
        expect(wrapper.text()).toContain('Drafted text');
        const labels = wrapper.findAll('button').map((b) => b.text());
        expect(labels).toEqual(['AiPreview.replace', 'AiPreview.retry', 'AiPreview.cancel']);
    });

    it('adds Insert and Copy when asked and can drop Replace', () => {
        const { wrapper } = mountWithTrigger({ showInsert: true, showCopy: true });
        expect(wrapper.findAll('button').map((b) => b.text())).toEqual(['AiPreview.replace', 'AiPreview.insert', 'AiPreview.copy', 'AiPreview.retry', 'AiPreview.cancel']);
        const answer = mountWithTrigger({ showReplace: false, showCopy: true }).wrapper;
        expect(answer.findAll('button').map((b) => b.text())).toEqual(['AiPreview.copy', 'AiPreview.retry', 'AiPreview.cancel']);
    });

    it('names the primary action from its label prop', () => {
        const { wrapper } = mountWithTrigger({ replaceLabel: 'Apply' });
        expect(wrapper.findAll('button')[0].text()).toBe('Apply');
    });

    it('emits each action', async () => {
        const { wrapper } = mountWithTrigger({ showInsert: true });
        for (const [cls, event] of [['.aip__replace', 'replace'], ['.aip__insert', 'insert'], ['.aip__retry', 'retry'], ['.aip__cancel', 'cancel']]) {
            await wrapper.get(cls).trigger('click');
            expect(wrapper.emitted(event)).toHaveLength(1);
        }
    });

    it('cancels on Escape', async () => {
        const { wrapper } = mountWithTrigger();
        await wrapper.get('.aip').trigger('keydown', { key: 'Escape' });
        expect(wrapper.emitted('cancel')).toHaveLength(1);
    });

    it('takes focus when it opens and gives it back to the trigger when it closes', async () => {
        const { wrapper, trigger } = mountWithTrigger();
        await flushPromises();
        expect(wrapper.element.contains(document.activeElement)).toBe(true);
        wrapper.unmount();
        expect(document.activeElement).toBe(trigger);
    });

    it('keeps actions but Cancel disabled while a new result is on its way', () => {
        const { wrapper } = mountWithTrigger({ busy: true, showInsert: true });
        expect(wrapper.get('.aip__replace').element.disabled).toBe(true);
        expect(wrapper.get('.aip__insert').element.disabled).toBe(true);
        expect(wrapper.get('.aip__retry').element.disabled).toBe(true);
        expect(wrapper.get('.aip__cancel').element.disabled).toBe(false);
        expect(wrapper.get('.aip').attributes('aria-busy')).toBe('true');
    });

    it('copies the text to the clipboard', async () => {
        const writeText = vi.fn(() => Promise.resolve());
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        const { wrapper } = mountWithTrigger({ showCopy: true, text: 'The answer' });
        await wrapper.get('.aip__copy').trigger('click');
        await flushPromises();
        expect(writeText).toHaveBeenCalledWith('The answer');
        expect(wrapper.get('.aip__copy').text()).toBe('AiPreview.copied');
    });
});
