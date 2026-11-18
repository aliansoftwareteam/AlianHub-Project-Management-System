const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { assertLocalTarget } = require('../../demo/lib/guard');
const { SESSION_SECONDS } = require('../../demo/lib/team');
const { isScaleUser, findScaleCompany, openScaleCompany, globalFind } = require('./guard');
const { PEOPLE, PROJECT } = require('./shape');

/* A one-hour session for the seed company's owner, minted the way a password login mints one. */
async function issueScaleSession({ adapter = require('./adapter') } = {}) {
    assertLocalTarget(process.env);
    const company = await findScaleCompany();
    if (!company) throw new Error('There is no scale seed company. Run the seed first.');
    const db = await openScaleCompany(company._id);

    const [owner] = await globalFind(SCHEMA_TYPE.USERS, { Employee_Email: PEOPLE[0].email });
    if (!isScaleUser(owner) || !(owner.AssignCompany || []).map(String).includes(db.companyId)) {
        throw new Error('The scale seed owner is missing or is not a member of the scale seed company.');
    }

    const project = await db.findOne(SCHEMA_TYPE.PROJECTS, { ProjectCode: PROJECT.code });
    const lists = project ? await db.find(SCHEMA_TYPE.SPRINTS, { projectId: project._id, deletedStatusKey: 0 }) : [];
    const { accessToken } = await adapter.issueSession(String(owner._id));
    return {
        accessToken,
        expiresInSeconds: SESSION_SECONDS,
        companyId: db.companyId,
        userId: String(owner._id),
        project: project ? JSON.parse(JSON.stringify(project)) : null,
        lists: JSON.parse(JSON.stringify(lists)),
    };
}

module.exports = { issueScaleSession };
