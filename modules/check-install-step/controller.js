
const { exec } = require('child_process');
const path = require("path");
const fs = require('fs');
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");
const { S3Client, CreateBucketCommand } = require('@aws-sdk/client-s3');
const admin1 = require("firebase-admin");
const axios = require('axios');
const { emitListener } = require("./event-controller.js");
const installStepsFilePath = __dirname + "/../../installationSteps.json";
const serviceFun = require("../serviceFunction.js");
const pjson = require('../../package.json');
const { requestHandler } = require('../../Config/config.js');
const aiModals = require('../../utils/aiModals.json');
const { makeUniqueId } = require('../../utils/commonFunctions.js');

exports.envVar = {
    "JWT_SECRET": require('crypto').randomBytes(16).toString('hex'),
    "PRECOMPANYKEY": require('crypto').randomBytes(4).toString('hex'),
    "WEBURL": `${process.env.APIURL.substring(0, process.env.APIURL.length - 1)}`, // Static discussion
}

exports.tmpInstallSteps = [{
    step: 1,
    status: 'done',
    subStep: []
}, {
    step: 2,
    status: 'todo',
    subStep: []
}, {
    step: 3,
    status: 'todo',
    subStep: []
}, {
    step: 4,
    status: 'todo',
    subStep: []
}, {
    step: 5,
    status: 'todo',
    subStep: []
}, {
    step: 6,
    status: 'todo',
    subStep: []
}, {
    step: 7,
    status: 'todo',
    subStep: []
}, {
    step: 8,
    status: 'todo',
    subStep: []
}, {
    step: 9,
    status: 'todo',
    subStep: []
}];
exports.installSteps = [];

exports.getInstallationData = () => {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(installStepsFilePath)) {
            serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: exports.tmpInstallSteps, envVar: exports.envVar}, null, 4), () => {
                resolve({
                    installSteps: exports.tmpInstallSteps,
                    envVar: exports.envVar
                });
            });
        } else {
            fs.readFile(installStepsFilePath, (err, data) => {
                if (err) {
                    resolve({
                        installSteps: exports.tmpInstallSteps,
                        envVar: exports.envVar
                    });
                    return;
                } else {
                    const tmpData = JSON.parse(data.toString());
                    let tenvVar = {};
                    let tinstallSteps = [];
                    if (tmpData.envVar) {
                        tenvVar = tmpData.envVar;
                    }
                    if (tmpData.installSteps) {
                        tinstallSteps = tmpData.installSteps;
                    }
                    resolve({
                        installSteps: tinstallSteps,
                        envVar: tenvVar
                    });
                }
            })
        }
    })
}


exports.initDataRoute = async () => {
    const datata =  await exports.getInstallationData();
    exports.installSteps = datata.installSteps;
    exports.envVar = datata.envVar;
}
exports.smtpVerificationCode = "";

/**
 * Install Step Get
 * @param {Object} req 
 * @param {Object} res 
 */
exports.installstepget = (req, res) => {
    try {
        let finalData = [];
        fs.readFile(installStepsFilePath, (err, data) => {
            if (err) {
                finalData = exports.installSteps;
            } else {
                const tmpData = JSON.parse(data.toString());
                finalData = tmpData.installSteps.length ? tmpData.installSteps : exports.installSteps;
            }
            res.json({
                status: true,
                data: finalData
            });
        })
    } catch (error) {
        console.error('Install Step Get Error 2: ', error.message);
        res.json({
            status: false,
            error: error.message,
            step: 1
        });
    }
};


/**
 * Check Mongo Connection
 * @param {Object} cb 
 * @returns 
 */
exports.checkMongoConnection = (req, cb) => {
    try {
        const bodyData = req.body;
        const mongoURL = bodyData.mongodbUrl;
        if (!mongoURL) {
            cb({
                status: false,
                error: "Please provide a mongo url.",
                step: 2
            });
            return;
        }
        mongoose.connect(mongoURL, {}).then(() => {
            exports.envVar.MONGODB_URL = bodyData.mongodbUrl; // Done
            serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: exports.installSteps, envVar: exports.envVar}, null, 4), () => {
                cb({
                    status: true,
                    statusText: "MongoDB Connected",
                    step: 2
                });
            });
        }).catch((error) => {
            console.error('Check Mongo Connection Error: 1', error);
            cb({
                status: false,
                error: "Please check your mongodb Url",
                step: 2
            });
        });
    } catch (error) {
        console.error('Check Mongo Connection Error 2: ', error.message);
        cb({
            status: false,
            error: error?.message,
            step: 2
        });
    }
};


