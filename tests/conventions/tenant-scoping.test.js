const path = require('path');
const { countTenantReads, countTenantReadsIn } = require('./tenant-reads');
const baseline = require('./tenant-scoping.baseline.json');

const MODULES = path.join(__dirname, '..', '..', 'Modules');
const total = (counts) => Object.values(counts).reduce((sum, n) => sum + n, 0);

describe('tenant ids come from the companyid header, not the request body or query', () => {
    const current = countTenantReads(MODULES);

    it('never appear in a module that had none (use tenantOf(req))', () => {
        expect(Object.keys(current).filter((file) => !(file in baseline))).toEqual([]);
    });

    it('never grow in a module that still has some', () => {
        const grown = Object.entries(current).filter(([file, n]) => n > (baseline[file] || 0)).map(([file, n]) => `${file}: ${baseline[file]} -> ${n}`);
        expect(grown).toEqual([]);
    });

    it('keep the baseline honest: lower it when a module is cleaned up', () => {
        const stale = Object.entries(baseline).filter(([file, n]) => (current[file] || 0) < n).map(([file, n]) => `${file}: ${n} -> ${current[file] || 0}`);
        expect(stale).toEqual([]);
        expect(total(current)).toBeLessThanOrEqual(total(baseline));
    });
});

describe('a read that is correct by design carries its reason on the same line', () => {
    it('is not counted when the line says why', () => {
        expect(countTenantReadsIn('const id = req.query.companyId; // tenant-scoping: pre-session, bound by the signed IdP response')).toBe(0);
    });

    it('is still counted when the note gives no reason', () => {
        expect(countTenantReadsIn('const id = req.query.companyId; // tenant-scoping:')).toBe(1);
        expect(countTenantReadsIn('const id = req.query.companyId; // tenant-scoping: ok')).toBe(1);
    });

    it('covers only its own line', () => {
        expect(countTenantReadsIn([
            '// tenant-scoping: pre-session, bound by the signed IdP response',
            'const id = req.body.companyId;',
        ].join('\n'))).toBe(1);
    });

    it('still counts every unannotated read', () => {
        expect(countTenantReadsIn('f(req.body.companyId, req.query.CompanyId);\ng(req.body.CompanyId);')).toBe(3);
    });
});
