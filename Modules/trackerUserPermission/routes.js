const ctrl = require('./controller');

exports.init = (app) => {
    /**
     * @swagger
    *  components:
    *    schemas:
    *      manageTrackerUsers:
    *        type: object
    *        required:
    *         - DataObj
    *         - CompanyId
    *        properties:
    *         CompanyId: 
    *           type: string
    *           required: true
    *           description: CompanyId.
    *         DataObj: 
    *           type: object
    *           required: true
    *           description: DataObj.
    */
    /**
     * @swagger
     *  /api/v1/manageTrackerUserPermission:
     *    post: 
     *      description: Gives back a member's desktop tracker seat (DataObj.ops false, DataObj.data.userId). Access itself comes from the role's Desktop time tracker permission.
     *      tags: [Plan Permissions APIs]
     *      summary: Manage Tracker Users API
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/manageTrackerUsers'
     *      responses:
     *          "200":
     *              description: status:true/false,message:message
     */
    app.post('/api/v1/manageTrackerUserPermission', ctrl.handleTrackerUserPermission);
}