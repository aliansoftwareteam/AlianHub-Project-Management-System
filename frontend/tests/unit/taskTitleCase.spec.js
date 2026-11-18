import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const css = readFileSync(path.resolve(__dirname, '../../src/components/molecules/TaskDetailTitle/style.css'), 'utf8');
const block = (selector) => {
    const start = css.indexOf(`${selector} {`);
    return start === -1 ? '' : css.slice(start, css.indexOf('}', start));
};

describe('the task title in the detail panel', () => {
    it('keeps the case the title was written in, as the List shows it', () => {
        const title = block('.task-name .title-name');
        expect(title).not.toBe('');
        expect(title).not.toMatch(/text-transform/);
    });
});
