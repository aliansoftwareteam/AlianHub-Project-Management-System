const MARK = 'seed-scale';
const COMPANY_NAME = 'Scale Test';
const EMAIL_DOMAIN = 'scale-seed.test';
const PROJECT = { name: 'Scale Project', code: 'SCL' };

const BENCHMARK_SIZES = [10000, 50000];
// One task every ten minutes from a year before the anchor; more would be created in the future.
const MAX_TASKS = 50000;
const STATUS_COUNT = 6;
const LIST_COUNT = 20;
const MEMBER_COUNT = 30;

const SHARES = { customFields: 0.6, subtasks: 0.1, comments: 0.2, dueDate: 0.85, startDate: 0.5, estimate: 0.5, points: 0.4, description: 0.3 };

const DAY_MS = 24 * 60 * 60 * 1000;
const CREATED_SPAN_DAYS = 365;
const CREATED_STEP_MS = 10 * 60 * 1000;
const DUE_WINDOW_DAYS = { before: 180, after: 185 };

const PRIORITIES = [['HIGH', 0.2], ['MEDIUM', 0.5], ['LOW', 0.3]];
const STATUS_WEIGHTS = { default_active: 0.25, active: 0.15, done: 0.1, close: 0.2 };
const ASSIGNEE_COUNTS = [[0, 0.1], [1, 0.6], [2, 0.22], [3, 0.08]];
const TAG_COUNTS = [[0, 0.45], [1, 0.35], [2, 0.15], [3, 0.05]];
const SUBTASK_COUNTS = [[1, 0.4], [2, 0.3], [3, 0.2], [4, 0.1]];
const COMMENT_COUNTS = [[1, 0.4], [2, 0.25], [3, 0.2], [4, 0.1], [5, 0.05]];
const ESTIMATE_MINUTES = [30, 60, 120, 240, 480, 960];
const POINTS = [1, 2, 3, 5, 8, 13];

// The app gives a new task the lowest index of its status minus this step (Modules/Tasks/helpers/taskMongo/internals.js updateTaskIndex).
const GROUP_INDEX_STEP = 65536;

const TAGS = [
    ['frontend', '#6473e8'], ['backend', '#24c110'], ['bug', '#ec4141'], ['design', '#9759c0'],
    ['infra', '#ff9600'], ['customer', '#03a2fd'], ['tech-debt', '#7c3aed'], ['security', '#c0392b'],
    ['performance', '#0ea5a4'], ['docs', '#528ccb'], ['mobile', '#fcb410'], ['release', '#34495e'],
].map(([tagName, tagColor], n) => ({ uid: `scaletag${String(n + 1).padStart(4, '0')}`, tagName, tagColor, tagBgColor: `${tagColor}35` }));

const DROPDOWN_OPTIONS = [['Web', '#6473e8'], ['API', '#24c110'], ['Mobile', '#ff9600'], ['Data', '#9759c0'], ['Platform', '#34495e']]
    .map(([label, color], n) => ({ id: `scl${n + 1}x`, color, value: label.toLowerCase(), label, selected: false }));

const FIELDS = [
    { fieldType: 'dropdown', fieldTitle: 'Area', fieldOptions: DROPDOWN_OPTIONS },
    { fieldType: 'number', fieldTitle: 'Customer impact' },
    { fieldType: 'date', fieldTitle: 'Target release' },
    { fieldType: 'text', fieldTitle: 'Reference' },
    { fieldType: 'checkbox', fieldTitle: 'Needs QA' },
];

const FIRST_NAMES = ['Aarav', 'Bina', 'Chirag', 'Divya', 'Eshan', 'Farah', 'Gaurav', 'Hina', 'Ishan', 'Jaya', 'Karan', 'Lata', 'Manav', 'Nisha', 'Omkar', 'Pooja', 'Rohan', 'Sneha', 'Tarun', 'Uma', 'Varun', 'Yamini', 'Zubin', 'Asha', 'Bhavin', 'Charu', 'Dhruv', 'Ekta', 'Firoz', 'Geeta'];
const LAST_NAMES = ['Patel', 'Sharma', 'Verma', 'Nair', 'Reddy', 'Gupta', 'Joshi', 'Kapoor', 'Menon', 'Bose'];

const PEOPLE = [
    { key: 'owner', firstName: 'Scale', lastName: 'Owner', email: `owner@${EMAIL_DOMAIN}` },
    ...FIRST_NAMES.slice(0, MEMBER_COUNT).map((firstName, n) => ({
        key: `member${n + 1}`,
        firstName,
        lastName: LAST_NAMES[n % LAST_NAMES.length],
        email: `member${String(n + 1).padStart(2, '0')}@${EMAIL_DOMAIN}`,
    })),
];

// The optional second shape: many small projects beside the big one, so a read across projects names hundreds of them.
const SMALL_PROJECTS = { max: 500, tasks: 10, list: 'List' };
const smallProject = (n) => ({ name: `Scale Small ${String(n).padStart(3, '0')}`, code: `SS${String(n).padStart(3, '0')}` });

const listName = (n) => (n === 0 ? 'List' : `Sprint ${String(n).padStart(2, '0')}`);

module.exports = {
    MARK, COMPANY_NAME, EMAIL_DOMAIN, PROJECT, BENCHMARK_SIZES, MAX_TASKS, STATUS_COUNT, LIST_COUNT, MEMBER_COUNT, SHARES,
    DAY_MS, CREATED_SPAN_DAYS, CREATED_STEP_MS, DUE_WINDOW_DAYS, PRIORITIES, STATUS_WEIGHTS, ASSIGNEE_COUNTS, TAG_COUNTS,
    SUBTASK_COUNTS, COMMENT_COUNTS, ESTIMATE_MINUTES, POINTS, GROUP_INDEX_STEP, TAGS, FIELDS, PEOPLE, listName, SMALL_PROJECTS, smallProject,
};
