const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration,validateObjectId } = require("../../../utils/mongo-handler/mongoQueries");
const {removeCache} = require('../../../utils/commonFunctions');
const { resolveProjectSkills } = require('../../settings/ProjectSkills/helper');
const { PROJECT_SOURCES, normaliseSource, sourceOrDefault, cleanProposalId, numericProposalId, validateProposalId } = require('../helpers/projectSourceRules');

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

/**
 * Normalise `source` / `proposalId` in place and enforce the Upwork rule against
 * the project's *resulting* state, not just what this request carries — clearing
 * the proposal id on an Upwork project has to fail the same way as switching to
 * Upwork without one. Costs one read, and only when either field is touched.
 */
const guardSourceUpdate = async (companyId, projectId, updateObject, touchesSource, touchesProposalId) => {
    if (touchesSource) {
        const source = normaliseSource(updateObject.source);
        if (!source) return { error: "Source must be one of: " + PROJECT_SOURCES.join(', ') };
        updateObject.source = source;
    }
    if (touchesProposalId) {
        updateObject.proposalId = cleanProposalId(updateObject.proposalId);
        updateObject.proposalIdNumeric = numericProposalId(updateObject.proposalId);
    }

    // Whichever field this request doesn't carry has to come from the document.
    let stored = null;
    if (!touchesSource || !touchesProposalId) {
        stored = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PROJECTS,
            data: [{ _id: projectId }, { source: 1, proposalId: 1 }]
        }, 'findOne');
    }

    const effectiveSource = touchesSource ? updateObject.source : sourceOrDefault(stored && stored.source);
    if (effectiveSource !== 'upwork') return {};

    const effectiveProposalId = touchesProposalId
        ? updateObject.proposalId
        : cleanProposalId(stored && stored.proposalId);

    const check = validateProposalId('upwork', effectiveProposalId);
    return check.valid ? {} : { error: "A proposal id is required for Upwork projects" };
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
        // Single write path for every client, so `skills` is validated here.
        // $addToSet/$push send a bare value that would land as a nested array
        // and break the reporting join — reject rather than coerce.
        const touchesSource = Object.prototype.hasOwnProperty.call(updateObject, 'source');
        const touchesProposalId = Object.prototype.hasOwnProperty.call(updateObject, 'proposalId');
        if (touchesSource || touchesProposalId) {
            const guard = await guardSourceUpdate(companyId, projectId, updateObject, touchesSource, touchesProposalId);
            if (guard.error) return res.status(400).json({ message: guard.error });
        }
        if (Object.prototype.hasOwnProperty.call(updateObject, 'skills')) {
            if (key && key !== '$set') {
                return res.status(400).json({ message: "Skills must be sent as a full array with $set" });
            }
            updateObject.skills = await resolveProjectSkills(companyId, updateObject.skills);
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