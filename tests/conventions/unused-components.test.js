const path = require('path');
const { findUnusedComponents } = require('../../scripts/unused-components');

const SRC = path.join(__dirname, '..', '..', 'frontend', 'src');

describe('frontend components', () => {
    it('are all referenced by another source file (node scripts/unused-components.js)', () => {
        expect(findUnusedComponents(SRC)).toEqual([]);
    });
});
