import axios from 'axios';
import getConfig from "next/config";
import { addToQueue, formDataToObject } from './apiQueue';
const { publicRuntimeConfig, serverRuntimeConfig } = getConfig();
const { APIURL } = publicRuntimeConfig
const apiHost = APIURL;
import store from '../store/store';
import { getStore } from '../store/store';
import { logoutFunction } from '../controller/user/user';
import Router from 'next/router';
import { setInternetLost, setShowOfflineQueueScreen } from '../store/authSlice';
export const axiosInstance = axios.create({ baseURL: apiHost })
export const axiosInstanceWithoutCompany = axios.create({ baseURL: apiHost })
export const axiosInstanceWithFormData = axios.create({ baseURL: apiHost })
export const axiosInstanceWithoutSecure = axios.create({ baseURL: apiHost });
export const axiosInstanceWithoutSecureWithFormData = axios.create({ baseURL: apiHost });
axiosInstance.interceptors.request.use((req) => {
    const token = localStorage.getItem('token') || "";
    const companyId = localStorage.getItem("companyId")
    
    const headers = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
        'companyId': companyId
    }
    req.headers = headers;
    return req;
}, error => {
    return Promise.reject(error);
});
axiosInstanceWithFormData.interceptors.request.use((req) => {
    const token = localStorage.getItem('token') || "";
    const companyId = localStorage.getItem("companyId")
    const headers = {
        "Content-Type":"multipart/form-data",
        'Authorization': 'Bearer ' + token,
        'companyId': companyId
    }
    req.headers = headers;
    return req;
}, error => {
    return Promise.reject(error);
});


axiosInstanceWithoutCompany.interceptors.request.use((req) => {
    const token = localStorage.getItem('token') || "";
    const headers = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
    }
    req.headers = headers;
    return req;
}, error => {
    return Promise.reject(error);
});

axiosInstanceWithoutSecureWithFormData.interceptors.request.use((req) => {
    const headers = {
        'Content-Type': 'multipart/form-data'
    }
    req.headers = headers;
    return req;
}, error => {
    return Promise.reject(error);
});

axiosInstanceWithoutSecure.interceptors.request.use((req) => {
    const headers = {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
    }
    req.headers = headers;
    return req;
}, error => {
    return Promise.reject(error);
});

let pendingAuth = null;

export const getAuth = (id) => {
    if (!pendingAuth) {
        pendingAuth = requestAuth(id).finally(() => { pendingAuth = null; });
    }
    return pendingAuth;
};

const requestAuth = (id) => {
    const refreshToken = localStorage.getItem("refreshToken") || '';
    return new Promise((resolve, reject) => {
        let data = {
            uid: id
        };
        let headers = {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'refresh-token': refreshToken
        };
        let url = "/api/v2/generateToken";
        axios.post(apiHost + url, data, { headers }).then((result) => {
            localStorage.setItem('token', result.data.token)
            if (result.data.refreshToken) {
                localStorage.setItem('refreshToken', result.data.refreshToken)
            }
            resolve(result.data);
        }).catch((error) => {
            console.error('error', error);
            if (error?.response?.data?.isLogout) {
                pendingAuth = null;
                logoutFunction()
                .then(() => {
                    Router.push('/login');
                })
                .catch((error) => {
                    console.error("ERROR: ", error);
                });
            } else {
                reject(error);
            }
        });
    })
};