/**
 * Check Storage Connection
 * @param {Object} cb 
 */
exports.checkStorageConnection = (req, cb) => {
    try {
        const bodyData = req.body;
        if (bodyData.chooseStorage === "default") {
            exports.envVar.WASABI_SECRET_ACCESS_KEY = bodyData.wasabiSecretAccessKey || "";
            exports.envVar.WASABI_ACCESS_KEY = bodyData.wasabiAccessKey || "";
            exports.envVar.WASABI_USERID = bodyData.wasabiUserId || "";
            exports.envVar.STORAGE_TYPE = "server";
            serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: exports.installSteps, envVar: exports.envVar}, null, 4), () => {
                cb({
                    status: true,
                    statusText: "Server Storage Connected",
                    data: bodyData,
                    step: 3
                });
            });
            return;
        }


        const s3Client = new S3Client({
            region: process.env.WASABI_REGION,
            credentials: {
                accessKeyId: bodyData.wasabiAccessKey,
                secretAccessKey: bodyData.wasabiSecretAccessKey,
            },
            endpoint: process.env.WASABIENDPOINT,
            requestHandler
        });
        // Create Wasabi Bucket
        const userBucketName = `user_images_${makeUniqueId(6)}`;
        const command = new CreateBucketCommand({ Bucket: userBucketName });
        s3Client.send(command).then((data) => {
            exports.envVar.WASABI_SECRET_ACCESS_KEY = bodyData.wasabiSecretAccessKey;
            exports.envVar.WASABI_ACCESS_KEY = bodyData.wasabiAccessKey;
            exports.envVar.WASABI_USERID = bodyData.wasabiUserId;
            exports.envVar.STORAGE_TYPE = "wasabi";
            exports.envVar.USERPROFILEBUCKET = userBucketName;
            serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: exports.installSteps, envVar: exports.envVar}, null, 4), () => {
                cb({
                    status: true,
                    statusText: "Wasabi Connected",
                    data,
                    step: 3
                });
            });
        }).catch((error) => {
            console.error('Check Wasabi Connection Error 1: ', error);
            cb({
                status: false,
                error: error?.message || error,
                step: 3
            });
        });
    } catch (error) {
        console.error('Check Wasabi Connection Error 2: ', error.message);
        cb({
            status: false,
            error: error.message,
            step: 3
        });
    }
};


/**
 * Check Firebase Connection
 * @param {Object} cb 
 */
exports.checkFirebaseConnection = async (req, cb) => {
    try {
        const bodyData = req.body;
        const serviceAccount = require("../"+process.env.SERVICE_FILE);
        admin1.initializeApp({
            credential: admin1.credential.cert(serviceAccount)
        }, "install-step-firebase"+ new Date().getTime());
        exports.envVar.APIKEY = bodyData.apiKey;
        exports.envVar.AUTODOMAIN = bodyData.autoDomain;
        exports.envVar.PROJECTID = bodyData.projectId;
        exports.envVar.STORAGEBUCKET = bodyData.storageBucket;
        exports.envVar.MESSAGINGSENDERID = bodyData.messageingSenderId;
        exports.envVar.APPID = bodyData.appId;
        exports.envVar.MEASUREMENTID = bodyData.measurementId;
        serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: exports.installSteps, envVar: exports.envVar}, null, 4), () => {
            cb({
                status: true,
                statusText: "Firebase Connected",
                step: 4
            });
        });
    } catch (error) {
        console.error('Check Firebase Connection Error 2: ', error.message);
        cb({
            status: false,
            error: error.message,
            step: 4
        });
    }
};


/**
 * Check AI Connection
 * @param {Object} cb 
 */
