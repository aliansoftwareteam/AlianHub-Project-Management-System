const { localTargetProblem } = require('../../lib/guard');

const MARK = 'demo-industries';
const EMAIL_DOMAIN = 'demo.test';
const OBJECT_ID = /^[0-9a-f]{24}$/i;

const isDemoInstance = (env) => String(env.DEMO_MODE || '').trim().toLowerCase() === 'true';

/* A local database, or an instance that already tells every visitor it is a throwaway public demo. Whatever the
 * target, the command writes only to companies carrying MARK (openShowcase) and deletes only what they own. */
const targetProblem = (env = process.env, argv = []) => {
    if (argv.includes('--force')) return 'there is no --force.';
    if (String(env.NODE_ENV || '').trim().toLowerCase() === 'production' && !isDemoInstance(env)) return 'NODE_ENV is production and DEMO_MODE is not "true".';
    if (!env.MONGODB_URL) return 'MONGODB_URL is not set.';
    if (isDemoInstance(env)) return null;
    const local = localTargetProblem({ ...env, NODE_ENV: '' });
    return local ? `${local} Set DEMO_MODE="true" only on a public demo instance.` : null;
};

const assertTarget = (env = process.env, argv = []) => {
    const problem = targetProblem(env, argv);
    if (problem) throw new Error(`Refusing to run: ${problem}`);
};

const isShowcaseCompany = (company) => Boolean(company && company.demoShowcase && company.demoShowcase.by === MARK);

const isShowcasePerson = (user) => Boolean(user) && user.demoShowcase === MARK
    && String(user.Employee_Email || '').toLowerCase().endsWith(`.${EMAIL_DOMAIN}`);

const emailFor = (domain, person) => `${person.firstName}.${person.lastName}@${domain}.${EMAIL_DOMAIN}`
    .toLowerCase().replace(/[^a-z0-9.@-]/g, '');

module.exports = { MARK, EMAIL_DOMAIN, OBJECT_ID, isDemoInstance, targetProblem, assertTarget, isShowcaseCompany, isShowcasePerson, emailFor };
