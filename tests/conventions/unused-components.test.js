const path = require('path');
const { findUnusedComponents } = require('../../scripts/unused-components');
const baseline = require('./unused-components.baseline.json');

const SRC = path.join(__dirname, '..', '..', 'frontend', 'src');

describe('frontend components', () => {
    const unused = findUnusedComponents(SRC);

    it('never add a new unreferenced .vue file (node scripts/unused-components.js)', () => {
        expect(unused.filter((f) => !baseline.includes(f))).toEqual([]);
    });

    it('drop deleted files from the baseline so the count only falls', () => {
        expect(baseline.filter((f) => !unused.includes(f))).toEqual([]);
    });
});
