import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import en from '@/locales/en.js';
import { UNDO_MS, undoToast, showUndoToast, runUndo, dismissUndoToast, holdUndoToast, releaseUndoToast } from '@/composable/useUndoToast';
import UndoToast from '@/components/molecules/UndoToast/UndoToast.vue';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
    dismissUndoToast();
    vi.useRealTimers();
    document.body.innerHTML = '';
});

describe('undo toast', () => {
    it('keeps the offer for about six seconds', () => {
        expect(UNDO_MS).toBe(6000);
        showUndoToast({ message: 'Status updated', undo: vi.fn() });
        expect(undoToast.current).toMatchObject({ message: 'Status updated' });
        vi.advanceTimersByTime(UNDO_MS - 1);
        expect(undoToast.current).not.toBeNull();
        vi.advanceTimersByTime(1);
        expect(undoToast.current).toBeNull();
    });

    it('runs the undo once and closes', async () => {
        const undo = vi.fn(() => Promise.resolve());
        showUndoToast({ message: 'Priority updated', undo });
        await runUndo();
        await runUndo();
        expect(undo).toHaveBeenCalledTimes(1);
        expect(undoToast.current).toBeNull();
    });

    it('a newer change replaces the older offer', async () => {
        const first = vi.fn();
        const second = vi.fn();
        showUndoToast({ message: 'one', undo: first });
        showUndoToast({ message: 'two', undo: second });
        await runUndo();
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
    });

    it('waits while the pointer or focus is on it', () => {
        showUndoToast({ message: 'Due date updated', undo: vi.fn() });
        vi.advanceTimersByTime(4000);
        holdUndoToast();
        vi.advanceTimersByTime(20000);
        expect(undoToast.current).not.toBeNull();
        releaseUndoToast();
        vi.advanceTimersByTime(UNDO_MS - 4000 - 1);
        expect(undoToast.current).not.toBeNull();
        vi.advanceTimersByTime(1);
        expect(undoToast.current).toBeNull();
    });
});

describe('UndoToast', () => {
    const mountToast = () => mount(UndoToast, { attachTo: document.body, global: { mocks: { $t: (key) => key.split('.').reduce((acc, part) => acc?.[part], en) || key } } });

    it('shows the message with a named Undo button that reverts the change', async () => {
        const undo = vi.fn();
        const wrapper = mountToast();
        showUndoToast({ message: 'Status updated successfully', undo });
        await flushPromises();
        const region = wrapper.find('[role="status"]');
        expect(region.text()).toContain('Status updated successfully');
        const button = wrapper.find('button.ah-undo-toast__undo');
        expect(button.text()).toBe(en.UndoToast.undo);
        await button.trigger('click');
        await flushPromises();
        expect(undo).toHaveBeenCalledTimes(1);
        wrapper.unmount();
    });

    it('undoes with Ctrl or Cmd+Z outside a text field only', async () => {
        const undo = vi.fn();
        const wrapper = mountToast();
        showUndoToast({ message: 'Assignee added successfully', undo });
        await flushPromises();
        const input = document.createElement('input');
        document.body.appendChild(input);
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
        await flushPromises();
        expect(undo).not.toHaveBeenCalled();
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));
        await flushPromises();
        expect(undo).toHaveBeenCalledTimes(1);
        wrapper.unmount();
    });
});
