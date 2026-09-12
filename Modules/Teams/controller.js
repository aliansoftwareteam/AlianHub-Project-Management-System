const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const { myCache } = require('../../Config/config');
const { removeCache } = require("../../utils/commonFunctions");
const { teamsCachePrefix, teamsListKey } = require("./cacheKeys");

exports.getTeams = async(req,res) => {
    try {
        const companyId = req.headers['companyid'];
        const teamsObj = {
            type: SCHEMA_TYPE.TEAMS_MANAGEMENT,
            data: []
        };

        const teamCache = teamsListKey(companyId);
        let teams = myCache.get(teamCache);
        let isFromCache = true;
        if(!teams){
            isFromCache = false;
            teams =  await MongoDbCrudOpration(companyId, teamsObj, 'find');
            myCache.set(teamCache, teams, 604800);
        }

        if (isFromCache) {
            res.set({
                'FromCache': 'true',
                'cacheExpireTime': myCache.getTtl(teamCache)
            });
        }

        res.status(200).json(teams);
    } catch (error) {
        res.status(500).json({ message: "An error occurred while fetching the teams", error: error.message });
    }
}

exports.addTeam = async (req,res) => {
    try {
        const saveObj = {
            type: SCHEMA_TYPE.TEAMS_MANAGEMENT,
            data: { ...req.body }
        };

        const response = await MongoDbCrudOpration(req.headers['companyid'], saveObj, "save");
        if (!response) {
            return res.status(400).json({ message: "Teams not added" });
        }
        removeCache(teamsCachePrefix(req.headers['companyid']), true);
        return res.status(200).json(response);
    } catch (error) {
        res.status(500).json({ message: "An error occurred while creating the teams", error: error.message });
    }
}

exports.updateTeam = async(req,res) => {
    try {
        const teamId = req.body.id;
        let key = req.body.key;

        let data =  [
            { _id: teamId }, 
            {
                [key]: req.body.updateObject
            },
            {
                returnDocument : 'after'
            }
        ]

        let mongoObj = {
            type: SCHEMA_TYPE.TEAMS_MANAGEMENT,
            data: data
        }
        const team = await MongoDbCrudOpration(req.headers['companyid'], mongoObj, 'findOneAndUpdate');

        if (!team) {
            return res.status(400).json({ message: "Team not updated" });
        }
        removeCache(teamsCachePrefix(req.headers['companyid']), true);
        return res.status(200).json(team);

    } catch (error) {
        res.status(500).json({ message: "An error occurred while updating the teams", error: error.message });
    }
}
