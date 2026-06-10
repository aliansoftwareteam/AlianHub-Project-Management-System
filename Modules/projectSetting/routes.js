const ctrl = require('./controller');
const autoArchive = require('./autoArchive');

exports.init = (app) => {
     /**
     * @swagger
    *  components:
    *    schemas:
    *      taskType:
    *        type: object
    *        required:
    *         - projectId
    *         - companyId
    *         - taskTypeKey
    *         - oldTaskType
    *        properties:
    *         projectId: 
    *           type: string
    *           required: true
    *           description: The projectId of project.
    *         companyId: 
    *           type: string
    *           required: true
    *           description: The companyId of project.
    *         taskTypeKey:
    *           type: array
    *           required: true
    *           description: The taskTypeKey of tasktype.
    *         oldTaskType:
    *           type: array
    *           required: true
    *           description: The old Task type.
 
     */
    /**
     * @swagger
     *  /api/v1/projectSetting/taskType:
     *    post: 
     *      description: This API is used for Update Task Type.
     *      tags: [Update Task Staus From Setting]
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/taskType'
     *      responses:
     *          "200":
     *              description: status:true/false, statusText:message
     */
    app.post('/api/v1/projectSetting/taskType', ctrl.changeTaskType);

    /**
     * @swagger
    *  components:
    *    schemas:
    *      taskStatus:
    *        type: object
    *        required:
    *         - projectId
    *         - companyId
    *         - taskTypeKey
    *         - oldTaskStatus
    *        properties:
    *         projectId: 
    *           type: string
    *           required: true
    *           description: The projectId.
    *         companyId: 
    *           type: string
    *           required: true
    *           description: The companyId.
    *         taskStatusKey:
    *           type: array
    *           required: true
    *           description: The taskStatusKey of task status.
    *         oldTaskStatus:
    *           type: array
    *           required: true
    *           description: The oldTaskStatus of task status.
 
     */
    /**
     * @swagger
     *  /api/v1/projectSetting/taskStatus:
     *    post: 
     *      description: This API is used for Update Task Type.
     *      tags: [Update Task Status from Setting]
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/taskStatus'
     *      responses:
     *          "200":
     *              description: status:true/false, statusText:message
     */
    app.post('/api/v1/projectSetting/taskStatus', ctrl.changeTaskStatus);
    app.post('/api/v1/projectSetting/migrateSprintsFun', ctrl.migrateSprintsFun);

    // Per-project auto-archive rule (completed tasks archive after N days —
    // applied by the nightly cron in cron.js).
    app.get('/api/v1/projectSetting/autoArchive/:pid', autoArchive.getAutoArchive);
    app.post('/api/v1/projectSetting/autoArchive', autoArchive.setAutoArchive);
}