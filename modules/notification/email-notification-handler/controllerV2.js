const { MongoDbCrudOpration} = require("../../../utils/mongo-handler/mongoQueries");
const { SCHEMA_TYPE } = require("../../../Config/schemaType")
const logger = require("../../../Config/loggerConfig")
const { getCompanyDataFun } = require("../../company/controller/update-company");
exports.fetchDetailsOfCompanies = (companies = []) => {
  return new Promise((resolve, reject) => {
    try {
      getCompanyDataFun(companies)
        .then(companiesDetails => {
          resolve(companiesDetails)
        })
        .catch(error => {
          reject({ message: error.message })
        })
    } catch (error) {
      logger.error(`Email Notification Fetch Company Catch error: ${error}`);
      resolve([])
    }

  })
}

exports.fetchProjectDetailsSingle = (companyID, id) => {
  return new Promise((resolve, reject) => {
    try {
      let obj = {
        type: SCHEMA_TYPE.PROJECTS,
        data: [{
          _id:{ $in: id }
        }]
      }
      MongoDbCrudOpration(companyID, obj, "find")
        .then(projectDetails => {
          resolve(projectDetails)
        })
        .catch(error => {
          reject({ message: error.message })
        })
    } catch (error) {
      logger.error(`Fetch Project Details For single Notification: ${error.message}`)
      resolve([])
    }
  })


}

exports.fetchTaskDetails = (companyID, taskIdlist) => {
  return new Promise((resolve, reject) => {
    try {
      let obj = {
        type: SCHEMA_TYPE.TASKS,
        data: [{
          _id:{ $in: taskIdlist }
        }]
      }
      MongoDbCrudOpration(companyID, obj, "find")
        .then(taskDetails => {
          resolve(taskDetails)
        })
        .catch(error => {
          reject({ message: error.message })
        })
    } catch (error) {
      logger.error(`Fetch Task Details Notification: ${error.message}`)
      resolve([])
    }
  })
}


exports.commentsDetails = (companyId, comments_id) => {
  return new Promise((resolve, reject) => {
    try {
        let obj = {
        type: SCHEMA_TYPE.MENTIONS,
        data: [{
          comment_id:{ $in: comments_id }
        }]
      }
      MongoDbCrudOpration(companyId, obj, "find")
        .then(commentsDetails => {
          resolve(commentsDetails)
        })
        .catch(error => {
          reject({ message: error.message })
        })
    } catch (error) {
      logger.error(`ERROR in update parent task counts:${error.message}`);
      resolve([])
    }
  })
}


