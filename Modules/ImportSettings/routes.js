const ctrl = require('./controller');

exports.init = (app) => {

    /**
     * @swagger
    *  components:
    *    schemas:
    *      importSettings:
    *        type: object
    *        required:
    *          - uid
    *          - companyId
    *        properties:
    *         uid:
    *           type: string
    *           required: true
    *           description: The uid of user.
    *         companyId:
    *           type: string
    *           required: true
    *           description: The company Id.
    *         email:
    *           type: string
    *           required: true
    *           description: Provide user email address.
    *         rules:
    *           type: array
    *           items:
    *               type: string
    *           required: false
    *           description: This parameter is used to import specific list of collections or all the data import. This field is an array.
     */
    /**
     * @swagger
     *  /api/v1/importSettings:
     *    post: 
     *      description: This API is used for import all required settings and data at the time when new company created.
     *      tags: [Import Settings APIs]
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/importSettings'
     *      responses:
     *          "200":
     *              description: status:true/false, statusText:message
     */

    app.post('/api/v1/importSettings', ctrl.importSettings);

    app.post('/api/v1/importTemplate', ctrl.importTemplate);

    /**
     * @swagger
    *  components:
    *    schemas:
    *      importSettingsProjectFunction:
    *        type: object
    *        required:
    *          - projectId
    *          - companyId
    *          - type
    *        properties:
    *         projectId:
    *           type: string
    *           required: true
    *           description: The project id.
    *         companyId:
    *           type: string
    *           required: true
    *           description: The company Id.
    *         type:
    *           type: string
    *           required: true
    *           description: Provide project type.
     */
    /**
     * @swagger
     *  /api/v1/importSettingsProjectFunction:
     *    post: 
     *      description: This API is used for import all required settings data in project.
     *      tags: [Import Settings APIs]
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/importSettingsProjectFunction'
     *      responses:
     *          "200":
     *              description: status:true/false, statusText:message
     */
    app.post('/api/v1/importSettingsProjectFunction', ctrl.importSettingsProjectFunction);

    /**
     * @swagger
    *  components:
    *    schemas:
    *      importSettings:
    *        type: object
    *        required:
    *          - uid
    *          - companyId
    *        properties:
    *         uid:
    *           type: string
    *           required: true
    *           description: The uid of user.
    *         companyId:
    *           type: string
    *           required: true
    *           description: The company Id.
    *         email:
    *           type: string
    *           required: true
    *           description: Provide user email address.
    *         rules:
    *           type: array
    *           items:
    *               type: string
    *           required: false
    *           description: This parameter is used to import specific list of collections or all the data import. This field is an array.
     */
    /**
     * @swagger
     *  /api/v1/importSettingsNotification:
     *    post: 
     *      description: This API is used for import notification setting.
     *      tags: [Import Settings Notification APIs]
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/importSettingsNotification'
     *      responses:
     *          "200":
     *              description: status:true/false, statusText:message
     */
        app.post('/api/v1/importSettingsNotification', ctrl.importSettingsNotification);
};