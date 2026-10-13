import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '../../src');
const read = (file) => readFileSync(path.join(SRC, file), 'utf8');

/* "forbidden" reads "visible to its members only, ask its owner to add you", which fits a project;
 * a settings screen is closed by role, which is what "denied" says. */
describe('settings screens a role cannot open', () => {
    it.each([
        'views/Settings/Members/Members.vue',
        'views/Settings/Projects/Projects.vue',
        'views/Settings/Setting/Setting.vue',
    ])('%s explains the role, not project membership', (file) => {
        const source = read(file);
        expect(source).toMatch(/<AppState[^>]*kind="denied"/);
        expect(source).not.toMatch(/<AppState[^>]*kind="forbidden"/);
    });
});
