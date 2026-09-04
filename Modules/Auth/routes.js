const ctrl = require('./controller');
const sessionCtr = require('./session');

exports.init = (app) => {

    app.post('/api/v1/removeUserNotification',  ctrl.removeUserNotification);


    /**
     * @swagger
     *  components:
     *    schemas:
     *      registerAuth:
     *        type: object
     *        required:
     *          - email
     *          - password
     *        properties:
     *         email:
     *           type: string
     *           required: true
     *           description: The email of user.
     *         password:
     *           type: string
     *           required: true
     *           description: The password of user.
     */
    /**
     * @swagger
     *  /api/v2/auth/register:
     *    post: 
     *      description: This API is used for register auth.
     *      tags: [Auth APIs]
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/registerAuth'
     *      responses:
     *          "200":
     *              description: status:true, message:message
     */
    app.post("/api/v2/auth/register", ctrl.registerAuth);


    /**
     * @swagger
     *  components:
     *    schemas:
     *      loginAuth:
     *        type: object
     *        required:
     *          - email
     *          - password
     *        properties:
     *         email:
     *           type: string
     *           required: true
     *           description: The email of user.
     *         password:
     *           type: string
     *           required: true
     *           description: The password of user.
     */
    /**
     * @swagger
     *  /api/v2/auth/login:
     *    post: 
     *      description: This API is used for login auth.
     *      tags: [Auth APIs]
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/loginAuth'
     *      responses:
     *          "200":
     *              description: status:true, message:message
     */
    app.post("/api/v2/auth/login", ctrl.loginAuth, ctrl.manageAttempt)
    app.post("/api/v1/auth/loginAuthTracker", ctrl.loginAuthTracker)

    // Two-factor auth (TOTP) — Phase 1, password login only.
    // setup/verify/disable require a logged-in session (gated by
    // verifyJWTTokenWithCV2 via Config/setMiddleware.js); validate is public
    // and exchanges a tempToken + code for a real session, rate-limited like
    // login via manageAttempt.
    app.get("/api/v2/auth/2fa/status", ctrl.twoFaStatus)
    app.post("/api/v2/auth/2fa/setup", ctrl.twoFaSetup)
    app.post("/api/v2/auth/2fa/verify", ctrl.twoFaVerify)
    app.post("/api/v2/auth/2fa/disable", ctrl.twoFaDisable)
    app.post("/api/v2/auth/2fa/validate", ctrl.twoFaValidate, ctrl.manageAttempt)

    // Passwordless login link (public, pre-auth). Enable/disable with MAGIC_LINK_ENABLED.
    app.post("/api/v2/auth/magic-link", ctrl.requestMagicLink)
    app.get("/api/v2/auth/magic-link/verify", ctrl.verifyMagicLink)


    /**
     * @swagger
     *  components:
     *    schemas:
     *      changePasswordAuth:
     *        type: object
     *        required:
     *          - oldPassword
     *          - newPassword
     *        properties:
     *         oldPassword:
     *           type: string
     *           required: true
     *           description: The old password of user.
     *         newPassword:
     *           type: string
     *           required: true
     *           description: The new password of user.
     */
    /**
     * @swagger
     *  /api/v2/auth/{id}/change-password:
     *    patch: 
     *      description: This API is used for login auth.
     *      tags: [Auth APIs]
     *      parameters:
     *        - in: path
     *          name: id
     *          required: true
     *          schema:
     *          type: string
     *          description: The user id
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/changePasswordAuth'
     *      responses:
     *          "200":
     *              description: status:true, message:message
     */
    app.patch("/api/v2/auth/:id/change-password", ctrl.changePassword);


    /**
     * @swagger
     *  components:
     *    schemas:
     *      forgotPasswordAuth:
     *        type: object
     *        required:
     *          - email
     *        properties:
     *         email:
     *           type: string
     *           required: true
     *           description: The email of user.
     */
    /**
     * @swagger
     *  /api/v2/auth/forgot-password:
     *    post: 
     *      description: This API is used for send forgot password mail.
     *      tags: [Auth APIs]
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/forgotPasswordAuth'
     *      responses:
     *          "200":
     *              description: status:true, message:message
     */
    app.post('/api/v2/auth/forgot-password', ctrl.forgotPassword, ctrl.manageAttempt);


    /**
     * @swagger
     *  components:
     *    schemas:
     *      tokenVerifyforgotPasswordAuth:
     *        type: object
     *        required:
     *          - token
     *        properties:
     *         token:
     *           type: string
     *           required: true
     *           description: The token.
     */
    /**
     * @swagger
     *  /api/v2/auth/token-verify-forgotpassword:
     *    post: 
     *      description: This API is used for verify forgot request.
     *      tags: [Auth APIs]
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/tokenVerifyforgotPasswordAuth'
     *      responses:
     *          "200":
     *              description: status:true, message:message
     */
    app.post('/api/v2/auth/token-verify-forgotpassword', ctrl.tokenVerfiyForgotPassword);


    /**
     * @swagger
     *  components:
     *    schemas:
     *      resetPasswordAuth:
     *        type: object
     *        required:
     *          - token
     *          - id
     *          - password
     *        properties:
     *         token:
     *           type: string
     *           required: true
     *           description: The token.
     *         id:
     *           type: string
     *           required: true
     *           description: The User id.
     *         password:
     *           type: string
     *           required: true
     *           description: The user new password.
     */
    /**
     * @swagger
     *  /api/v2/auth/reset-password:
     *    post: 
     *      description: This API is used for verify forgot request.
     *      tags: [Auth APIs]
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/resetPasswordAuth'
     *      responses:
     *          "200":
     *              description: status:true, message:message
     */
    app.post('/api/v2/auth/reset-password', ctrl.resetPassword, ctrl.manageAttempt);


    /**
     * @swagger
     *  components:
     *    schemas:
     *      registerSession:
     *        type: object
     *        required:
     *          - userId
     *        properties:
     *         userId:
     *           type: string
     *           required: true
     *           description: The User Id.
     */
    /**
     * @swagger
     *  /api/v2/session/register:
     *    post: 
     *      description: This API is used for register a session.
     *      tags: [Session APIs]
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/registerSession'
     *      responses:
     *          "200":
     *              description: status:true, message:message
     */
    app.post('/api/v2/session/register', sessionCtr.registerSesstion);


    /**
     * @swagger
     *  /api/v2/session/delete:
     *    delete: 
     *      description: This API is used for delete all session and session caches.
     *      tags: [Session APIs]
     *      responses:
     *          "200":
     *              description: status:true, message:message
     */
    app.delete('/api/v2/session/delete', sessionCtr.deleteAllSession);


    /**
     * @swagger
     *  /api/v2/session/delete/{id}:
     *    delete: 
     *      description: This API is used for delete user specific session and session caches.
     *      tags: [Session APIs]
     *      parameters:
     *        - in: path
     *          name: id
     *          required: true
     *          schema:
     *          type: string
     *          description: The user id
     *      responses:
     *          "200":
     *              description: status:true, message:message
     */
    app.delete('/api/v2/session/delete/:id', sessionCtr.deleteUserSpecificSession);
    app.put('/api/v2/session/update', sessionCtr.updateSession);


    /**
     * @swagger
     *  components:
     *    schemas:
     *      generateTokenSchema:
     *        type: object
     *        required:
     *          - uid
     *        properties:
     *         uid:
     *           type: string
     *           required: true
     *           description: The User Id.
     */
    /**
     * @swagger
     *  /api/v2/generateToken:
     *    post: 
     *      description: This API is used for generate a new access token.
     *      tags: [Auth APIs]
     *      parameters:
     *        - in: header
     *          name: refresh-token
     *          required: true
     *          schema:
     *            type: string
     *          description: token for refresh-token.
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/generateTokenSchema'
     *      responses:
     *          "200":
     *              description: status:true, token:token
     */
    app.post("/api/v2/generateToken", ctrl.generateTokenV2);
    app.post("/api/v2/logout", ctrl.logout);
    app.post("/api/v2/test", ctrl.testV2);
    initSignup(app);
};

