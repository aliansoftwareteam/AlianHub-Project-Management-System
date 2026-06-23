import axios from 'axios';
import * as env from '@/config/env';
import Cookies from 'js-cookie';
import Store from "@/store/index";
import { useCustomComposable } from '@/composable';
import * as offline from '@/offline';
const { logOut } = useAuth();
const apiHost = env.API_URI;
export const axiosInstance = axios.create({ baseURL: apiHost });
export const axiosInstanceWithFormData = axios.create({ baseURL: apiHost });
export const axiosInstanceWithoutCompany = axios.create({ baseURL: apiHost });
export const axiosInstanceWithoutCompanyWithFormData = axios.create({ baseURL: apiHost });
export const axiosInstanceWithoutSecure = axios.create({ baseURL: apiHost });
export const axiosInstanceWithoutSecureWithFormData = axios.create({ baseURL: apiHost });



axiosInstance.interceptors.request.use((req) => {
    const token = Cookies.get('accessToken') || '';
    const companyId = localStorage.getItem('selectedCompany') || "";
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
    const token = Cookies.get('accessToken') || '';
    const companyId = localStorage.getItem('selectedCompany') || "";
    const headers = {
        'Content-Type': 'multipart/form-data',
        'Authorization': 'Bearer ' + token,
        'companyId': companyId
    }
    req.headers = headers;
    return req;
}, error => {
    return Promise.reject(error);
});

