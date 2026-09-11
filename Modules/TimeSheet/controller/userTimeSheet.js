const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const { resolveSheetScope, scopedTimeMatch, asList, filtersOfType, SHEET_PERMISSION } = require("../helpers/timeScope");

exports.getUserTimeSheet = async(req,res) => {
    try {
        const { selectedFilter, userArray, projectArray, start, end, timeZone } = req.body;
        const scope = await resolveSheetScope(req.headers['companyid'], req.uid, SHEET_PERMISSION.user);
        const peopleFiltered = filtersOfType(selectedFilter, 'Users').length || filtersOfType(selectedFilter, 'Teams').length;
        const timeQuery = {
            ...scopedTimeMatch(scope, {
                userIds: scope.companyWide && !peopleFiltered ? null : asList(userArray),
                projectIds: filtersOfType(selectedFilter, 'Projects').length ? asList(projectArray) : null,
            }),
            LogStartTime: {
                $gte: start,
                $lte: end
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
                        user: "$Loggeduser",
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
        res.status(500).json({ message: "An error occurred while fetching the User TimeSheet Data.", error: error.message });
    }
}