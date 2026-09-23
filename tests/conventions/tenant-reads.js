const fs = require('fs');
const path = require('path');

const TENANT_READ = /req\.(?:body|query)\.(?:companyId|CompanyId)\b/g;
// A pre-session or transport read (IdP callbacks, MCP endpoint URLs, bucket claims checked where
// they are read) is correct by design; it is exempt only while its own line says why.
const EXEMPTION = /\/\/\s*tenant-scoping:\s*\S.{11,}/;

function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (entry.name.endsWith('.js')) out.push(full);
    }
    return out;
}

function countTenantReadsIn(source) {
    return source.split('\n')
        .filter((line) => !EXEMPTION.test(line))
        .reduce((sum, line) => sum + (line.match(TENANT_READ) || []).length, 0);
}

// Per-file count of tenant ids read from the request body or query. The tenant
// belongs in the companyid header (tenantOf), so this number may only fall.
function countTenantReads(modulesDir) {
    const counts = {};
    for (const file of walk(modulesDir).sort()) {
        const n = countTenantReadsIn(fs.readFileSync(file, 'utf8'));
        if (n) counts[path.relative(modulesDir, file)] = n;
    }
    return counts;
}

module.exports = { countTenantReads, countTenantReadsIn };
