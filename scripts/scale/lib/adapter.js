const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { dbCollections } = require('../../../Config/collections');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { MARK } = require('./shape');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const OBJECT_ID = /^[0-9a-f]{24}$/i;

async function createUser({ person, companyId }) {
    const { addUserMongodbV2 } = require('../../../Modules/Auth/controller/createUser');
    const created = await addUserMongodbV2({
        firstName: person.firstName,
        lastName: person.lastName,
        email: person.email,
        // Nobody signs in with it: the account is reached through --token.
        password: crypto.randomBytes(24).toString('base64url'),
        assignCompany: companyId,
        isInvitation: true,
    });
    const userId = String(created.statusText._id);
    await MongoDbCrudOpration(dbCollections.GLOBAL, {
        type: SCHEMA_TYPE.USERS,
        data: [{ _id: userId }, { $set: { scaleSeed: MARK } }],
    }, 'updateOne');
    return userId;
}

async function createCompany({ ownerId, email, name, mark }) {
    const { createFirstCompany } = require('../../../Modules/Setup/createCompany');
    return createFirstCompany({ userId: ownerId, email, companyName: name, sampleData: false, companyFields: { scaleSeed: mark } });
}

async function addMember({ companyId, userId, email, roleType }) {
    const { updateMemberFunction } = require('../../../Modules/settings/Members/controller');
    const { addAndRemoveUserInMongodbNotificationCount } = require('../../../Modules/Auth/controller');
    const { ensureNotificationDefaults } = require('../../../Modules/notification/defaults');

    await updateMemberFunction(companyId, {
        companyId, userId, isDelete: false, roleType, status: 2, userEmail: email, designation: 0, linkId: '', sendInvitationTime: Date.now(),
    }, 'save');
    await addAndRemoveUserInMongodbNotificationCount(companyId, userId, 'Add');
    await ensureNotificationDefaults(companyId, userId);
}

const fieldDefinition = (field, catalogue) => {
    const look = catalogue.find((entry) => entry.cfType === field.fieldType) || {};
    return {
        fieldTitle: field.fieldTitle,
        fieldPlaceholder: field.fieldTitle,
        fieldDescription: `${field.fieldTitle} (scale seed)`,
        fieldType: field.fieldType,
        isDelete: true,
        fieldImage: look.cfIcon,
        fieldImageGrey: look.cfIconGrey,
        fieldPrimaryColor: look.cfPrimaryColor,
        fieldBackgroundColor: look.cfBackgroundColor,
        fieldRequired: [],
        fieldMinimum: '',
        fieldMaximum: '',
        fieldHide: [],
        fieldValidation: '',
        fieldEntryLimits: [],
        ...(field.fieldOptions ? { fieldOptions: field.fieldOptions } : {}),
        ...(field.fieldType === 'date' ? {
            fieldSeparator: '-', fieldDateFormate: 'MM-DD-YYYY', fieldLiteMode: ['Lite Mode'], fieldTimeFormate: '24 Hour', fieldPastFuture: ['Past', 'Future'], fieldDaysDisable: [],
        } : {}),
    };
};

/* createProject stores the custom fields a create-project request carries, so the five fields are written by the app. */
async function createProject({ companyId, ownerId, memberIds, project, tags, fields }) {
    const { projectRequestFromTemplates } = require('../../../Modules/Setup/demoProject');
    const { createProject: create } = require('../../../Modules/createProject/controller');
    const { defaultCustomFields } = require('../../../utils/Tempates/customFields');

    const req = await projectRequestFromTemplates(companyId, ownerId, {
        ProjectName: project.name,
        ProjectCode: project.code,
        TemplateName: project.name,
        AssigneeUserId: [ownerId, ...memberIds],
        LeadUserId: [ownerId],
        includeSampleTasks: false,
        tagsArray: tags,
        customFiedlsValue: fields.map((field) => fieldDefinition(field, defaultCustomFields)),
    });
    const created = await create(req);
    return String(created.data._id);
}

async function createList({ companyId, projectId, projectName, name, actor }) {
    const { addSprintFun } = require('../../../Modules/Sprints/controller');
    const added = await addSprintFun({ body: { companyId, projectId, sprintName: name, projectName, userData: actor, folder: { folderId: '', folderName: '' } } });
    if (!added || !added.status) throw new Error(`List "${name}" was not created: ${(added && added.statusText) || 'unknown error'}`);
    return String(added.data._id);
}

async function dropCompany(companyId) {
    if (!OBJECT_ID.test(String(companyId))) throw new Error('A company id is required to drop a company.');
    const { dropCompanyDatabase } = require('../../../utils/mongo-handler/mongoQueries');
    await dropCompanyDatabase(String(companyId));
    fs.rmSync(path.join(ROOT, 'storage', String(companyId)), { recursive: true, force: true });
}

const issueSession = (userId) => require('../../demo/lib/appAdapter').issueSession(userId);

module.exports = { createUser, createCompany, addMember, createProject, createList, dropCompany, issueSession };
