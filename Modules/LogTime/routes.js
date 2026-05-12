const { handleMulterStorage } = require(`../../common-storage/common-${process.env.STORAGE_TYPE}.js`);
const ctrlV2 = require('./controllerV2');
const multer = require("multer");

const upload = multer(handleMulterStorage());

exports.init = (app) => {
    // V2 VERSION START


         /**
     * @swagger
    *  components:
    *    schemas:
    *      manualLogtime:
    *        type: object
    *        required:
    *         - logTimeDate
    *         - description
    *         - endLogTime
    *         - startLogTime
    *         - timeDuration
    *         - ticketId
    *         - projectId
    *         - companyId
    *         - userId
    *         - isEdit
    *         - timeSheetId
    *         - userName
    *         - dateFormat
    *         - companyOwnerId
    *         - sprintId
    *         - projectName
    *         - taskName
    *         - folderId
    *         - previousLoggedTime
    *         - timeZone
    *        properties:
    *         logTimeDate: 
    *           type: string
    *           required: true
    *           description: The date of logtime.
    *         description: 
    *           type: string
    *           required: true
    *           description: The description of logtime.
    *         endLogTime: 
    *           type: string
    *           required: true
    *           description: The endtime of logtime.
    *         startLogTime: 
    *           type: string
    *           required: true
    *           description: The startTime of logtime.
    *         timeDuration: 
    *           type: string
    *           required: true
    *           description: The timeduratation of logtime.
    *         ticketId: 
    *           type: string
    *           required: true
    *           description: The taskId of task in which logtime is add.
    *         projectId: 
    *           type: string
    *           required: true
    *           description: The projectId of task in which logtime is add.
    *         companyId: 
    *           type: string
    *           required: true
    *           description: The companyId of task in which logtime is add.
    *         userId: 
    *           type: string
    *           required: true
    *           description: The userId of user.
    *         isEdit: 
    *           type: boolean
    *           required: true
    *           description: The true if it is edit logtime.
    *         timeSheetId: 
    *           type: string
    *           required: false
    *           description: The timeSheet docId if it is edit logtime.
    *         userName: 
    *           type: string
    *           required: true
    *           description: The name of user.
    *         dateFormat: 
    *           type: string
    *           required: true
    *           description: The date format of user.
    *         companyOwnerId: 
    *           type: string
    *           required: true
    *           description: The company Owner Id.    
    *         sprintId: 
    *           type: string
    *           required: true
    *           description: The id of sprint.    
    *         projectName: 
    *           type: string
    *           required: true
    *           description: The name of project.    
    *         taskName: 
    *           type: string
    *           required: true
    *           description: The name of task.
    *         folderId: 
    *           type: string
    *           required: false
    *           description: The id of folder.
    *         previousLoggedTime:
    *           type: string
    *           required: false
    *           description: The previous logged time if it is edit logtime.
    *         timezone:
    *           type: string
    *           required: false
    *           description: The timezone of user.
 
     */
    /**
     * @swagger
     *  /api/v1/manualLogtime:
     *    post: 
     *      description: This API is used for Add and Edit logtime(Manually).
     *      tags: [Log time APIs]
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/manualLogtime'
     *      responses:
     *          "200":
     *              description: status:true/false, statusText:message
     */
    app.post('/api/v2/manualLogtime', ctrlV2.manualLogTime);


      /**
     * @swagger
    *  components:
    *    schemas:
    *      deleteManualLogtime:
    *        type: object
    *        required:
    *         - logTimeDate
    *         - endLogTime
    *         - startLogTime
    *         - timeDuration
    *         - ticketId
    *         - projectId
    *         - companyId
    *         - userId
    *         - timeSheetId
    *         - userName
    *         - dateFormat
    *         - companyOwnerId
    *         - sprintId
    *         - projectName
    *         - taskName
    *         - folderId
    *        properties:
    *         logTimeDate: 
    *           type: string
    *           required: true
    *           description: The date of logtime.
    *         endLogTime: 
    *           type: string
    *           required: true
    *           description: The endtime of logtime.
    *         startLogTime: 
    *           type: string
    *           required: true
    *           description: The startTime of logtime.
    *         timeDuration: 
    *           type: string
    *           required: true
    *           description: The timeduratation of logtime.
    *         ticketId: 
    *           type: string
    *           required: true
    *           description: The taskId of task in which logtime is add.
    *         projectId: 
    *           type: string
    *           required: true
    *           description: The projectId of task in which logtime is add.
    *         companyId: 
    *           type: string
    *           required: true
    *           description: The companyId of task in which logtime is add.
    *         userId: 
    *           type: string
    *           required: true
    *           description: The userId of user.
    *         timeSheetId: 
    *           type: string
    *           required: false
    *           description: The timeSheet docId if it is edit logtime.
    *         userName: 
    *           type: string
    *           required: true
    *           description: The name of user.
    *         dateFormat: 
    *           type: string
    *           required: true
    *           description: The date format of user.
    *         companyOwnerId: 
    *           type: string
    *           required: true
    *           description: The company Owner Id.    
    *         sprintId: 
    *           type: string
    *           required: true
    *           description: The id of sprint.    
    *         projectName: 
    *           type: string
    *           required: true
    *           description: The name of project.    
    *         taskName: 
    *           type: string
    *           required: true
    *           description: The name of task.
    *         folderId: 
    *           type: string
    *           required: false
    *           description: The id of folder.
 
     */
    /**
     * @swagger
     *  /api/v2/deleteManualLogtime:
     *    post: 
     *      description: This API is used for Delete logtime(Manually).
     *      tags: [Log time APIs]
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/deleteManualLogtime'
     *      responses:
     *          "200":
     *              description: status:true/false, statusText:message
     */
    app.post('/api/v2/deleteManualLogtime', ctrlV2.deleteManualLogtime);

        /**
     * @swagger
    *  components:
    *    schemas:
    *      trackerStart:
    *        type: object
    *        required:
    *         - description
    *         - userId
    *         - projectId
    *         - taskId
    *         - companyId
    *        properties:
    *         description: 
    *           type: string
    *           required: true
    *           description: The description of logtime.
    *         userId: 
    *           type: string
    *           required: true
    *           description: The userId.
    *         projectId: 
    *           type: string
    *           required: true
    *           description: The id of project.
    *         taskId: 
    *           type: string
    *           required: true
    *           description: The id of task.
    *         companyId: 
    *           type: string
    *           required: true
    *           description: The id of company.
 
     */
    /**
     * @swagger
     *  /api/v2/timeTracker/start:
     *    post: 
     *      description: This API is used for Add logtime when tracker is start.
     *      tags: [Log time APIs]
     *      summary: Add Timelog When Tracker Start
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/trackerStart'
     *      responses:
     *          "200":
     *              description: status:true/false, statusText:message
     */
    app.post('/api/v2/timeTracker/start', ctrlV2.timeTrackerStart);
    app.post('/api/v3/timeTracker/start', ctrlV2.timeTrackerStart2);

        /**
     * @swagger
    *  components:
    *    schemas:
    *      timetrackerEnd:
    *        type: object
    *        required:
    *         - timeSheetId
    *         - companyId
    *         - userName
    *         - sprintId
    *         - userId
    *         - projectId
    *         - taskId
    *         - taskName
    *         - projectName
    *         - companyOwnerId
    *         - dateFormat
    *         - timeZone
    *         - stroke
    *        properties:
    *         timeSheetId: 
    *           type: string
    *           required: true
    *           description: The id of timesheet.
    *         companyId: 
    *           type: string
    *           required: true
    *           description: The company Id.
    *         userName: 
    *           type: string
    *           required: false
    *           description: The Name of user if tracker is stop.
    *         sprintId: 
    *           type: string
    *           required: false
    *           description: The Id of sprint if tracker is stop.
    *         userId: 
    *           type: string
    *           required: false
    *           description: The Id of user if tracker is stop.
    *         projectId: 
    *           type: string
    *           required: false
    *           description: The Id of project if tracker is stop.
    *         taskId: 
    *           type: string
    *           required: false
    *           description: The Id of task if tracker is stop.
    *         taskName: 
    *           type: string
    *           required: false
    *           description: The name of task if tracker is stop.
    *         projectName: 
    *           type: string
    *           required: false
    *           description: The name of project if tracker is stop.
    *         companyOwnerId: 
    *           type: string
    *           required: false
    *           description: The id of company Owner if tracker is stop.
    *         dateFormat: 
    *           type: string
    *           required: false
    *           description: The date format of user if tracker is stop.
    *         timeZone: 
    *           type: string
    *           required: false
    *           description: The timeZone of user if tracker is stop.
    *         strokes: 
    *           type: string
    *           required: true
    *           description: Stringify Array of stroke for record per minute track of user.
 
     */
    /**
     * @swagger
     *  /api/v2/timetracker/end:
     *    post: 
     *      description: This Api is used to update end time when tracker is already start and if tracker is stop then add notification and history.
     *      tags: [Log time APIs]
     *      summary: Update Time Tracker Data.
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/timetrackerEnd'
     *      responses:
     *          "200":
     *              description: status:true/false, statusText:message
     */
    app.post('/api/v2/timetracker/end',  ctrlV2.endTimeTracker)


    /**
    * @swagger
    *  components:
    *    schemas:
    *      captureTimetracker:
    *        type: object
    *        required:
    *         - file
    *         - path
    *         - companyId
    *         - timeSheetId
    *         - key
    *         - imageName
    *         - prevscreenShot
    *         - screenShotTime
    *         - memoName
    *         - strokes
    *        properties:
    *         file: 
    *           type: string
    *           required: true
    *           description: Screen shot image in base/64 string.
    *         path: 
    *           type: string
    *           required: true
    *           description: Path to store screenshot In storage.
    *         companyId: 
    *           type: string
    *           required: true
    *           description: Id of comapny.
    *         timeSheetId: 
    *           type: string
    *           required: true
    *           description: Id of timeSheetId.
    *         key: 
    *           type: string
    *           required: true
    *           description: Key number which indicate the no of screen shot.
    *         imageName: 
    *           type: string
    *           required: true
    *           description: Image Name of screenshot.
    *         prevscreenShot: 
    *           type: string
    *           required: true
    *           description: Timestamp of previous screenshot.
    *         screenShotTime: 
    *           type: string
    *           required: true
    *           description: Timestamp of screenshot.
    *         memoName: 
    *           type: string
    *           required: true
    *           description: Name of memo.
    *         strokes: 
    *           type: string
    *           required: true
    *           description: Stringify Array of stroke for record per minute track of user.
 
     */
    /**
     * @swagger
     *  /api/v2/timetracker/capture:
     *    post: 
     *      description: This API is used for upload screenshot in storage and update time value in database and typsense.
     *      tags: [Log time APIs]
     *      summary: Upload Screenshot in storage and manage In Database.
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/captureTimetracker'
     *      responses:
     *          "200":
     *              description: status:true/false, statusText:message
     */
    app.post('/api/v2/timetracker/capture',upload.single("file"), ctrlV2.captureTimetracker);
    app.post('/api/v3/timetracker/capture',upload.single("file"), ctrlV2.captureTimetracker2);
    app.post('/api/v4/timetracker/capture',upload.single("file"), ctrlV2.captureTimetracker3);


/* TIME SHEET DETAILS GET */

        /**
     * @swagger
    *  components:
    *    schemas:
    *      timelog:
    *        type: object
    *        required:
    *         - companyId
    *         - userId
    *         - type
    *        properties:
    *         companyId: 
    *           type: string
    *           required: true
    *           description: The company Id.
    *         userId: 
    *           type: string
    *           required: false
    *           description: The Id of user if tracker is stop.
    *         startDate: 
    *           type: string
    *           required: true
    *           description: The start date of logtime.
    *         endDate: 
    *           type: string
    *           required: true
    *           description: The end date of logtime.
    *         type: 
    *           type: string
    *           required: true
    *           description: The end date of logtime.
    *         db: 
    *           in: header
    *           type: string
    *           required: true
    *           description: This is Database name.
     
     */
    /**
     * @swagger
     *  /api/v2/timetracker/timelog:
     *    post: 
     *      description: This Api is used to update end time when tracker is already start and if tracker is stop then add notification and history.
     *      tags: [Log time APIs]
     *      summary: Update Time Tracker Data.
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/timelog'
     *      responses:
     *          "200":
     *              description: status:true/false, statusText:message
     */
    app.post('/api/v2/timetracker/timelog', ctrlV2.getTimelog)


}