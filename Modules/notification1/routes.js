const { HandleBothNotification } = require('../Tasks/helpers/handleNotification');
const { HandleHistory } = require('../Tasks/helpers/helper');

const planHistory = require('../EstimatedTime/helpers/planHistory');

const NOTIFICATION_TYPES = ['project', 'tasks', 'task', 'chat'];
const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/* The server records these changes when they are saved; web apps built before that still post their own text here. */
const SERVER_BUILT_HISTORY = [{ type: 'task', key: planHistory.HISTORY_KEY }];
const SERVER_BUILT_NOTIFICATIONS = [planHistory.NOTIFICATION_KEY];
const keyOf = (body) => (isPlainObject(body) && isPlainObject(body.object) ? body.object.key : undefined);
const serverBuiltHistory = (body) => SERVER_BUILT_HISTORY.some((entry) => body.type === entry.type && keyOf(body) === entry.key);
const serverBuiltNotification = (body) => SERVER_BUILT_NOTIFICATIONS.includes(keyOf(body));

function notificationBodyError(body) {
    if (!NOTIFICATION_TYPES.includes(body.type)) return `type must be one of ${NOTIFICATION_TYPES.join(', ')}`;
    if (!isPlainObject(body.object) || !body.object.key) return 'object with a key is required';
    if (!isPlainObject(body.userData)) return 'userData is required';
    if (body.type === 'project' && !body.projectId) return 'projectId is required';
    if (['tasks', 'task'].includes(body.type) && !body.taskId) return 'taskId is required';
    if (body.type === 'chat' && !(body.isGroupChat === true ? body.sprintId : body.taskId)) return 'taskId or sprintId is required';
    return '';
}

const { notificationAsSessionUser, historyAsSessionUser } = require('./sessionActor');

exports.init = (app) => {
    app.post('/api/v1/handleHistory', historyAsSessionUser);
    app.post('/api/v1/handleNotification', notificationAsSessionUser);

    /**
     * @swagger
    *  components:
    *    schemas:
    *      sendNotification:
    *        type: object
    *        required:
    *          - companyId
    *          - key
    *          - notificationTitle
    *          - notificationKey
    *          - notificationId
    *          - companyOwnerId
    *        properties:
    *         companyId:
    *           type: string
    *           required: true
    *           description: This is the dcoument id of selected company.
    *         key:
    *           type: string
    *           required: true
    *           description: This is the type of notification like project or task.
    *         notificationTitle:
    *           type: string
    *           required: true
    *           description: This is the title for the notification email subject.
    *         notificationKey:
    *           type: string
    *           required: true
    *           description: This is the key unique key name of notification.
    *         notificationId:
    *           type: string
    *           required: true
    *           description: This is the document id of notification collection.
    *         companyOwnerId:
    *           type: string
    *           required: true
    *           description: This is the document id of owner user.
     */
    /**
     * @swagger
     *  /api/v1/sendNotification:
     *    post: 
     *      description: This API is used for send notification email
     *      tags: [Notifications]
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/sendNotification'
     *      responses:
     *          "200":
     *              description: status:true/false,statusText:message
     */

    /**
     * Send Notification Mail API
     */
    // app.post('/api/v1/sendNotification', ctrl.sendNotification);

    /**
     * @swagger
    *  components:
    *    schemas:
    *      handleHistory:
    *        type: object
    *        required:
    *           - type
    *           - companyId
    *           - projectId
    *           - taskId
    *           - object
    *           - userData
    *        properties:
    *         type:
    *           type: string
    *           required: true
    *           description: This field is to specify the type of notification.
    *         companyId:
    *           type: string
    *           required: true
    *           description: This is the document id of company.
    *         projectId:
    *           type: string
    *           required: true
    *           description: This is the document id of project.
    *         taskId:
    *           type: string
    *           required: true
    *           description: This is the document id of task.
    *         object:
    *           type: object
    *           required: true
    *           description: This field consist object for the history message.
    *         userData:
    *           type: object
    *           required: true
    *           description: This object consists of Employee_Name, id, companyOwnerId.
     */
    /**
     * @swagger
     *  /api/v1/handleHistory:
     *    post: 
     *      description: This API is used for send history
     *      tags: [Notifications]
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/handleHistory'
     *      responses:
     *          "200":
     *              description: status:true/false,statusText:message
     */

    /**
     * Send Notification Mail API
     */
    app.post('/api/v1/handleHistory', (req, res) => {
        if (isPlainObject(req.body) && serverBuiltHistory(req.body)) {
            return res.send({ status: true, statusText: 'History is recorded by the server.' });
        }
        HandleHistory.apply(null, Object.values(req.body))
        .then(() => {
            res.send({status: true, statusText: "History added successfully."});
        })
        .catch((error) => {
            res.send({status: false, statusText: error.message})
        })
    })

    /**
     * @swagger
    *  components:
    *    schemas:
    *      handleNotification:
    *        type: object
    *        required:
    *           - folderId
    *           - sprintId
    *           - type
    *           - companyId
    *           - projectId
    *           - taskId
    *           - object
    *           - userData
    *        properties:
    *         folderId:
    *           type: string
    *           required: true
    *           description: This field is for folderId.
    *         sprintId:
    *           type: string
    *           required: true
    *           description: This field is for sprintId.
    *         type:
    *           type: string
    *           required: true
    *           description: This field is to specify the type of notification.
    *         companyId:
    *           type: string
    *           required: true
    *           description: This is the document id of company.
    *         projectId:
    *           type: string
    *           required: true
    *           description: This is the document id of project.
    *         taskId:
    *           type: string
    *           required: true
    *           description: This is the document id of task.
    *         object:
    *           type: object
    *           required: true
    *           description: This field consist object for the history message.
    *         userData:
    *           type: object
    *           required: true
    *           description: This object consists of Employee_Name, id, companyOwnerId.
     */
    /**
     * @swagger
     *  /api/v1/handleNotification:
     *    post: 
     *      description: This API is used for send history
     *      tags: [Notifications]
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/handleNotification'
     *      responses:
     *          "200":
     *              description: status:true/false,statusText:message
     */

    /**
     * Send Notification Mail API
     */
    app.post('/api/v1/handleNotification', (req, res) => {
        const body = isPlainObject(req.body) ? req.body : {};
        const sessionCompanyId = String(req.headers.companyid || '');
        if (body.companyId && String(body.companyId) !== sessionCompanyId) {
            return res.status(403).send({ status: false, statusText: 'companyId does not match your session' });
        }
        const invalid = notificationBodyError(body);
        if (invalid) {
            return res.status(400).send({ status: false, statusText: invalid });
        }
        if (serverBuiltNotification(body)) {
            return res.send({ status: true, statusText: 'Notification is sent by the server.' });
        }
        return HandleBothNotification({ ...body, companyId: sessionCompanyId })
            .then(() => {
                res.send({ status: true, statusText: 'Notification sent successfully.' });
            })
            .catch((error) => {
                res.send({ status: false, statusText: (error && error.message) || 'Notification was not sent.' });
            });
    })
};