export const apiRequest = (type, endPoint, data, dataType) => {
    return new Promise((resolve, reject) => {
        try {
            if (type === 'post' || type === 'patch' || type === 'get') {
                let fReq;
                if (dataType === 'form') {
                    fReq = axiosInstanceWithFormData[type](endPoint, data)
                } else {
                    fReq = axiosInstance[type](endPoint, data)
                }
                
                fReq.then((resData) => {
                    resolve(resData);
                })
                .catch(async (err) => {
                    console.error("resData===============>capture API ERROR",err)
                    if (err?.response?.data?.isLogout) {
                        logoutFunction()
                        .then(() => {
                            Router.push('/login');
                        })
                        .catch((error) => {
                            console.error("ERROR: ", error);
                        });
                    }else if (err?.response?.data?.isJwtError) {
                        const userId = localStorage.getItem("userId");
                        await getAuth(userId);
                        apiRequest(type, endPoint, data).then((sData)=>{
                            resolve(sData);
                        }).catch((err) => {
                            reject(err);
                        });
                        return;
                    }
                    if (!err.response && err.message && err.message.toLowerCase().includes('network')) {
                        if (endPoint !== '/api/v3/timeTracker/start') {                            
                            const queueData = formDataToObject(data);
                            await addToQueue({ method: 'apiRequest', type, endPoint, data: queueData, dataType });
                        }
                        try {
                            store.dispatch(setInternetLost(true));
                        } catch (error) {
                            console.error(error);                            
                        }
                        console.warn('Network error, request queued:', { type, endPoint });
                        resolve({ queued: true });
                        return;
                    }
                    reject(err);
                });
            } else {
                console.info(type)
            }
        } catch (error) {
            console.error('error', error);
            reject(error);
        }
    })
}
export const apiRequestFormData = (type, endPoint, data, dataType) => {
    return new Promise((resolve, reject) => {
        try {
            if (type === 'post' || type === 'patch') {
                let fReq = axiosInstance[type](endPoint, data)
                if (dataType === 'form') {
                    fReq = axiosInstanceWithFormData[type](endPoint, data)
                }
                
                fReq.then((resData) => {
                    resolve(resData);
                })
                .catch(async (err) => {
                    console.error("resData===============>capture API ERROR",err)
                    if (err?.response?.data?.isLogout) {
                        logoutFunction()
                        .then(() => {
                            Router.push('/login');
                        })
                        .catch((error) => {
                            console.error("ERROR: ", error);
                        });
                    }else if (err?.response?.data?.isJwtError) {
                        const userId = localStorage.getItem("userId");
                        await getAuth(userId);
                        apiRequest(type, endPoint, data).then((sData)=>{
                            resolve(sData);
                        }).catch((err) => {
                            reject(err);
                        });
                        return;
                    }
                    if (!err.response && err.message && err.message.toLowerCase().includes('network')) {
                        const queueData = formDataToObject(data);
                        await addToQueue({ method: 'apiRequestFormData', type, endPoint, data: queueData, dataType });
                        store.dispatch(setInternetLost(true));
                        console.warn('Network error, request queued:', { type, endPoint });
                        resolve({ queued: true });
                        return;
                    }
                    reject(err);
                });
            } else {
                console.info(type)
            }
        } catch (error) {
            console.error('error', error);
            reject(error);
        }
    })
}

export const apiRequestWithoutCompnay = (type, endPoint, data) => {
    return new Promise((resolve, reject) => {
        try {
            if (type === 'post' || type === 'patch' || type === 'get') {
                axiosInstanceWithoutCompany[type](endPoint, data)
                    .then((resData) => {
                        resolve(resData);
                    })
                    .catch(async (err) => {
                        if (err?.response?.data?.isLogout) {
                            logoutFunction()
                            .then(() => {
                                Router.push('/login');
                            })
                            .catch((error) => {
                                console.error("ERROR: ", error);
                            });
                        } else if (err?.response?.data?.isJwtError) {
                        const userId = localStorage.getItem("userId");
                        await getAuth(userId);
                        apiRequestWithoutCompnay(type, endPoint, data).then((sData)=>{
                            resolve(sData);
                        }).catch((err) => {
                            reject(err);
                        });
                        return;
                    }
                    if (!err.response && err.message && err.message.toLowerCase().includes('network')) {
                        const queueData = formDataToObject(data);
                        await addToQueue({ method: 'apiRequestWithoutCompnay', type, endPoint, data: queueData });
                        store.dispatch(setShowOfflineQueueScreen(true));
                        store.dispatch(setInternetLost(true));
                        console.warn('Network error, request queued:', { type, endPoint });
                        resolve({ queued: true });
                        return;
                    }
                    reject(err);
                });
            } else {
                console.info(type)
            }
        } catch (error) {
            console.error('error', error);
            reject(error);
        }
    })
}

export const apiRequestWithoutSecure = (type, endPoint, data, dataType) => {
    return new Promise((resolve, reject) => {
        try {
            if (type === 'post' || type === 'patch' || type === 'get' || type === 'delete' || type === 'put') {
                let rData;
                if (dataType === 'form') {
                    rData = axiosInstanceWithoutSecureWithFormData[type](endPoint, data);
                } else {
                    rData = axiosInstanceWithoutSecure[type](endPoint, data);
                }
                rData
                    .then((resData) => {
                        resolve(resData);
                    })
                    .catch(async (err) => {
                           if (!err.response && err.message && err.message.toLowerCase().includes('network')) {
                        const queueData = formDataToObject(data);
                        await addToQueue({ method: 'apiRequestWithoutSecure', type, endPoint, data: queueData });
                        store.dispatch(setInternetLost(true));
                        console.warn('Network error, request queued:', { type, endPoint });
                        resolve({ queued: true });
                        return;
                    }
                        reject(err);
                    });
            } else {
                console.info(type)
                reject("API TYPE NOT FOUND");
            }
        } catch (error) {
            console.error('error', error);
            reject(error);
        }
    })
}