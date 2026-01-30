const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration,validateObjectId } = require("../../../utils/mongo-handler/mongoQueries");
const {removeCache} = require('../../../utils/commonFunctions');

exports.updateProjectInternal = async (companyId, projectId, updateObject, key, arrayFilters) => {
    return new Promise((resolve, reject) => {
        if (!(updateObject && Object.keys(updateObject).length)) {
            reject("Update Object is Required");
        }
    
        if (!validateObjectId(projectId)) {
            reject("Invalid project ID");
        }
        if(!companyId){
            reject("Invalid company ID");
        }
    
        let data;
        if (key) {
            if (key == '$addToSet') {
                let setsArray = [];
                Object.keys(updateObject).forEach((ele) => {
                    let fieldName = ele;
                    let fieldValue = updateObject[ele];
                    setsArray.push({
                        $set: {
                            [fieldName]: {
                                $cond: {
                                    if: { $isArray: `$${fieldName}` },
                                    then: { $concatArrays: [`$${fieldName}`, [fieldValue]] },
                                    else: [fieldValue]
                                }
                            }
                        }
                    })
                    setsArray.push({
                        $set: {
                            [fieldName]: { $setUnion: [`$${fieldName}`] }
                        }
                    })
                })
                data = [
                    { _id: projectId },
                    setsArray,
                ];
            } else {
                data =  [
                    { _id: projectId },
                    {
                        [key]: updateObject
                    },
                ]
            }
        } else {
            key = '$set'
            data =  [
                { _id: projectId },
                {
                    [key]: updateObject
                },
            ]
        }
    
    
        if (arrayFilters?.length) {
            let arrObj = { arrayFilters };
            data.push(arrObj)
        }
    
        let mongoObj = {
            type: SCHEMA_TYPE.PROJECTS,
            data: data
        }
        const project = MongoDbCrudOpration(companyId, mongoObj, 'findOneAndUpdate');
    
        if (!project) {
            reject("Project not updated");
        }
        removeCache('UserProjectData:',true);
        return resolve(project);
    })
};

exports.updateProject = async (req, res) => {
    try {
        const { id: projectId } = req.params;
        const { updateObject, key, arrayFilters } = req.body;
        const companyId = req.headers['companyid'];
        if (!(updateObject && Object?.keys(updateObject)?.length)) {
            return res.status(400).json({message: 'Update Object is Required'});
        }
        if (!validateObjectId(projectId)) {
            return res.status(400).json({ message: "Invalid project ID" });
        }
        if(!companyId){
            return res.status(400).json({ message: "CompanyId is Required" });
        }
        exports.updateProjectInternal(companyId, projectId, updateObject, key, arrayFilters).then((project) => {
            return res.status(200).json(project);
        }).catch((error) => {
            return res.status(500).json({ message: "An error occurred while fetching the project",error:error });
        })
    } catch (error) {
        return res.status(500).json({ message: "An error occurred while fetching the project",error:error });
    }
};