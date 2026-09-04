const fs = require('fs');
const path = require('path');

const TENANT_READ = /req\.(?:body|query)\.(?:companyId|CompanyId)\b/g;

function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (entry.name.endsWith('.js')) out.push(full);
    }
    return out;
}

// Per-file count of tenant ids read from the request body or query. The tenant
// belongs in the companyid header (tenantOf), so this number may only fall.
function countTenantReads(modulesDir) {
    const counts = {};
    for (const file of walk(modulesDir).sort()) {
        const n = (fs.readFileSync(file, 'utf8').match(TENANT_READ) || []).length;
        if (n) counts[path.relative(modulesDir, file)] = n;
    }
    return counts;
}

module.exports = { countTenantReads };
