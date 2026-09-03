const mongoose = require("mongoose");
const logger = require("../../Config/loggerConfig");
const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const { removeCache } = require("../../utils/commonFunctions");
const socketEmitter = require("../../event/socketEventEmitter");
const { createProject } = require("../createProject/controller");

const PERSONAL_NAME = "Personal";
const PERSONAL_CODE = "ME";
const SPRINT_RETRIES = 5;
const SPRINT_RETRY_MS = 300;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const findPersonalProject = (companyId, uid) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.PROJECTS,
    data: [{ isPersonal: true, personalOwner: uid, deletedStatusKey: { $nin: [1] } }]
}, "findOne");

const findListSprint = async (companyId, projectId) => {
    for (let attempt = 0; attempt < SPRINT_RETRIES; attempt += 1) {
        const sprints = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.SPRINTS,
            data: [{ projectId: new mongoose.Types.ObjectId(projectId), deletedStatusKey: 0 }]
        }, "find").catch(() => []);
        if (sprints && sprints.length) return sprints[0];
        await wait(SPRINT_RETRY_MS);
    }
    return null;
};

const personalProjectBody = (companyId, uid) => ({
    _id: new mongoose.Types.ObjectId(),
    CompanyId: companyId,
    ProjectName: PERSONAL_NAME,
    ProjectCode: PERSONAL_CODE,
    projectIcon: { type: "color", data: "#2F3990" },
    source: "other",
    proposalId: "",
    skills: [],
    customFiedlsValue: [],
    AssigneeUserId: [uid],
    LeadUserId: [uid],
    projectCreatedBy: uid,
    ProjectType: "Fix",
    ProjectCurrency: {},
    markAsStar: false,
    sprintsfolders: {},
    sprintsObj: {},
    statusType: "active",
    lastTaskId: 0,
    DueDate: "",
    isPrivateSpace: true,
    isPersonal: true,
    personalOwner: uid,
    isTemplate: false,
    useTemplateProj: "category"
});

exports.getOrCreatePersonalProject = async (req, res) => {
    try {
        const companyId = req.headers["companyid"];
        const uid = String(req.uid || "");
        if (!companyId || !uid) {
            return res.send({ status: false, message: "companyId and user are required" });
        }

        let project = await findPersonalProject(companyId, uid);
        let created = false;
        if (!project || !Object.keys(project).length) {
            const result = await createProject({ body: personalProjectBody(companyId, uid) });
            project = result && result.data;
            created = true;
            removeCache("UserProjectData:", true);
            socketEmitter.emit("insert", { type: "insert", data: project, module: "project" });
        }

        const sprint = await findListSprint(companyId, String(project._id));
        return res.send({
            status: true,
            statusText: created ? "Personal list created" : "Personal list found",
            data: { project, sprint }
        });
    } catch (error) {
        const message = (error && (error.statusText || error.message)) || String(error);
        logger.error(`getOrCreatePersonalProject: ${message}`);
        return res.status(400).send({ status: false, message });
    }
};