exports.checkAIConnection = (req, cb) => {
    try {
        const bodyData = req.body;
        let config = {
            method: 'get',
            url: 'https://api.openai.com/v1/engines',
            headers: { 
                'Authorization': 'Bearer ' + bodyData.aiToken,
                'Content-Type': 'application/json'
            }
        };
        
        axios.request(config).then((response) => {
            if (response?.status !== 200) {
                console.error('Check AI Connection Error 0: ', response?.status);
                cb({
                    status: false,
                    error: "Incorrect API key. Please check your key and try again",
                    step: 6
                });
                return;
            }
            exports.envVar.AI_API_KEY = bodyData.aiToken;
            exports.envVar.AI_MODEL = bodyData.aiModel;
            serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: exports.installSteps, envVar: exports.envVar}, null, 4), () => {
                cb({
                    status: true,
                    statusText: "AI Connected",
                    step: 6
                });
            });
        })
        .catch((error) => {
            console.error('Check AI Connection Error 1: ', error.response);
            cb({
                status: false,
                error: "Incorrect API key. Please check your key and try again",
                step: 6
            });
        });
    } catch (error) {
        console.error('Check Firebase Connection Error 2: ', error.message);
        cb({
            status: false,
            error: error.message,
            step: 6
        });
    }
};


/**
 * Check SMTP Connection
 * @param {Object} cb 
 */
exports.checkSMTPConnection = async (bodyData, cb) => {
    try {
        const code = ("" + Math.random()).substring(2, 8);
        exports.smtpVerificationCode = code;
        let html = "<h1>SMTP Verification Mail</h1>";
        html += `<h2>Your Verification code is <b>${code}</b></h2>`;
        let transporter = nodemailer.createTransport({
            host: bodyData.smtpHost,
            port: bodyData.smtpPort,
            secure: bodyData.smtpPort == 465, // true for 465, false for other ports
            auth: {
                user: bodyData.smtpEmail, // generated ethereal user
                pass: bodyData.smtpEmailPassword, // generated ethereal password
            },
            tls: {
                rejectUnauthorized: false
            }
        });
        const isHtml = true;
        await transporter.sendMail({
            from: ""+'<'+bodyData.smtpEmail+'>', // sender address
            to: bodyData.toEmail, // list of receivers
            subject: "SMTP Verification Mail", // Subject line
            [isHtml ? "html" : "text"]: html
        },(err, res)=>{
            if (err) {
                cb({
                    status:false,
                    error: err,
                })
            } else {
                exports.envVar.NODEMAILER_EMAIL = bodyData.smtpEmail;
                exports.envVar.NODEMAILER_EMAIL_PASSWORD = bodyData.smtpEmailPassword;
                exports.envVar.NODEMAILER_HOST = bodyData.smtpHost;
                exports.envVar.NODEMAILER_PORT = Number(bodyData.smtpPort);
                serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: exports.installSteps, envVar: exports.envVar}, null, 4), () => {
                    cb({
                        status: true,
                        data: res,
                        statusText: "SMTP Connected"
                    })
                });
            }
        });
    } catch (error) {
        console.error('Check SMTP Connection Error 2: ', error.message);
        cb({
            status: false,
            error: error.message
        });
    }
};


/**
 * Check Token Connection
 * @param {Object} cb 
 */
exports.checkTokenConnection = (req, cb) => {
    try {
        cb({
            status: true,
            statusText: "Token Connected",
            data: response?.data || response,
        });

    } catch (error) {
        console.error('Check Token Connection Error 2: ', error.message);
        cb({
            status: false,
            error: error.message,
            step: 5
        });
    }
};


/**
 * Generate Build Frontend
 * @param {Object} cb 
 */
