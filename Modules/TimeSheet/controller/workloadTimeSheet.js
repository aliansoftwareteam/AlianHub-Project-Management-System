
const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const { isPrivileged } = require('../../../Config/roleTypes');


exports.getWorkloadTimeSheet = async(req,res) => {
    try {
        const { selectedFilter, userArray, projectArray, start, end, companyUserDetail,timeZone, isFrom = '' } = req.body;   
        let timeQuery = [];
        let filterProject = selectedFilter?.filter((x) => { return x.type == "Projects" });
        let teamsIds = selectedFilter?.filter((x) => { return x.type == 'Teams' });
        let filterIds = selectedFilter?.filter((x) => { return x.type == 'Users' });
        if (filterProject?.length || isFrom === 'workloadview') {
            timeQuery = [{
                ...(userArray?.length ?
                    {
                        Loggeduser: { 
                            $in: userArray 
                        }
                    }
                    :
                    {}
                ),
                ProjectId: {
                    $in: projectArray
                },
                LogStartTime: {
                    $gte: start,
                    $lte: end
                }
            }]
            if (filterIds?.length === 0 && teamsIds?.length === 0 && isPrivileged(companyUserDetail.roleType)) {
                timeQuery = [{
                    ProjectId: {
                        $in: projectArray
                    },
                    LogStartTime: {
                        $gte: start,
                        $lte: end
                    }
                }]
            }
        }
        else {
            timeQuery = [{
                ...(userArray?.length ?
                    {
                        Loggeduser: { 
                            $in: userArray 
                        }
                    }
                    :
                    {}
                ),
                LogStartTime: {
                    $gte: start,
                    $lte: end
                }
            }]
            if (filterIds?.length === 0 && teamsIds?.length === 0 && isPrivileged(companyUserDetail.roleType)) {
                timeQuery = [{
                    LogStartTime: {
                        $gte: start,
                        $lte: end
                    }
                }]
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
        res.status(500).json({ message: "An error occurred while fetching the Workload TimeSheet Data.", error: error.message });
    }
}