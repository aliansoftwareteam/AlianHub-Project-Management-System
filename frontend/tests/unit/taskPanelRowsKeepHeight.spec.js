import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const dir = path.resolve(__dirname, '../../src/components/organisms/TaskDetailOverlay');
const overlay = readFileSync(path.join(dir, 'style.css'), 'utf8');
const goals = readFileSync(path.join(dir, 'TaskGoals.vue'), 'utf8');

const rule = (source, selector) => {
    const at = source.indexOf(`${selector} {`);
    if (at === -1) return '';
    const open = source.indexOf('{', at);
    return source.slice(open, source.indexOf('}', open));
};

describe('property rows in the task panel column', () => {
    it('keep their height when the column is taller than the panel and scrolls', () => {
        expect(rule(overlay, '.ah-detail__props')).toMatch(/flex-direction:\s*column/);
        expect(rule(overlay, '.ah-detail__props')).toMatch(/overflow-y:\s*auto/);
        expect(rule(overlay, '.ah-detail__prop')).toMatch(/flex-shrink:\s*0/);
    });
});

describe('the goal chip under "Counts toward"', () => {
    it('counts its padding and border inside the width it is capped to', () => {
        const chip = rule(goals, '.tgl__chip');
        expect(chip).toMatch(/max-width:\s*100%/);
        expect(chip).toMatch(/box-sizing:\s*border-box/);
    });

    it('shortens the names with an ellipsis and keeps the percentage whole', () => {
        const names = rule(goals, '.tgl__goal, .tgl__target');
        expect(names).toMatch(/min-width:\s*0/);
        expect(names).toMatch(/overflow:\s*hidden/);
        expect(names).toMatch(/text-overflow:\s*ellipsis/);
        expect(rule(goals, '.tgl__pct')).toMatch(/flex:\s*none/);
    });
});
