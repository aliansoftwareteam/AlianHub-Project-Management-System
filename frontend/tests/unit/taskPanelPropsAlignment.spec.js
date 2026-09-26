import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '../../src/components/organisms');
const sheets = [
    readFileSync(path.join(SRC, 'TaskDetailRightSide/style.css'), 'utf8'),
    readFileSync(path.join(SRC, 'TaskDetailOverlay/style.css'), 'utf8'),
];

let root;
const $ = (selector) => root.querySelector(selector);
const style = (selector) => getComputedStyle($(selector));

beforeAll(() => {
    for (const css of sheets) {
        const tag = document.createElement('style');
        tag.textContent = css;
        document.head.appendChild(tag);
    }
    root = document.createElement('div');
    root.innerHTML = `
        <aside class="ah-detail__props">
            <div class="task-detail-right-side"><div>
                <div class="task-detail-right-side-label"><div class="task-detail-field-name">Priority</div>
                    <div class="priority-comp taskdetail-label"><span class="priority-name">Medium</span></div></div>
                <div class="task-detail-right-side-label"><div class="task-detail-field-name">Due Date</div>
                    <div class="due-date taskdetail-label">Empty</div></div>
                <div class="task-detail-right-side-label"><div class="task-detail-field-name">Estimated</div>
                    <div class="time-display">00h 00m</div></div>
                <div class="task-detail-right-side-label"><div class="task-detail-field-name">Task Planning</div>
                    <div class="taskdetail-label"><span class="task-esitmate-hours">00h 00m</span></div></div>
                <div class="task-detail-right-side-label"><div class="task-detail-field-name">Remaining</div>
                    <div class="remaining-estimate-text">00h 00m</div></div>
            </div></div>
        </aside>`;
    document.body.appendChild(root);
});
afterAll(() => root.remove());

describe('the task panel property rows', () => {
    it('draw no legacy border against the labels', () => {
        expect(parseFloat(style('.task-detail-right-side').borderLeftWidth) || 0).toBe(0);
    });

    it('start every value at the same x: no side padding on priority and dates', () => {
        expect(parseFloat(style('.priority-comp.taskdetail-label').paddingLeft)).toBe(0);
        expect(parseFloat(style('.priority-comp .priority-name').paddingLeft)).toBe(0);
        expect(parseFloat(style('.due-date.taskdetail-label').paddingLeft)).toBe(0);
    });

    it('set every time figure in the same font as remaining hours', () => {
        const remaining = style('.remaining-estimate-text').fontFamily;
        expect(remaining).toMatch(/--font-mono/);
        expect(style('.time-display').fontFamily).toBe(remaining);
        expect(style('.task-esitmate-hours').fontFamily).toBe(remaining);
    });
});
