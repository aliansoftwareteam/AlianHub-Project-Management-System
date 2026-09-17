const ctrl = require('./controller');
const { requireTaskWritePermission } = require('../../Config/permissionGuard');
const { TASK_WRITE_ROUTES } = require('../../Config/taskWritePermissions');
exports.init = (app) => {
     /**
     * @swagger
    *  components:
    *    schemas:
    *      updateTaskIndex:
    *        type: object
    *        required:
    *         - isFirst
    *         - isFirstWithRecord
    *         - taskId
    *         - companyId
    *         - projectId
    *         - sprintId
    *         - relevantIndex
    *         - indexName
    *         - searchKey
    *         - relevantKey
    *         - taskKey
    *        properties:
    *         isFirst: 
    *           type: Boolean
    *           required: true
    *           description: It is indicate that task is place is at first place or not.
    *         isFirstWithRecord: 
    *           type: Boolean
    *           required: true
    *           description: It is indicate that task is place is at first place at that time there is other record or not.
    *         taskId: 
    *           type: string
    *           required: true
    *           description: The taskId.
    *         companyId: 
    *           type: string
    *           required: true
    *           description: The companyId.
    *         projectId: 
    *           type: string
    *           required: true
    *           description: The projectId.
    *         sprintId: 
    *           type: string
    *           required: true
    *           description: The sprintId.
    *         relevantIndex: 
    *           type: Number
    *           required: true
    *           description: It is index of most relevant task of new place of task.
    *         indexName: 
    *           type: Number
    *           required: true
    *           description: It is name of index which is need to update in task.
    *         searchKey: 
    *           type: string
    *           required: true
    *           description: It is search key in which new task is moved like statusKey,task_priority.
    *         relevantKey: 
    *           type: string
    *           required: true
    *           description: It is value in which new task is moved like statusKey,task_priority.
    *         taskKey: 
    *           type: string
    *           required: true
    *           description: the taskKey.
    *         updateData: 
    *           type: object
    *           required: true
    *           description: The UpdateData Object which is need to update when drag and drop.
 
     */
    /**
     * @swagger
     *  /api/v1/updateTaskIndex:
     *    post: 
     *      description: This API is used for Update Task Index When Drag And Drop.
     *      tags: [Task Index APIs]
     *      summary: Update Task Index
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/updateTaskIndex'
     *      responses:
     *          "200":
     *              description: status:true/false, statusText:message
     */
    app.post("/api/v1/taskIndex", requireTaskWritePermission(TASK_WRITE_ROUTES['POST /api/v1/taskIndex'].entry), ctrl.updateTaskIndex);
    app.post("/api/v1/updateTaskIndexOnload", requireTaskWritePermission(TASK_WRITE_ROUTES['POST /api/v1/updateTaskIndexOnload'].entry), ctrl.updateTaskIndexWhenLoad);
}