exports.generateBuildFrontend = (cb) => {
    try {
        console.log("Start Build");
        const vueProjectDirectory = __dirname + '/../../frontend';
        const writePublicFilePath = __dirname + '/../../frontend/public/firebase-messaging-sw.js';
        const buildCommand = 'npm run build';
        const removeDist = `${__dirname}/../../installation`;
        const bdCode = `importScripts('https://www.gstatic.com/firebasejs/9.1.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.1.1/firebase-messaging-compat.js');
let firebaseConfig = {
  apiKey: "${process.env.APIKEY}",
  authDomain: "${process.env.AUTODOMAIN}",
  projectId: "${process.env.PROJECTID}",
  storageBucket: "${process.env.STORAGEBUCKET}",
  messagingSenderId: "${process.env.MESSAGINGSENDERID}",
  appId: "${process.env.APPID}",
  measurementId: "${process.env.MEASUREMENTID}"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// ACTIVATION
self.addEventListener('activate', () => {
  console.log('Service worker activated');
});

// CLICK HANDLER
self.addEventListener('notificationclick', function (event) {
  const notificationData = event.notification.data;
  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "companyId": notificationData.cId
  };
  const key = notificationData.key;
  const markObj = {
    id: notificationData.nId,
    key: key,
    userId: notificationData.uId,
    isClickPush: true,
    commentsId: notificationData.commentsId || ""
  };
  fetch(notificationData.domainURL + "api/v1/push-mark-read", {
    method: "PUT",
    headers,
    body: JSON.stringify(markObj),
  }).then(() => {
    let mentionCounts = {
      companyId : notificationData.cId,
      key : key === 'notifications' ? 5 : 4,
      userIds: [notificationData.uId],
      readAll: false,
      read: true
    }
    fetch(notificationData.domainURL + "api/v1/pushupdateunreadcommentscount", {
      method: "POST",
      headers,
      body: JSON.stringify(mentionCounts),
    })
    .catch((error) => console.error("Fetch error:", error));
  }).catch((error) => console.error("Fetch error:", error));
  event.notification.close();
  const redirectionUrl = event.notification.data['click_action'];
  if (redirectionUrl !== undefined) {
    event.waitUntil(
      clients.openWindow(redirectionUrl)
    );
  }
});

// NOTIFICATION HANDLER
self.addEventListener('push', event => {
  const data = event.data.json();
  const notificationData = data?.data ? data.data : data.notification
  const title = notificationData?.title || 'Notification';
  const options = {
    body: notificationData.body || 'New notification received',
    icon: notificationData.icon || './logo.png',
    data: notificationData,
    sound: "default"
  };
  if (notificationData.image) {
    options.image = notificationData.image;
  }
  event.waitUntil(self.registration.showNotification(title, options));
})`
        
        // Change the current working directory to the Vue project directory
        process.chdir(vueProjectDirectory);

        const filePathEnv = __dirname + '/../../frontend/.env';
        let data = "# Environment Configrations\n";
        data += `VUE_APP_ENVIRONMENT='${process.env.NODE_ENV}'\n\n`;
        data += "# Firebase Configrations\n";
        data += `VUE_APP_APIKEY='${process.env.APIKEY}'\n`
        data += `VUE_APP_AUTHDOMAIN='${process.env.AUTODOMAIN}'\n`;
        data += `VUE_APP_PROJECTID='${process.env.PROJECTID}'\n`;
        data += `VUE_APP_STORAGEBUCKET='${process.env.STORAGEBUCKET}'\n`;
        data += `VUE_APP_MESSAGINGSENDERID='${process.env.MESSAGINGSENDERID}'\n`;
        data += `VUE_APP_APPID='${process.env.APPID}'\n`;
        data += `VUE_APP_MEASUREMENTID='${process.env.MEASUREMENTID}'\n\n`;
        data += "# Chargbee Configrations\n";
        data += `VUE_APP_STORAGE_TYPE='${process.env.STORAGE_TYPE}'\n`;
        data += `VUE_APP_AFFILIATEON='false'\n`;

        fs.writeFile(filePathEnv, data, (err, data) => {
            if (err) {
                console.log("Error Generate FrontEnd ENV", err);
                cb({
                    status: false,
                    error: `Error Generate FrontEnd ENV: ${err}`
                });
                return;
            }
            console.log("End Generate FrontEnd ENV");
            // Write Public Firebase message
            fs.writeFile(writePublicFilePath, bdCode, (err) => {
                if (err) {
                    cb({
                        status: false,
                        error: `Error Generate Public File: ${err}`
                    })
                    return
                }
                exec(buildCommand, (buildError, buildStdout, buildStderr) => {
                    if (buildError) {
                        cb({
                            status: false,
                            error: `Error generating Vue build: ${buildError}`
                        })
                        return;
                    }
                    console.log(`Vue build generated: ${buildStdout}`);
                    if (fs.existsSync(removeDist)) {
                        fs.rmdir(removeDist, {recursive: true, force: true}, (error) => { 
                            if (error) { 
                                console.log(error); 
                                cb({
                                    status: false,
                                    error: `Error Remove Dist Folder: ${error}`
                                })
                            } else { 
                                console.log("Non Recursive: Directories Deleted!"); 
                                cb({
                                    status: true,
                                    buildStdout: buildStdout,
                                    statusText: `Generated:`
                                });
                            } 
                        });
                    } else {
                        cb({
                            status: true,
                            buildStdout: buildStdout,
                            statusText: `Generated:`
                        });
                    }
                });
            });
        })
    } catch (error) {
        cb({
            status: false,
            error: error
        });
    }
};


