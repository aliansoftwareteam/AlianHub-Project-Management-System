const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const { resolveSheetScope, scopedTimeMatch, asList, filtersOfType, SHEET_PERMISSION } = require("../helpers/timeScope");

exports.getTrackerTimeSheet = async(req,res) => {
    try {
        const { selectedFilter, userArray, start, end } = req.body;
        const scope = await resolveSheetScope(req.headers['companyid'], req.uid, SHEET_PERMISSION.tracker);
        const peopleFiltered = filtersOfType(selectedFilter, 'Users').length || filtersOfType(selectedFilter, 'Teams').length;
        const projectFilter = filtersOfType(selectedFilter, 'Projects').map((element) => element.id);
        const timeQuery = {
            LogEndTime: {
                $gte: start,
            },
            LogStartTime: {
                $lte: end
            },
            logAddType: 1,
            ...scopedTimeMatch(scope, {
                userIds: (scope.everyone && !peopleFiltered) || !asList(userArray).length ? null : userArray,
                projectIds: projectFilter.length ? projectFilter : null,
            }),
        };
        const query = [
            {
                $match: timeQuery
            },
            {
                $group: {
                    _id: {
                        userId: "$Loggeduser"
                    },
                    data: {
                        $push: {
                            ProjectId: "$ProjectId",
                            TicketID: "$TicketID",
                            Loggeduser: "$Loggeduser",
                            trackShots: "$trackShots",
                            LogDescription: "$LogDescription",
                            logAddType: "$logAddType"
                        }
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
        res.status(500).json({ message: "An error occurred while fetching the Tarcker TimeSheet Data.", error: error.message });
    }
}