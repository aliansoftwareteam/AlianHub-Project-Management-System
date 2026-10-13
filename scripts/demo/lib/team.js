const PEOPLE = [
    { key: 'rahul', firstName: 'Rahul', lastName: 'Mehta', title: 'Engineering Manager', email: 'rahul.manager@demo.test', role: 'admin', designations: ['Engineering Manager', 'Manager'] },
    { key: 'priya', firstName: 'Priya', lastName: 'Shah', title: 'Frontend Developer', email: 'priya.frontend@demo.test', role: 'member', designations: ['Frontend Developer', 'Software Engineer'] },
    { key: 'arjun', firstName: 'Arjun', lastName: 'Rao', title: 'Backend Developer', email: 'arjun.backend@demo.test', role: 'member', designations: ['Backend Developer', 'Software Engineer'] },
    { key: 'sara', firstName: 'Sara', lastName: 'Khan', title: 'QA Engineer', email: 'sara.qa@demo.test', role: 'member', designations: ['QA Engineer', 'Software Engineer'] },
    { key: 'neha', firstName: 'Neha', lastName: 'Iyer', title: 'UI/UX Designer', email: 'neha.design@demo.test', role: 'member', designations: ['UI/UX Designer', 'Designer'] },
    { key: 'vikram', firstName: 'Vikram', lastName: 'Singh', title: 'DevOps Engineer', email: 'vikram.devops@demo.test', role: 'member', designations: ['DevOps Engineer', 'IT Administrator'] },
    { key: 'anita', firstName: 'Anita', lastName: 'Desai', title: 'Business Analyst', email: 'anita.analyst@demo.test', role: 'member', designations: ['Business Analyst', 'Operations Executive'] },
    { key: 'kabir', firstName: 'Kabir', lastName: 'Joshi', title: 'Intern Developer', email: 'kabir.intern@demo.test', role: 'restricted', designations: ['Intern Developer', 'Software Engineer'] },
];

const PROJECT = {
    name: 'QA Sandbox',
    code: 'QAS',
    lead: 'rahul',
    sprint: { name: 'Sprint 1', goal: 'Fix the login regression and ship the rate-limited public API.', lengthDays: 14 },
};

const TASKS = [
    { name: 'Login fails after a password reset on Safari', status: 'In Progress', priority: 'HIGH', assignees: ['priya', 'sara'], dueInDays: 3, description: 'After resetting a password, Safari users land back on the login screen with no error. Reproduce, fix and add a regression test.' },
    { name: 'Add rate limiting to the public REST API', status: 'In Progress', priority: 'HIGH', assignees: ['arjun'], dueInDays: 7, description: 'Limit each API token to 100 requests per minute and return 429 with a Retry-After header.' },
    { name: 'Design review: new onboarding flow', status: 'In Review', priority: 'MEDIUM', assignees: ['neha', 'anita'], dueInDays: 4, description: 'Walk through the onboarding mockups with product and engineering and collect sign-off.' },
    { name: 'Fix the flaky CI pipeline on the integration test stage', status: 'To Do', priority: 'HIGH', assignees: ['vikram'], dueInDays: 2, description: 'The integration stage times out on roughly one run in five. Pin the database container and add retries to the health check.' },
    { name: 'Write a regression suite for checkout', status: 'To Do', priority: 'MEDIUM', assignees: ['sara'], dueInDays: 9, description: 'Cover guest checkout, saved cards and coupon codes end to end.' },
    { name: 'Refresh token rotation for mobile sessions', status: 'To Do', priority: 'MEDIUM', assignees: ['arjun'], dueInDays: 10, description: 'Rotate refresh tokens on every use and revoke the whole family when an old token is replayed.' },
    { name: 'Accessibility pass on the settings pages', status: 'Backlog', priority: 'LOW', assignees: ['priya', 'neha'], dueInDays: null, description: 'Check contrast, focus order and screen reader labels on every settings page.' },
    { name: 'Document acceptance criteria for invoice export', status: 'Done', priority: 'MEDIUM', assignees: ['anita'], dueInDays: -2, description: 'List the columns, formats and edge cases finance expects from the CSV and PDF exports.' },
    { name: 'Set up nightly staging database backups', status: 'Complete', priority: 'MEDIUM', assignees: ['vikram'], dueInDays: -4, description: 'Nightly dump to object storage with seven days of retention and a restore drill.' },
    { name: 'Fix the typo in the task board empty state', status: 'To Do', priority: 'LOW', assignees: ['kabir'], dueInDays: 5, description: 'The empty state reads "No task yet". It should read "No tasks yet".' },
    { name: 'Add unit tests for the date helpers', status: 'In Progress', priority: 'LOW', assignees: ['kabir', 'arjun'], dueInDays: 6, description: 'Cover time zones, daylight saving changes and invalid input.' },
    { name: 'Sprint demo and retrospective notes', status: 'To Do', priority: 'LOW', assignees: ['rahul'], dueInDays: 13, description: 'Prepare the demo agenda and capture what went well and what to change next sprint.' },
].map((task) => ({ leader: PROJECT.lead, ...task }));

const AGENTS = [
    { name: 'Intake Bot', skill: 'brief.parse', description: 'Turns an incoming brief into structured tasks for the QA Sandbox.' },
    { name: 'QA Reviewer', skill: 'qa-review', description: 'Reviews QA Sandbox tasks against their acceptance criteria.' },
    { name: 'Standup Reporter', skill: 'digest.ceo', description: 'Writes a daily digest of QA Sandbox progress.' },
    { name: 'PR Summarizer', skill: 'pr.summary', description: 'Summarises linked pull requests on QA Sandbox tasks.' },
];

const AGENT_AUTONOMY = 1;
const AGENT_SPEND_CAP_USD = 1;
const SESSION_SECONDS = 3600;

module.exports = { PEOPLE, PROJECT, TASKS, AGENTS, AGENT_AUTONOMY, AGENT_SPEND_CAP_USD, SESSION_SECONDS };
