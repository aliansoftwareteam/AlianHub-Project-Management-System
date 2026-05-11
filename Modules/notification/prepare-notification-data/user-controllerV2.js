const { default: mongoose } = require("mongoose");
const { getUserByQueyFun } = require("../../Users/controller");
const { schema } = require("../../../utils/mongo-handler/schema");
exports.getUsersDetails = (UserIDs) => {
   return new Promise((resolve, reject) => {
    try {
        const query = [
            {
                $match: {
                    _id: { $in: UserIDs.map(id => new mongoose.Types.ObjectId(id)) }
                }
            },
            {
                $addFields: {
                    _idString: { $toString: "$_id" } // Convert _id to string
                }
            },
            {
                $lookup: {
                    from: "sessions",
                    localField: "_idString",
                    foreignField: "userId",
                    as: "sessions"
                }
            },
            {
                $match: { "sessions.0": { $exists: true } } // Remove users with no sessions
            },
            {
                $project: {
                    _id: 1,
                    ...Object.fromEntries(Object.keys(schema.users).map(key => [key, 1])),
                    userId: { $toString: "$_id" },
                    webTokens: {
                        $map: {
                            input: {
                                $filter: {
                                    input: "$sessions",
                                    as: "s",
                                    cond: { 
                                        $and: [
                                            { $ne: ["$$s.webToken", null] }, // Exclude null values
                                            { $ne: ["$$s.webToken", ""] },    // Exclude empty strings
                                            { $gt: [{ $type: "$$s.webToken" }, "missing"] },
                                            { $gt: [ "$$s.lastActive", { $dateSubtract: { startDate: "$$NOW", unit: "day", amount: isNaN(parseInt(process.env.NOTIFICATIONACTIVETIME, 10)) ? 4 : Math.abs(parseInt(process.env.NOTIFICATIONACTIVETIME, 10)) } }] }
                                        ]
                                    }
                                }
                            },
                            as: "validSession",
                            in: "$$validSession.webToken"
                        }
                    }
                }
            }
        ]
        getUserByQueyFun(query, "", false, true)
        .then(usersDetails => {
          resolve(usersDetails)
        })
        .catch(error => {
          reject({message:error.message})
        })
      } catch (error) {
        reject({message:error.message})
      }
    })

};