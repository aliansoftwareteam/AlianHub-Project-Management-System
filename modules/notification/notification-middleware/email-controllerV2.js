const emailNotificationHandlerCtrl = require("../email-notification-handler/controllerV2")
const emailCtrl = require('../send-email/controllerV2')
const logger = require("../../../Config/loggerConfig")
exports.emailNotificationManage = (payload) => {
    return new Promise((resolve,reject) => {
        try {
            if (payload.length > 0) {
                const promise1 = new Promise((resolve) => {
                    emailNotificationHandlerCtrl.fetchDetailsOfCompanies([...new Set(payload.map(item => item.companyId))]).then(response => {
                        resolve(response)
                    }).catch(error => {
                        resolve([])
                    })
                })
                const promise2 = new Promise((resolve) => {
                    emailNotificationHandlerCtrl.fetchProjectDetailsSingle(payload[0].companyId, payload[0].projectId).then(response => {
                        resolve(response)
                    }).catch(error => {
                        resolve([])
                    })
                })
                var arrayPromise = [promise1, promise2]
                if (payload[0].taskId != "") {
                    const promise3 = new Promise((resolve) => {
                        emailNotificationHandlerCtrl.fetchTaskDetails(payload[0].companyId, payload[0].taskId).then(response => {
                            resolve(response)
                        }).catch(error => {
                            resolve([])
                        })
                    })
                    arrayPromise.push(promise3)
                }
                if (payload[0].comments_id !== "" && payload[0].comments_id !== undefined) {
                    const promise4 = new Promise((resolve) => {
                        emailNotificationHandlerCtrl.commentsDetails(payload[0].companyId, payload[0].comments_id).then(response => {
                            resolve(response)
                        }).catch(error => {
                            resolve([])
                        })
                    })

                    arrayPromise.push(promise4)

                }
                var allDetails = new Set()
                allDetails["notification"] = payload[0]
                Promise.all(arrayPromise).then((values) => {
                    arrayPromise.map((itm, index) => {
                        if (index == 0) {
                            allDetails['companies'] = values[index]
                        }
                        else if (index == 1) {
                            allDetails['projects'] = values[index]
                        }
                        else if (index == 2) {
                            allDetails['tasks'] = values[index]
                        }
                        else if (index == 3) {
                            allDetails['comments'] = values[index]
                        }
                    })
                    this.sendEmailHandler(allDetails).then(()=>{
                        resolve(allDetails)
                    }).catch(error=>{
                        reject({status:false,message:error.message})
                    })
                }).catch((error) => {
                    logger.error(`Email Notification Promise Catch Error: ${error?.message || error}`)
                    reject({message:error?.message || error})
                })

            }
            else {
                resolve({})
            }


        } catch (error) {
            logger.error(`Email Notification Catch Error: ${error.message}`)
            reject({message:error.message})
        }

    })
}


exports.sendEmailHandler = (allDetails) => {
    return new Promise((resolve,reject) => {
        try {
            var emailDetails = { ...allDetails }
            emailCtrl.sendEmailHandlerSingle(emailDetails).then(res=>{
                resolve(res)
            })
            .catch(error=>{
                logger.error(`sendEmailHandler Catch Error ${error?.message||error}`)
                reject(error)

            })
        } catch (error) {
            reject({message:error.message})
        }

    })

}
