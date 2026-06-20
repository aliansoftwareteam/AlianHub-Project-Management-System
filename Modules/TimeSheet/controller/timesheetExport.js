const mongoose = require("mongoose");
const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const { buildTimesheetCsv } = require("../helpers/timesheetCsv");
const logger = require("../../../Config/loggerConfig");

const toObjId = (id) => {
    try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; }
};

// TIME-04 — export time entries as a payroll CSV. Resolves user names from the
// global DB and project names from the company DB so the file is self-contained
// (User, Project, Date, Description, Billable, Hours). LogStartTime is seconds.
exports.exportTimesheetCsv = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || (req.body && req.body.companyId);
        if (!companyId) return res.status(400).send('companyId is required');
        const { userArray = [], projectArray = [], start, end } = req.body || {};
        const match = {};
        if (Array.isArray(userArray) && userArray.length) match.Loggeduser = { $in: userArray };
        if (Array.isArray(projectArray) && projectArray.length) match.ProjectId = { $in: projectArray };
        if (start && end) match.LogStartTime = { $gte: Number(start), $lte: Number(end) };

        const entries = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TIMESHEET,
            data: [match, null, { sort: { LogStartTime: 1 } }],
        }, 'find') || [];

        // Resolve names.
        const userIds = [...new Set(entries.map((e) => e.Loggeduser).filter(Boolean))];
        const projectIds = [...new Set(entries.map((e) => e.ProjectId).filter(Boolean))];
        const userMap = {};
        const projectMap = {};
        if (userIds.length) {
            const users = await MongoDbCrudOpration('global', {
                type: SCHEMA_TYPE.USERS,
                data: [{ _id: { $in: userIds.map(toObjId).filter(Boolean) } }, { Employee_Name: 1 }],
            }, 'find');
            (users || []).forEach((u) => { userMap[String(u._id)] = u.Employee_Name || ''; });
        }
        if (projectIds.length) {
            const projects = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.PROJECTS,
                data: [{ _id: { $in: projectIds.map(toObjId).filter(Boolean) } }, { ProjectName: 1 }],
            }, 'find');
            (projects || []).forEach((p) => { projectMap[String(p._id)] = p.ProjectName || ''; });
        }

        const csv = buildTimesheetCsv(entries, { userMap, projectMap });
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="timesheet-export.csv"');
        return res.status(200).send(csv);
    } catch (error) {
        logger.error(`ERROR in timesheet CSV export: ${error.message}`);
        return res.status(500).send('Export failed');
    }
};