/**
 * Check Install Step
 * @param {Object} req 
 * @param {Object} res 
 */
exports.checkinstallstep = (req, res) => {
    const bodyData = req.body;
    try {
        if (bodyData.step === 1) {
            exports.installSteps[0].status = "inprogress";
            serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: exports.installSteps, envVar: exports.envVar}, null, 4), () => {
                exports.checkTokenConnection(req, (tokenRes) => {
                    if (tokenRes.status) {
                        exports.installSteps[0].status = "done";
                        serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: exports.installSteps, envVar: exports.envVar}, null, 4), () => {
                            setTimeout(() => {
                                emitListener(bodyData?.eventId, {step: 1});
                            }, 3000);
                            setTimeout(() => {
                                emitListener(bodyData?.eventId, {step: "STOP"});
                                res.json({...tokenRes});
                            }, 5000);
                        });
                        return;
                    }
                    exports.installSteps[0].status = "error";
                    serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: exports.installSteps, envVar: exports.envVar}, null, 4), () => {
                        setTimeout(() => {
                            emitListener(bodyData?.eventId, {step: "STOP", error: tokenRes.error || "Something went wrong; please contact the administrator"});
                            res.json({...tokenRes});
                        }, 3000)
                    });
                });
            });
        }

        if (bodyData.step === 2) {
            exports.installSteps[1].status = "inprogress";
            serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: exports.installSteps, envVar: exports.envVar}, null, 4), () => {
                exports.checkMongoConnection(req, (mongoRes) => {
                    if (mongoRes.status) {
                        exports.installSteps[1].status = "done";
                        serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: exports.installSteps, envVar: exports.envVar}, null, 4), () => {
                            setTimeout(() => {
                                emitListener(bodyData?.eventId, {step: 1});
                            }, 3000);
                            setTimeout(() => {
                                emitListener(bodyData?.eventId, {step: "STOP"});
                                res.json({...mongoRes});
                            }, 5000);
                        });
                        return;
                    }
                    exports.installSteps[1].status = "error";
                    serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: exports.installSteps, envVar: exports.envVar}, null, 4), () => {
                        emitListener(bodyData?.eventId, {step: "STOP", error: mongoRes.error || "Something went wrong; please contact the administrator"});
                        res.json(mongoRes);
                    });
                });
            });
        }

        if (bodyData.step === 3) {
            exports.installSteps[2].status = "inprogress";
            serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: exports.installSteps, envVar: exports.envVar}, null, 4), () => {
                exports.checkStorageConnection(req, (wasabiRes) => {
                    if (wasabiRes.status) {
                        exports.installSteps[2].status = "done";
                        serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: exports.installSteps, envVar: exports.envVar}, null, 4), () => {
                            setTimeout(() => {
                                emitListener(bodyData?.eventId, {step: 1});
                            }, 3000);
                            setTimeout(() => {
                                emitListener(bodyData?.eventId, {step: "STOP"});
                                res.json({...wasabiRes});
                            }, 5000);
                        });
                        return;
                    }
                    exports.installSteps[2].status = "error";
                    serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: exports.installSteps, envVar: exports.envVar}, null, 4), () => {
                        emitListener(bodyData?.eventId, {step: "STOP", error: wasabiRes.error || "Something went wrong; please contact the administrator"});
                        res.json(wasabiRes);
                    });
                });
            });
        }

        if (bodyData.step === 4) {
            exports.installSteps[3].status = "inprogress";
            serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: exports.installSteps, envVar: exports.envVar}, null, 4), () => {
                exports.checkFirebaseConnection(req, (firebaseRes) => {
                    if (firebaseRes.status) {
                        exports.installSteps[3].status = "done";
                        serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: exports.installSteps, envVar: exports.envVar}, null, 4), () => {
                            setTimeout(() => {
                                emitListener(bodyData?.eventId, {step: 1});
                            }, 3000);
                            setTimeout(() => {
                                emitListener(bodyData?.eventId, {step: "STOP"});
                                res.json({...firebaseRes});
                            }, 5000);
                        });
                        return;
                    }
                    exports.installSteps[3].status = "error";
                    serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: exports.installSteps, envVar: exports.envVar}, null, 4), () => {
                        emitListener(bodyData?.eventId, {step: "STOP", error: firebaseRes.error || "Something went wrong; please contact the administrator"});
                        res.json(firebaseRes);
                    });
                });
            });
        }

        if (bodyData.step === 5) {
            if (bodyData.isDoItLater) {
                exports.installSteps[4].status = "done";
                exports.envVar.AI_API_KEY ="";
                exports.envVar.AI_MODEL = "";
                serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: exports.installSteps, envVar: exports.envVar}, null, 4), () => {
                    setTimeout(() => {
                        emitListener(bodyData?.eventId, {step: 1});
                    }, 1000);
                    setTimeout(() => {
                        emitListener(bodyData?.eventId, {step: "STOP"});
                        res.json({...bodyData, status: true, statusText: "AI Connected", step: 6 });
                    }, 2000);
                });
            } else {
                exports.installSteps[4].status = "inprogress";
                serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: exports.installSteps, envVar: exports.envVar}, null, 4), () => {
                    exports.checkAIConnection(req, (aiRes) => {
                        if (aiRes.status) {
                            exports.installSteps[4].status = "done";
                            serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: exports.installSteps, envVar: exports.envVar}, null, 4), () => {
                                setTimeout(() => {
                                    emitListener(bodyData?.eventId, {step: 1});
                                }, 3000);
                                setTimeout(() => {
                                    emitListener(bodyData?.eventId, {step: "STOP"});
                                    res.json({...aiRes});
                                }, 5000);
                            });
                            return;
                        }
                        exports.installSteps[4].status = "error";
                        serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: exports.installSteps, envVar: exports.envVar}, null, 4), () => {
                            emitListener(bodyData?.eventId, {step: "STOP", error: aiRes.error || "Something went wrong; please contact the administrator"});
                            res.json(aiRes);
                        });
                    });
                });
            }
        }

        if (bodyData.step === 6) {
            exports.installSteps[5].status = "inprogress";
            serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: exports.installSteps, envVar: exports.envVar}, null, 4), () => {
                if (bodyData.key === 1) {
                    if (!(bodyData && bodyData.toEmail)) {
                        res.json({
                            status: false,
                            error: "Email is Required."
                        })
                        return;
                    }
                    if (!(bodyData && bodyData.smtpEmail)) {
                        res.json({
                            status: false,
                            error: "smtpEmail is Required."
                        })
                        return;
                    }
                    if (!(bodyData && bodyData.smtpEmailPassword)) {
                        res.json({
                            status: false,
                            error: "smtpEmailPassword is Required."
                        })
                        return;
                    }
                    if (!(bodyData && bodyData.smtpHost)) {
                        res.json({
                            status: false,
                            error: "smtpHost is Required."
                        })
                        return;
                    }
                    if (!(bodyData && bodyData.smtpPort)) {
                        res.json({
                            status: false,
                            error: "smtpPort is Required."
                        })
                        return;
                    }
                    exports.checkSMTPConnection(bodyData, (smtpRes) => {
                        if (smtpRes.status) {
                            res.json({...smtpRes});
                            return;
                        }
                        exports.installSteps[5].status = "error";
                        serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: exports.installSteps, envVar: exports.envVar}, null, 4), () => {
                            res.json({...smtpRes});
                        });
                    });
                }
                if (bodyData.key === 2) {
                    if (!(bodyData && bodyData.code)) {
                        res.json({
                            status: false,
                            error: "Verification code is Required."
                        })
                        return;
                    }
    
                    if (exports.smtpVerificationCode === bodyData.code) {
                        exports.installSteps[5].status = "done";
                        serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: exports.installSteps, envVar: exports.envVar}, null, 4), () => {
                            res.json({
                                status: true,
                                data: bodyData,
                                statusText: "Code verified"
                            });
                        });
                    } else {
                        exports.installSteps[5].status = "error";
                        serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: exports.installSteps, envVar: exports.envVar}, null, 4), () => {
                            res.json({
                                status: false,
                                error: "Your code is invalid"
                            });
                        });
                    }
                }
            });
        }

        if (bodyData.step === 7) {
            exports.installSteps[6].status = "inprogress";
            serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: exports.installSteps, envVar: exports.envVar}, null, 4), () => {
                function convertToEnv (object) {
                    let envFile = ''
                    for (const key of Object.keys(object)) {
                        if (typeof object[key] == 'number') {
                            envFile += `${key}=${object[key]}\n`;
                        } else {
                            envFile += `${key}="${object[key]}"\n`;
                        }
                    }
                    return envFile
                }
    
                // Get ENV data
                const filePath = __dirname + "/../../.env";
                const envFile = fs.readFileSync(filePath);
                const envConfig = require('dotenv').parse(envFile);
                envConfig.PORT = Number(envConfig.PORT);
                envConfig.NOOFPRESETCOMPANY = Number(envConfig.NOOFPRESETCOMPANY);
                const envData = {};
                for (const key in envConfig) {
                    envData[key] = envConfig[key];
                };
                for (const key in exports.envVar) {
                    process.env[key] = exports.envVar[key];
                };
    
                const finalEnvData = {...envData, ...exports.envVar};
                fs.writeFile(filePath, convertToEnv(finalEnvData), (err, data) => {
                    if (err) {
                        console.log("Error Generate FrontEnd ENV", err);
                        exports.installSteps[6].status = "error";
                        serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: exports.installSteps, envVar: exports.envVar}, null, 4), () => {
                            emitListener(bodyData?.eventId, {step: "STOP", error: err || "Something went wrong; please contact the administrator"});
                            res.json({
                                status: false,
                                error: err
                            });
                        });
                        return;
                    }
                    console.log("End Generate FrontEnd ENV");
                    setTimeout(() => {
                        const { startInitialization } = require('./initalizations.js');
                        startInitialization().then(() => {
                            exports.installSteps[6].status = "done";
                            serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: exports.installSteps, envVar: exports.envVar}, null, 4), () => {
                                setTimeout(() => {
                                    emitListener(bodyData?.eventId, {step: 1});
                                }, 3000);
                                setTimeout(() => {
                                    emitListener(bodyData?.eventId, {step: "STOP"});
                                    res.json({
                                        status: true
                                    });
                                }, 5000);
                            });
                        }).catch((error) => {
                            exports.installSteps[6].status = "error";
                            serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: exports.installSteps, envVar: exports.envVar}, null, 4), () => {
                                emitListener(bodyData?.eventId, {step: "STOP", error: error || "Something went wrong; please contact the administrator"});
                                res.json({
                                    status: false,
                                    error: error
                                });
                            });
                        });
                    }, 5000);
                })
            });
        }

        if (bodyData.step === 9) {
            exports.installSteps[8].status = "inprogress";
            serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: exports.installSteps, envVar: exports.envVar}, null, 4), () => {
                exports.generateBuildFrontend((generateRes) => {
                    exports.installSteps[8].status = "done";
                    serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: exports.installSteps, envVar: exports.envVar}, null, 4), () => {
                        // Remove InstallSteps File
                        fs.unlinkSync(installStepsFilePath);
                        setTimeout(() => {
                            emitListener(bodyData?.eventId, {step: 1});
                        }, 3000);
                        setTimeout(() => {
                            emitListener(bodyData?.eventId, {step: "STOP"});
                            res.json({...generateRes});
                            process.exit();
                        }, 5000);
                    });
                });
            });
        }
    } catch (error) {
        console.log("error.message", error.message || error);
        exports.installSteps[bodyData.step-1].status = "error";
        serviceFun.writeFile(installStepsFilePath, JSON.stringify({installSteps: exports.installSteps, envVar: exports.envVar}, null, 4), () => {
            res.json({
                status: false,
                error: error
            });
        });
    }
};


/**
 * Get Ai Models
 * @param {Object} req 
 * @param {Object} res 
 */
exports.getAiModels = (req, res) => {
    try {
        res.json({
            status: true,
            data: aiModals
        });
    } catch (error) {
        console.log("error.message", error.message || error);
        res.json({
            status: false,
            error: error?.message || error
        });
    }
};