axiosInstanceWithoutCompany.interceptors.request.use((req) => {
    const token = Cookies.get('accessToken') || '';
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

axiosInstanceWithoutCompanyWithFormData.interceptors.request.use((req) => {
    const token = Cookies.get('accessToken') || '';
    const headers = {
        'Content-Type': 'multipart/form-data',
        'Authorization': 'Bearer ' + token
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

axiosInstanceWithoutSecureWithFormData.interceptors.request.use((req) => {
    const headers = {
        'Content-Type': 'multipart/form-data'
    }
    req.headers = headers;
    return req;
}, error => {
    return Promise.reject(error);
});




export const getAuth = async (id,isFirst) => {
    return new Promise((resolve, reject) => {
        let data = {
            uid: id
        };
        const refreshToken = Cookies.get('refreshToken') || '';

        if(refreshToken){
            let headers = {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'refresh-token': refreshToken
            };
            let url = env.GENERATETOKEN_V2;
            axios.post(apiHost + url, data, { headers }).then((result) => {
                if (isFirst) {
                    localStorage.setItem('updateToken', result.data.token)
                }
                resolve(result.data);
            }).catch((error) => {
                console.error('error', error.response.data);
                reject(error.response.data);
                if (error?.response?.data?.isLogout) {
                    logOut();
                }
            });
        } else {
            logOut();
        }
    })
};
const abortControllers={};

function initializeAbortController(options, abortControllers) {
    const abortKey = makeUniqueId(7);
    let signal;
    if (options?.signal) {
        abortControllers[abortKey] = options.signal;
        signal = options.signal;
    } else {
        abortControllers[abortKey] = new AbortController();
        signal = abortControllers[abortKey].signal;
    }
    return { signal, abortKey };
}

export function abortAllRequests() {
    for (const key in abortControllers) {
        try {
            if (abortControllers[key]) {
                abortControllers[key].abort();
                delete abortControllers[key];
            }
        } catch (error) {
            console.error("Error in aborting request", error);
        }
    }
}

const {makeUniqueId} = useCustomComposable();
export const apiRequest = (type, endPoint, data, dataType, options) => {
    return new Promise((resolve, reject) => {
        try {
            if (type === 'post' || type === 'patch' || type === 'get' || type === 'put' || type === 'delete') {
                const { signal, abortKey } = initializeAbortController(options, abortControllers);

                let rData;
                if (dataType === 'form') {
                    rData = axiosInstanceWithFormData[type](endPoint, data, {signal, ...options});
                } else {
                    if (type === 'get') {
                        rData = axiosInstance[type](endPoint, {signal, ...options});
                    } else {
                        rData = axiosInstance[type](endPoint, data, {signal, ...options});
                    }
                }

                rData
                    .then((resData) => {
                        resolve(resData);
                        delete abortControllers[abortKey];
                        offline.maybeCacheResponse(type, endPoint, resData);
                    })
                    .catch(async (err) => {
                        delete abortControllers[abortKey];
                        if(err.code === 'ERR_CANCELED'){
                            return;
                        }
                        if (err?.response?.data?.isLogout) {
                            logOut();
                        }else if (err?.response?.data?.isJwtError) {
                            const userId = localStorage.getItem('userId') || "";
                            await getAuth(userId);
                            apiRequest(type, endPoint, data, dataType, options).then((sData)=>{
                                resolve(sData);
                            }).catch((err) => {
                                reject(err);
                            });
                            return;
                        }
                        const offlineResult = await offline.handleOfflineFailure(type, endPoint, data, dataType, err);
                        if (offlineResult) { resolve(offlineResult); return; }
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

// SEC-06 — let the offline write-queue replay through the real request path.
offline.registerReplayer(apiRequest);


export const apiRequestWithoutCompnay = (type, endPoint, data, dataType,options) => {
    return new Promise((resolve, reject) => {
        try {
            if (type === 'post' || type === 'patch' || type === 'get' || type === 'delete' || type === 'put') {
                const { signal, abortKey } = initializeAbortController(options, abortControllers);
                let rData;
                if (dataType === 'form') {
                    rData = axiosInstanceWithoutCompanyWithFormData[type](endPoint, data);
                } else {
                    if (type === 'get') {
                        rData = axiosInstanceWithoutCompany[type](endPoint, {signal, ...options});
                    } else {
                        rData = axiosInstanceWithoutCompany[type](endPoint, data,{signal, ...options});
                    }
                }
                rData
                    .then((resData) => {
                        delete abortControllers[abortKey];
                        resolve(resData);
                    })
                    .catch(async (err) => {
                        delete abortControllers[abortKey];
                        if(err.code === 'ERR_CANCELED'){
                            return;
                        }
                    if (err?.response?.data?.isLogout) {
                        logOut();
                    } else if (err?.response?.data?.isJwtError) {
                        const userId = localStorage.getItem('userId') || "";
                        await getAuth(userId);
                        apiRequestWithoutCompnay(type, endPoint, data, dataType, options).then((sData)=>{
                            resolve(sData);
                        }).catch((err) => {
                            reject(err);
                        });
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

export function useAuth() {
    const getters = Store.getters;


    const removeLocalValue = (value) => {
        localStorage.removeItem("isLogging");
        localStorage.removeItem("currentUserEmail");
        localStorage.removeItem("SubmenuScreen");
        localStorage.removeItem("selectedCompany");
        localStorage.removeItem("SubmenuScreen");
        localStorage.removeItem("currentLoggedInUserDetails");
        localStorage.removeItem("userId");
        localStorage.removeItem("webTokens");
        localStorage.removeItem("updateToken");
        localStorage.removeItem('logged');
        Cookies.remove('refreshToken');
        Cookies.remove('accessToken');
        try { offline.clearOffline(); } catch (e) { /* offline cleanup best-effort */ }
        if(value?.withOutRefresh !== true){
            window.location.reload();
        }
    };

    async function logOut(data) {
        try {
            const refreshToken = Cookies.get('refreshToken') || '';
            const userId = localStorage.getItem('userId') || '';
            
            const cleanup = async (value) => {
                const socket = getters['settings/getSocketInstance'];
                if(socket?.id){
                    socket.emit('disconnectNameSpace', socket.id);
                }
                removeLocalValue(value);
            };
    
            if (userId && refreshToken && data?.islogOut === true) {
                try {
                    await apiRequestWithoutCompnay("post", env.LOGOUT, {
                        id: userId,
                        refreshToken: refreshToken,
                    });                    
                } catch (error) {
                    console.error('Error in logout', error);
                    cleanup(data);
                }
            }            
            await cleanup(data);
        } catch (error) {
            console.error("ERROR in logout", error);
            removeLocalValue();
        }
    }

    return { logOut };
}