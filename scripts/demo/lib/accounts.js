const fs = require('fs');

const FILE_MODE = 0o600;

const normaliseEmail = (email) => String(email || '').trim().toLowerCase();

const readAccounts = (filePath) => {
    if (!fs.existsSync(filePath)) return { version: 1, companies: {} };
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) || {};
    return { version: 1, ...parsed, companies: parsed.companies || {} };
};

const writeAccounts = (filePath, accounts) => {
    // writeFileSync applies `mode` only when it creates the file, so an existing one is tightened first.
    if (fs.existsSync(filePath)) fs.chmodSync(filePath, FILE_MODE);
    fs.writeFileSync(filePath, `${JSON.stringify(accounts, null, 2)}\n`, { mode: FILE_MODE });
};

const removeAccountsFile = (filePath) => {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
};

const companyEntry = (accounts, companyId) => {
    const entry = accounts.companies[companyId] || {};
    entry.accounts = entry.accounts || [];
    entry.records = entry.records || {};
    accounts.companies[companyId] = entry;
    return entry;
};

const accountFor = (entry, email) => entry.accounts.find((account) => account.email === normaliseEmail(email)) || null;

const upsertAccount = (entry, account) => {
    const existing = accountFor(entry, account.email);
    if (existing) Object.assign(existing, account, { email: existing.email });
    else entry.accounts.push({ ...account, email: normaliseEmail(account.email) });
};

const track = (entry, key, ids) => {
    const known = new Set((entry.records[key] || []).map(String));
    [].concat(ids).filter(Boolean).forEach((id) => known.add(String(id)));
    entry.records[key] = [...known];
};

const findDemoAccount = (accounts, email) => {
    const wanted = normaliseEmail(email);
    for (const companyId of Object.keys(accounts.companies)) {
        const entry = companyEntry(accounts, companyId);
        const account = accountFor(entry, wanted);
        if (account) return { companyId, entry, account };
    }
    return null;
};

module.exports = { readAccounts, writeAccounts, removeAccountsFile, companyEntry, accountFor, upsertAccount, track, findDemoAccount, normaliseEmail };