const createUserCtrl = require("./controller/createUser");
const sendVerifcationCtrl = require("./controller/sendVerificationMail");
const verifyEmailCtrl = require("./controller/verifyEmail");
const sendForgotPasswordCtrl = require("./controller/sendForgotPasswordMail");
const mongoRef = require('../../utils/mongo-handler/mongoQueries');
const sendInvitationCtrl = require("./controller/sendInvitation");
const verifyInvitationCtrl = require("./controller/verifyInvitation");
const { replaceObjectKey } = require("./helper");
const {myCache} = require('../../Config/config');
const logger = require('../../Config/loggerConfig');
const {removeCache} = require('../../utils/commonFunctions');
const { handleEvents } = require('../Company/eventController');
function initSignup(app) {
    app.post("/api/v2/createUser", createUserCtrl.createUserV2);
    /**
     * @swagger
    *  components:
    *    schemas:
    *      sendVerificationEmail:
    *        type: object
    *        required:
    *          - uid
    *          - email
    *        properties:
    *         uid:
    *           type: string
    *           required: true
    *           description: The uid of user.
    *         email:
    *           type: string
    *           required: true
    *           description: The email of user.
     */
    /**
     * @swagger
     *  /api/v2/sendVerificationEmail:
     *    post: 
     *      description: This API is used for send email verication link.
     *      tags: [Mongodb Auth APIs]
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/sendVerificationEmail'
     *      responses:
     *          "200":
     *              description: status:true/false,statusText:message
     */

    /**
     * Send Verification Mail API
     */
    app.post("/api/v2/sendVerificationEmail", sendVerifcationCtrl.sendVerificationEmail);

    /**
     * @swagger
    *  components:
    *    schemas:
    *      verifyEmail:
    *        type: object
    *        required:
    *          - uid
    *          - token
    *        properties:
    *         uid:
    *           type: string
    *           required: true
    *           description: The uid of user.
    *         token:  
    *           type: string
    *           required: true
    *           description: The verification token.
     */           
    /**
     * @swagger
     *  /api/v2/verifyEmail:
     *    post: 
     *      description: This API is used for verify email.
     *      tags: [Mongodb Auth APIs]
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/verifyEmail'
     *      responses:
     *          "200":
     *              description: status:true/false,statusText:message
     */

    /**
     *  Verify Mail API
     */
    app.post('/api/v2/verifyEmail', verifyEmailCtrl.verifyEmail);


     /**
     * @swagger
    *  components:
    *    schemas:
    *      sendForgotPasswordEmail:
    *        type: object
    *        required:
    *          - email
    *          - token
    *          - tokenId
    *        properties:
    *         email:
    *           type: string
    *           required: true
    *           description: The email of user.
    *         token:
    *           type: string
    *           required: true
    *           description: The token.
    *         tokenId:
    *           type: string
    *           required: true
    *           description: The tokenId.
    */
    /**
     * @swagger
     *  /api/v2/sendForgotPasswordEmail:
     *    post: 
     *      description: This API is used for resend email verication link if token expire.
     *      tags: [Mongodb Auth APIs]
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/sendForgotPasswordEmail'
     *      responses:
     *          "200":
     *              description: status:true/false,statusText:message
     */

    /**
     *  Verify Mail API
     */
    app.post('/api/v2/sendForgotPasswordEmail', sendForgotPasswordCtrl.sendForgotPasswordEmail);


    /**
     * @swagger
    *  components:
    *    schemas:
    *      sendInvitationEmail:
    *        type: object
    *        required:
    *          - email
    *          - companyId
    *          - companyName
    *          - role
    *          - designation
    *        properties:
    *         email:
    *           type: string
    *           required: true
    *           description: The email of user.
    *         companyId:
    *           type: string
    *           required: true
    *           description: The inviting companyId.
    *         companyName:
    *           type: string
    *           required: true
    *           description: The inviting companyName.
    *         role:
    *           type: string
    *           required: true
    *           description: The provided role id.
    *         designation:
    *           type: string
    *           required: true
    *           description: This is the inviting user designation.
     */
    /**
     * @swagger
     *  /api/v2/sendInvitationEmail:
     *    post: 
     *      description: This API is used for send email invitation link.
     *      tags: [Mongodb Auth APIs]
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/sendInvitationEmail'
     *      responses:
     *          "200":
     *              description: status:true/false,statusText:message
     */

    /**
     * Send Invitation Mail API
     */
    app.post('/api/v2/sendInvitationEmail', sendInvitationCtrl.sendInvitationEmail);
    app.post('/api/v1/checkSendInviatation', sendInvitationCtrl.checkSendInviatation);
    app.post('/api/v1/admin/checkSendInviatation', sendInvitationCtrl.checkSendInviatation);
    app.post('/api/v1/importUser', sendInvitationCtrl.importUser);
    app.get('/importUser/events/:id', (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        handleEvents(req, res)
    });

    /**
     * @swagger
     *  components:
     *    schemas:
     *      checkPermission:
     *            type: object
     *            required: 
     *              -key
     *            properties:
     *              key:
     *               type: string
     *               required: true
     *               description: decrypted.
     */
     /**
     * @swagger 
     *  /api/v2/checkPermission:
     *    post: 
     *      description: This API is check user invitation link is valid or not
     *      tags: [Auth APIs]
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/checkPermission'
     *      responses:
     *          "200":
     *              description: status:true/false,statusText:message,key
     */
     app.post('/api/v2/checkPermission', verifyInvitationCtrl.checkPermission);


    
    /**
     * @swagger
    *  components:
    *    schemas:
    *      mongoOpration:
    *        type: object
    *        required:
    *          - dataObj
    *          - dbName
    *          - methodName
    *        properties:
    *         dataObj:
    *           type: object
    *           required: true
    *           description: The data object which contain type and data keys for mongodb curd opretion.
    *         dbName:
    *           type: string
    *           required: true
    *           description: The name of database.
    *         methodName:
    *           type: string
    *           required: true
    *           description: The name of method of mongodb.
     */
    /**
     * @swagger
     *  /api/v1/mongoOpration:
     *    post: 
     *      description: This API is used for send email invitation link.
     *      tags: [Mongodb Auth APIs]
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/mongoOpration'
     *      responses:
     *          "200":
     *              description: status:true/false,statusText:message
     */

    /**
     * Mongo db curd operation API
     */
    app.post("/api/v1/mongoOpration", (req,res)=>{
        if (!(req.body && req.body.dataObj)) {
            res.send({
                status: false,
                statusText: `DataObject is missing`
            })
            return;
        }
        if (!(req.body && req.body.dbName)) {
            res.send({
                status: false,
                statusText: `dbName is missing`
            })
            return;
        }
        if (!(req.body && req.body.methodName)) {
            res.send({
                status: false,
                statusText: `methodName is missing`
            })
            return;
        }
        if (!(req.body && req.body.collection)) {
            res.send({
                status: false,
                statusText: `collection is missing`
            })
            return;
        }

        mongoRef.MongoDbCrudOpration(req.body.dbName,{type: req.body.collection , data: replaceObjectKey(req.body.dataObj, ["objId"])},req.body.methodName).then((response)=>{
            res.send({
                status: true, 
                statusText: response
            })
            }).catch((error)=>{
            logger.error(`ERR: in request ${req.body.collection} ${req.body.methodName} > ${error?.message ? error.message : error}`);
            res.send({
                status: false,
                statusText: error
            })
        })
    })

    app.post("/api/v1/generateToken", createUserCtrl.generateToken);
    app.post('/api/v1/verifyToken', createUserCtrl.verifyToken);

    app.post('/api/v1/removeCache',(req,res)=>{
        try {
            if (req.body.global) {
                myCache.flushAll();
                return res.status(200).json({ message: 'Global cache cleared successfully' });
            } else {
                if (!(req.body && req.body.cacheKey)) {
                    return res.status(400).json({ message: 'cacheKey is required' });
                }
                removeCache(req.body.cacheKey, req.body.isPrefix ? true : false);
                return res.status(200).json({ message: 'Cache cleared successfully' });
            }
        } catch (error) {
            return res.status(500).json({message: error.message});
        }
    })

    app.post("/api/v2/google-signup", createUserCtrl.googleSignup);
    app.post("/api/v2/github-signup", createUserCtrl.githubSignup);
    app.post("/api/v2/gitlab-signup", createUserCtrl.gitlabSignup);
}
