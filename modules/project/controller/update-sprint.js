const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration,validateObjectId } = require("../../../utils/mongo-handler/mongoQueries");

exports.updateSprint = async(req,res) => {
    try {
        const sprintId = req.params.id;

        if (!(req.body && req.body.updateObject)) {
            return res.status(400).json({message: 'Update Object is Required'});
        }

        if (!validateObjectId(sprintId)) {
            return res.status(400).json({ message: "Invalid sprint ID" });
        }

        let key;
        let data;
        if (req.body.key) {
            key = req.body.key;
            if (key == '$addToSet') {
                let fieldName = Object.keys(req.body.updateObject)[0];
                let fieldValue = req.body.updateObject[fieldName];

                data = [
                    { _id: sprintId },
                    [
                        {
                            $set: {
                                [fieldName]: {
                                $cond: {
                                    if: { $isArray: `$${fieldName}` },
                                    then: { $concatArrays: [`$${fieldName}`, [fieldValue]] },
                                    else: [fieldValue]
                                }
                                }
                            }
                        },
                        {
                            $set: {
                                [fieldName]: { $setUnion: [`$${fieldName}`] }
                            }
                        }
                    ],
                    {returnDocument: 'after'},
                ];
            } else {
               data =  [
                    { _id: sprintId },
                    {   
                        [key]: req.body.updateObject
                    },
                    {returnDocument: 'after'},
                ]
            }
        } else {
            key = '$set'
            data =  [
                { _id: sprintId }, 
                {   
                    [key]: req.body.updateObject
                },
                {returnDocument: 'after'},
            ]
        }
        
        let mongoObj = {
            type: SCHEMA_TYPE.SPRINTS,
            data: data
        }
        const sprint = await MongoDbCrudOpration(req.headers['companyid'], mongoObj, 'findOneAndUpdate');
        
        if (!sprint) {
            
            return res.status(400).json({ message: "sprint not updated" });
        }

        return res.status(200).json(sprint);
    } catch (error) {
        return res.status(500).json({ message: "An error occurred while update the sprint",error:error });
    }
}