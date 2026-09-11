
const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const { isPrivileged } = require('../../../Config/roleTypes');


exports.getProjectTimeSheet = async(req,res) => {
    try {
        const { filterProjectIds,filterUserIds, projectIds, startNumber, endNumber, companyUserDetail,timeZone, projectTimesheetPermission,userId } = req.body;
        let timeQuery = [{
            Loggeduser: userId,
            ProjectId: {
                $in: projectIds
            },
            LogStartTime: {
                $gte: startNumber/1000,
                $lte: endNumber/1000
            }
        }]
        if (projectTimesheetPermission) {
            timeQuery = [{
                ProjectId: {
                    $in: projectIds
                },
                LogStartTime: {
                    $gte: startNumber/1000,
                    $lte: endNumber/1000
                }
            }];
            if (filterProjectIds.length === 0 && isPrivileged(companyUserDetail.roleType)) {
                timeQuery = [{
                    LogStartTime: {
                        $gte: startNumber/1000,
                        $lte: endNumber/1000
                    }
                }];
            }
            if (filterUserIds && filterUserIds.length) {
                timeQuery = [{
                    ProjectId: {
                        $in: projectIds
                    },
                    Loggeduser: {
                        $in: filterUserIds
                    },
                    LogStartTime: {
                        $gte: startNumber/1000,
                        $lte: endNumber/1000
                    }
                }];
                if (filterProjectIds.length === 0 && isPrivileged(companyUserDetail.roleType)) {
                    timeQuery = [{
                        Loggeduser: {
                            $in: filterUserIds
                        },
                        LogStartTime: {
                            $gte: startNumber/1000,
                            $lte: endNumber/1000
                        }
                    }];
                }
            }
        }

        const query = [
            {
                $match: {
                    $and: timeQuery
                }
            },
            {
                $addFields: {
                    convertedToDate: {
                        $dateToString: {
                            date: {
                                // GET UNIX DATE FROM THE SECONDS
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
                            format: "%Y-%m-%dT00:00:00.000Z", // Adjusted format (removed %z for UTC)
                            timezone: timeZone // Timezone for conversion
                        }
                    }
                }
            },
            {
                $group: {
                    _id: {
                        date: "$convertedToDate",
                        // user: "$Loggeduser",
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
                        $first: "$Loggeduser" // Getting the first user in each group
                    },
                    totalCount: {
                        $sum: "$LogTimeDuration" // Calculate sum of all LogTimeDuration for each group
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