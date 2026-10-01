const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { dbCollections } = require('../../../Config/collections');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { MARK, COMPANY_NAME, EMAIL_DOMAIN } = require('./shape');

const GLOBAL = dbCollections.GLOBAL;
const OBJECT_ID = /^[0-9a-f]{24}$/i;

const isScaleCompany = (company) => Boolean(company) && Boolean(company.scaleSeed) && company.scaleSeed.by === MARK;
const isScaleUser = (user) => Boolean(user) && user.scaleSeed === MARK && String(user.Employee_Email || '').toLowerCase().endsWith(`@${EMAIL_DOMAIN}`);

const globalFind = async (type, filter, fields) => (await MongoDbCrudOpration(GLOBAL, { type, data: fields ? [filter, fields] : [filter] }, 'find')) || [];

async function findScaleCompany() {
    const marked = await globalFind(SCHEMA_TYPE.COMPANIES, { 'scaleSeed.by': MARK });
    if (marked.length > 1) throw new Error(`Found ${marked.length} companies marked by the scale seed; expected at most one.`);
    if (marked.length) return marked[0];
    const sameName = await globalFind(SCHEMA_TYPE.COMPANIES, { Cst_CompanyName: COMPANY_NAME }, { _id: 1 });
    if (sameName.length) throw new Error(`A company named "${COMPANY_NAME}" exists that the scale seed did not create. It was left untouched.`);
    return null;
}

/* The only handle the seed writes a company through. It reads the company's mark first, so a company the seed did not
 * create cannot be reached by a wrong id. */
async function openScaleCompany(companyId) {
    const id = String(companyId || '');
    if (!OBJECT_ID.test(id)) throw new Error('The scale seed needs the id of the company it created.');
    const [company] = await globalFind(SCHEMA_TYPE.COMPANIES, { _id: id });
    const refuse = () => { throw new Error(`Refusing to write: company ${id} was not created by the scale seed.`); };
    if (!isScaleCompany(company) || company.Cst_CompanyName !== COMPANY_NAME) refuse();
    // A second mark: the owner is a seeded account. It may already be gone when a drop is being repeated.
    const [owner] = company.userId ? await globalFind(SCHEMA_TYPE.USERS, { _id: String(company.userId) }) : [];
    if (owner && !isScaleUser(owner)) refuse();

    const run = (method) => (type, ...data) => MongoDbCrudOpration(id, { type, data }, method);
    return {
        companyId: id,
        company,
        find: async (type, ...data) => (await run('find')(type, ...data)) || [],
        findOne: run('findOne'),
        aggregate: async (type, pipeline) => (await run('aggregate')(type, pipeline)) || [],
        insertMany: (type, docs) => MongoDbCrudOpration(id, { type, data: [docs, { ordered: false }] }, 'insertMany'),
        updateOne: run('updateOne'),
    };
}

module.exports = { GLOBAL, isScaleCompany, isScaleUser, findScaleCompany, openScaleCompany, globalFind };
