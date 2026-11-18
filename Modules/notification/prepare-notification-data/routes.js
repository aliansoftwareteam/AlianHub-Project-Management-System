const ctrlV2  = require("./controllerV2");
const { agentsRefused } = require('../../Agents/guard');

exports.init = (app) => {

    /**
    * @swagger
    *  components:
    *    schemas:
    *      prepare-notification-data:
    *        type: object
    *        required:
    *          - companyId
    *          - key
    *          - projectId
    *          - message
    *          - userId
    *        properties:
    *         companyId:
    *           type: string
    *           required: true
    *           description: This is the dcoument id of selected company.
    *         key:
    *           type: string
    *           required: true
    *           description: This is the type of notification like project or tasks.
    *         message:
    *           type: string
    *           required: true
    *           description: This is the message for the notification.
    *         projectId:
    *           type: string
    *           required: true
    *           description: This is the project ID of notification.
    *         userId:
    *           type: string
    *           required: true
    *           description: This is the user id of user collections.
    */


      /**
     * @swagger
     *  /api/v1/prepare-notification-data:
     *    post: 
     *      description: This API is used to create a notification ap per receiver.
     *      tags: [Notifications]
     *      summary: Create Notification
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/prepare-notification-data'
     *      responses:
     *          "200":
     *              description: status:true/false,message:message
     */

    // app.post('/api/v1/prepare-notification-data', ctrl.handleNotification);
    // API V2

        /**
    * @swagger
    *  components:
    *    schemas:
    *      prepare-notification-data:
    *        type: object
    *        required:
    *          - companyId
    *          - key
    *          - projectId
    *          - message
    *          - userId
    *        properties:
    *         companyId:
    *           type: string
    *           required: true
    *           description: This is the dcoument id of selected company.
    *         key:
    *           type: string
    *           required: true
    *           description: This is the type of notification like project or tasks.
    *         message:
    *           type: string
    *           required: true
    *           description: This is the message for the notification.
    *         projectId:
    *           type: string
    *           required: true
    *           description: This is the project ID of notification.
    *         userId:
    *           type: string
    *           required: true
    *           description: This is the user id of user collections.
    */


      /**
     * @swagger
     *  /api/v2/prepare-notification-data:
     *    post: 
     *      description: This API is used to create a notification ap per receiver.
     *      tags: [Notifications]
     *      summary: Create Notification
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/prepare-notification-data'
     *      responses:
     *          "200":
     *              description: status:true/false,message:message
     */

      app.post('/api/v2/prepare-notification-data', agentsRefused('notification.send'), ctrlV2.handleNotification);
};