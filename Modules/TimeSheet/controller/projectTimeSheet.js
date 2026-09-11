const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const { resolveSheetScope, scopedTimeMatch, asList, SHEET_PERMISSION } = require("../helpers/timeScope");

exports.getProjectTimeSheet = async(req,res) => {
    try {
        const { filterProjectIds, filterUserIds, projectIds, startNumber, endNumber, timeZone } = req.body;
        const scope = await resolveSheetScope(req.headers['companyid'], req.uid, SHEET_PERMISSION.project);
        const timeQuery = {
            ...scopedTimeMatch(scope, {
                userIds: asList(filterUserIds).length ? filterUserIds : null,
                projectIds: scope.companyWide && !asList(filterProjectIds).length ? null : asList(projectIds),
            }),
            LogStartTime: {
                $gte: startNumber/1000,
                $lte: endNumber/1000
            }
        };
        const query = [
            {
                $match: timeQuery
            },
            {
                $addFields: {
                    convertedToDate: {
                        $dateToString: {
                            date: {
                                $dateFromString: {
                                    dateString: {
                                        $toString: {
                                            $toDate: {
                                                $multiply: ["$LogStartTime", 1000]
                                            }
                                        }
                                    }
                                }
                            },
                            format: "%Y-%m-%dT00:00:00.000Z",
                            timezone: timeZone
                        }
                    }
                }
            },
            {
                $group: {
                    _id: {
                        date: "$convertedToDate",
                        projectId: "$ProjectId",
                        logType: "$logAddType"
                    },
                    data: {
                        $push: {
                            projectId: "$ProjectId",
                            taskId: "$TicketID",
                            logMinutes: "$LogTimeDuration",
                            userId: "$Loggeduser",
                            logType: "$logAddType",
                            date: "$convertedToDate",
                        }
                    },
                    user: {
                        $first: "$Loggeduser"
                    },
                    totalCount: {
                        $sum: "$LogTimeDuration"
                    }
                }
            }
        ];

        const timesheetObj = {
            type: SCHEMA_TYPE.TIMESHEET,
            data: [query]
        };
        const timesheetData = await MongoDbCrudOpration(req.headers['companyid'], timesheetObj, 'aggregate');

        if (!timesheetData) {
            return res.status(404).json({ message: "TimeSheet Data not found" });
        }

        res.status(200).json(timesheetData);
    } catch (error) {
        res.status(500).json({ message: "An error occurred while fetching the Project TimeSheet Data.", error: error.message });
    }
}