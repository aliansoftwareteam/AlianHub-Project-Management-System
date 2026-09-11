const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const { evaluatePermission } = require("../../../Config/permissionGuard");
const { resolveSheetScope, scopedTimeMatch, SHEET_PERMISSION } = require("../helpers/timeScope");

/* The project page shows hourly milestone totals for everyone on the project to anyone
 * whose project_milestone rule is not None; other callers count only their own time. */
const canSeeProjectMilestones = async (companyId, uid, projectId) => {
    const permission = await Promise.resolve()
        .then(() => evaluatePermission(companyId, uid, 'project.project_milestone', { projectId }))
        .catch(() => null);
    return permission !== null && permission !== undefined;
};

exports.getTimeSheetForMilestone = async(req,res) => {
    try {
        const { startDate, endDate, projectId } = req.body || {};
        const companyId = req.headers['companyid'];
        const project = String(projectId || '');
        const scope = await resolveSheetScope(companyId, req.uid, SHEET_PERMISSION.project);
        const everyone = scope.everyone
            || (scope.roleType !== null && scope.visible.includes(project) && await canSeeProjectMilestones(companyId, req.uid, project));

        const query = [
            {
                $match: {
                    ...scopedTimeMatch({ ...scope, everyone }, { projectIds: [project] }),
                    LogStartTime: {
                        $lt: new Date(endDate).getTime() / 1000,
                        $gt: new Date(startDate).getTime() / 1000,
                    },
                },
            },
        ];
        const timesheetData = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TIMESHEET, data: [query] }, 'aggregate');

        if (!timesheetData) {
            return res.status(404).json({ message: "TimeSheet Data not found" });
        }

        res.status(200).json(timesheetData);
    } catch (error) {
        res.status(500).json({ message: "An error occurred while fetching the TimeSheet Data.", error: error.message });
    }
}
