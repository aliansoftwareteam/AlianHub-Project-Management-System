import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '../../src');

describe('project detail and custom field changes leave their history text to the server', () => {
    it.each([
        'components/organisms/ProjectDetailRightSide/ProjectDetailRightSide.vue',
        'components/molecules/TaskDetailTab/TaskDetailTab.vue',
    ])('%s posts no history or notification text', (file) => {
        const source = fs.readFileSync(path.join(SRC, file), 'utf8');
        expect(source).not.toMatch(/HANDLE_HISTORY|HANDLE_NOTIFICATION/);
    });
});
