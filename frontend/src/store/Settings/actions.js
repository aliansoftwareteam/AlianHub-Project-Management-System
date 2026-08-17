import { customField } from '../../plugins/customFieldView/helper.js';
import { apiRequest, apiRequestWithoutCompnay } from "@/services/index.js";
import * as env from '@/config/env';
const { setfinalCustomFieldsArray, setCustomFieldsArray } = customField();

export const setRules = ({ commit }) => {
    return new Promise((resolve, reject) => {
        try {
            apiRequest("get", env.RULES).then((res) => {
                if (res.status === 200 && res?.data && res?.data?.length) {
                    resolve(res?.data)
                    commit("mutateArrangedRules", res?.data);
                    res?.data.forEach((x) => {
                        commit("mutateRules", {
                            data: { ...x, _id: x._id },
                            op: "added",
                        })
                    })
                } else {
                    resolve([])
                    commit("mutateArrangedRules", []);
                    commit("mutateRules", {
                        data: [],
                        op: "added",
                    })
                }
            })
                .catch((error) => {
                    reject(error)
                })
        } catch (error) {
            reject(error);
        }
    });
}

export const setProjectRules = ({ commit, state }, payload) => {
    return new Promise((resolve, reject) => {
        try {
            if (state.projectRawRules) {
                state.projectRawRules.forEach((data) => {
                    if (data.projectId == payload.pid) {
                        resolve();
                        return;
                    } else {
                        state.projectRawRules = [];
                        state.projectRules = [];
                    }
                })
            }
            apiRequest("get", `${env.PROJECTRULES}/${payload.pid}`)
                .then((res) => {
                    let data = res.data;
                    resolve(data)
                    commit("mutateArrangeProjectRules", { op: "added", data: data, projectId: payload.pid });
                    data.forEach((x) => {
                        commit("mutateProjectRules", {
                            projectId: payload.pid,
                            data: { ...x, _id: x._id },
                            op: "added",
                        })
                    })
                })
                .catch((error) => {
                    reject(error)
                })
        } catch (error) {
            reject(error);
        }
    });
}

export const setRoles = ({ commit }) => {
    return new Promise((resolve, reject) => {
        try {
            apiRequest("get", env.SETTING_ROLES)
                .then((res) => {
                    if (res.status === 200) {
                        const roles = res.data;
                        commit("mutateRoles", {
                            data: roles[0]?.settings,
                            op: "added"
                        })
                        resolve(roles)
                    } else {
                        resolve([])
                    }
                })
                .catch((error) => {
                    console.error("ERROR in get roles: ", error);
                    reject(error);
                })

        } catch (error) {
            reject(error);
        }
    });
}

export const setCompanyUsers = ({ commit }, payload) => {
    return new Promise((resolve, reject) => {
        try {
            apiRequest("get", env.API_MEMBERS).then((response) => {
                const data = response.data.data;
                data.forEach((x) => {
                    commit("mutateCompanyUsers", {
                        data: { ...x, _id: x._id, isCurrentUser: x.userId === payload.userId, requestId: x._id },
                        op: "added",
                    })
                })
                resolve(data)
            })
                .catch((error) => {
                    console.error("Error in get company member users: ", error);
                    reject(error)
                })
        } catch (error) {
            reject(error);
        }
    });
}

export const setCompanyUserStatus = ({ commit }) => {
    return new Promise((resolve, reject) => {
        try {
            apiRequest('get', env.SETTING_COMPANY_USER_STATUS)
                .then((res) => {
                    if (res.status === 200) {
                        const result = res.data;
                        commit("mutateCompanyUserStatus", {
                            data: result[0]?.settings,
                            op: "added"
                        })
                        resolve(result)
                    } else {
                        resolve([])
                    }
                })
                .catch((error) => {
                    console.error("ERROR in get company user status: ", error);
                    reject(error);
                })
        } catch (error) {
            reject(error);
        }
    });
}

export const setProjectSkills = ({ commit }) => {
    return new Promise((resolve, reject) => {
        try {
            apiRequest("get", env.SETTING_PROJECT_SKILLS)
                .then((res) => {
                    if (res.status === 200) {
                        const data = res.data;
                        commit("mutateProjectSkills", {
                            data: data[0]?.settings || [],
                            op: "inital"
                        })
                        resolve(data[0]);
                    } else {
                        resolve([]);
                    }
                })
                .catch((error) => {
                    console.error("ERROR in get project skills: ", error);
                    reject(error);
                })
        } catch (error) {
            reject(error);
        }
    })
}

export const setDesignations = ({ commit }) => {
    return new Promise((resolve, reject) => {
        try {
            apiRequest("get", env.SETTING_DESIGNATION)
                .then((res) => {
                    if (res.status === 200) {
                        const data = res.data;
                        commit("mutateDesignations", {
                            data: data[0]?.settings,
                            op: "added"
                        })
                        resolve(data[0]);
                    } else {
                        resolve([]);
                    }
                })
                .catch((error) => {
                    console.error("ERROR in get designations: ", error);
                    reject(error);
                })
        } catch (error) {
            reject(error);
        }
    });
}

export const setMileStoneStatus = ({ commit }) => {
    return new Promise((resolve, reject) => {
        try {
            apiRequest("get", env.MILESTONE_STATUS).then((res) => {
                if (res.status === 200 && res?.data && res?.data?.[0].settings?.length) {
                    commit("mutateProjectMilestoneStatus", { data: res?.data[0].settings, op: 'inital' })
                    resolve(res[0]);
                } else {
                    resolve([]);
                }
            }).catch((error) => {
                console.error("ERROR in get ProjectMilestoneStatus: ", error);
                reject(error);
            });
        } catch (error) {
            reject(error);
        }
    });
}

export const setCompanies = ({ commit }, companyIds) => {
    return new Promise((resolve, reject) => {
        try {
            apiRequestWithoutCompnay("post", `${env.GET_COMPANY}`, { companyIds: companyIds })
                .then((res) => {
                    const data = res.data;
                    resolve(data)
                    data.forEach((x) => {
                        commit("mutateCompanies", {
                            data: { ...x, _id: x._id },
                            op: "added",
                        })
                    })
                })
                .catch((error) => {
                    reject(error)
                })
        } catch (error) {
            reject(error);
        }
    });
}

export const setCompanyRefferal = ({ commit }, companyId) => {
    return new Promise((resolve, reject) => {
        try {
            apiRequest("get", env.GETCOMPANYREFFERCODE).then((res) => {
                commit("mutateCompanies", {
                    data: { code: res.data.data, _id: companyId },
                    op: "modified",
                })
                resolve();
            }).catch((error) => {
                reject(error)
            })
        } catch (error) {
            reject(error)
        }
    })
}


export const setSocketCompanies = ({ commit, rootState }, data) => {
    return new Promise((resolve, reject) => {
        try {
            apiRequestWithoutCompnay("post", `${env.GET_COMPANY}`, { companyIds: [data.companyId] })
                .then((res) => {
                    const cData = res.data;
                    cData.forEach((x) => {
                        commit("mutateCompanies", {
                            data: { ...x, _id: x._id },
                            op: "modified",
                        })
                    })
                })
                .catch((error) => {
                    reject(error)
                })
            rootState.settings.socketInstance.emit('joinCompaniesRoom', { roomName: "selected_companies_" + data.companyId + "**" + rootState.settings.socketInstance.id, socketId: rootState.settings.socketInstance.id });
            rootState.settings.socketInstance.on('companiesUpdate', (data) => {
                commit("mutateCompanies", {
                    data: { ...data.fullDocument },
                    op: "modified",
                })
                resolve(data.fullDocument)
            })
        } catch (error) {
            reject(error);
        }
    });
}

export const setFileExtentions = ({ commit }) => {
    return new Promise((resolve, reject) => {
        try {
            apiRequest("get", env.FILE_EXTENSIONS).then((res) => {
                if (res.status === 200 && res?.data && res?.data?.[0].settings?.length) {
                    commit("mutateFileExtentions", {
                        data: res?.data[0]?.settings,
                        op: "inital"
                    })
                    resolve(res?.data[0])
                } else {
                    resolve({});
                }
            })
                .catch((error) => {
                    console.error("ERROR in get extensions: ", error);
                    reject(error);
                })
        } catch (error) {
            reject(error);
        }
    });
}

export const setProjectTabComponents = ({ commit }) => {
    return new Promise((resolve, reject) => {
        try {
            apiRequest("get", `${env.PROJECTS_TABS}`)
                .then((res) => {
                    const data = res.data;
                    resolve(data)
                    data.forEach((x) => {
                        commit("mutateProjectTabComponents", {
                            data: { ...x },
                            op: "added",
                        })
                    })
                })
                .catch((error) => {
                    reject(error)
                })
        } catch (error) {
            reject(error);
        }
    });
}

export const setCompanyPriority = ({ commit }) => {
    return new Promise((resolve, reject) => {
        try {
            apiRequest("get", env.TASK_PRIORITY).then((res) => {
                if (res.status === 200 && res?.data && res?.data?.[0].settings?.length) {
                    commit("mutateCompanyPriority", {
                        data: res?.data[0].settings,
                        op: "inital"
                    })
                    resolve(res?.data[0].settings)
                } else {
                    resolve([]);
                }
            })
                .catch((error) => {
                    console.error("ERROR in getting company priorities settings: ", error);
                    reject(error);
                })
        } catch (error) {
            reject(error);
        }
    });
}

export const setCompayDateFormat = ({ commit }) => {
    return new Promise((resolve, reject) => {
        try {
            apiRequest("get", env.COMMON_DATE_FORMATE).then((res) => {
                if (res.status === 200 && res?.data && res?.data?.[0].settings?.length) {
                    commit("mutateCompanyDateFormat", {
                        data: res?.data[0]?.settings,
                        op: "added"
                    });
                    resolve(res?.data[0])
                } else {
                    resolve({})
                }
            })
                .catch((error) => {
                    console.error("ERROR in get date format: ", error);
                    reject(error);
                })
        } catch (error) {
            reject(error);
        }
    });
}

export const setNotificationRules = ({ commit }, payload) => {
    return new Promise((resolve, reject) => {
        try {
            apiRequest("get", `${env.NOTIFICATION}/${payload.userId}`).then((result) => {
                if (result.status === 200) {
                    commit("mutateNotificationSettings", {
                        data: result?.data || {},
                        op: "added"
                    })
                    resolve(result?.data || {})
                } else {
                    commit("mutateNotificationSettings", {
                        data: {},
                        op: "added"
                    })
                    resolve({})
                }
            }).catch((error) => {
                console.error("Error in getting notification settings: ", error);
                reject(error);
            })
        } catch (error) {
            reject(error);
        }

    })
}

export const setTaskType = ({ commit }) => {
    return new Promise((resolve, reject) => {
        try {
            apiRequest("get", env.TASK_TYPE_TEMPLATE).then((res) => {
                if (res.status === 200 && res?.data && res?.data?.length) {
                    resolve(res?.data)
                    res?.data.forEach((x) => {
                        commit("mutateTaskType", {
                            data: { ...x, _id: x._id },
                            op: "added"
                        })
                        commit("setProjectTaskTypeArray", {
                            data: JSON.parse(JSON.stringify({ ...x, _id: x._id })),
                            op: "added"
                        })
                    })
                } else {
                    resolve([]);
                }
            })
                .catch((error) => {
                    reject(error)
                })
        } catch (error) {
            reject(error);
        }
    });
}
export const setTaskStatus = ({ commit }) => {
    return new Promise((resolve, reject) => {
        try {
            apiRequest("get", env.TASK_STATUS_TEMPLATE).then((res) => {
                if (res.status === 200 && res?.data && res?.data?.length) {
                    resolve(res?.data)
                    res?.data?.forEach((x) => {
                        commit("mutateTaskStatus", {
                            data: { ...x, _id: x._id },
                            op: "added",
                        })
                        commit("setProjectTaskStatusArray", {
                            data: JSON.parse(JSON.stringify({ ...x, _id: x._id })),
                            op: "added"
                        })
                    })
                } else {
                    resolve([]);
                }
            })
                .catch((error) => {
                    reject(error)
                })
        }
        catch (error) {
            reject(error);
        }
    })
}
export const setCategory = ({ commit }) => {
    return new Promise((resolve, reject) => {
        try {
            apiRequest("get", env.SETTING_CATEGORY)
                .then((res) => {
                    const category = res.data;
                    commit("mutateCategory", category[0].settings)
                    resolve(category[0]);
                }).catch((error) => {
                    console.error("ERROR in get mutateCategory: ", error);
                    reject(error);
                });
        } catch (error) {
            reject(error);
            console.error("ERROR mutateCategory", error)
        }
    });
}

export const setMileStoneWeeklyRange = ({ commit }) => {
    return new Promise((resolve, reject) => {
        try {
            apiRequest("get", env.MILESTONE_RANGE).then((res) => {
                if (res.status === 200 && res?.data && res?.data?.[0].settings?.length) {
                    commit("mutateProjectMilestoneWeeklyRange", {
                        data: res?.data[0].settings[0],
                        op: "added"
                    })
                    resolve(res?.data[0].settings[0]);
                } else {
                    resolve([]);
                }
            }).catch((error) => {
                console.error("ERROR in get project milestone weekly range settings: ", error);
                reject(error);
            })
        } catch (error) {
            reject(error);
        }
    });
}

export const setTeams = ({ commit }) => {
    return new Promise((resolve, reject) => {
        try {
            apiRequest("get", env.TEAMS).then((response) => {
                var data = response.data;
                if (data.length > 0) {
                    data.filter((item) => {
                        item['isEdit'] = false;
                        item['isPopupOpen'] = false;
                    })
                }
                data.map(item => {
                    commit("mutateTeams", {
                        data: item,
                        op: "added"
                    })
                })
                resolve(data)
            })
                .catch((error) => {
                    console.error("ERROR in getting team settings: ", error);
                    reject(error);
                })
        } catch (error) {
            reject(error);
        }
    });
}
export const setCustomFields = ({ commit }) => {
    setCustomFieldsArray({ commit });
}


export const setRestrictedExtensions = ({ commit }) => {
    return new Promise((resolve, reject) => {
        try {
            apiRequest("get", env.RESTRICTED_EXTENSIONS).then((response) => {
                const data = response.data.data;
                commit("mutateRestrictedExtensions", {
                    data: data?.extensions || [],
                    op: "added",
                })
                resolve(data)
            })
                .catch((error) => {
                    console.error("ERROR in setRestrictedExtensions hook: ", error);
                    reject(error)
                })
        }
        catch (error) {
            reject(error);
        }
    })
}



export const setfinalCustomFields = ({ commit }) => {
    setfinalCustomFieldsArray({ commit })
}

export const setTimeTrackerDownload = ({ commit }) => {
    return new Promise((resolve, reject) => {
        try {

            const queryParams = new URLSearchParams({
                currentPage: 1,
                search: '',
                sort: JSON.stringify({ createdAt: 1 }),
                source: 'front'
            }).toString();

            apiRequest("get", `${env.GET_TACKER}?${queryParams}`)
                .then((res) => {
                    if (res.data && res.data.status) {
                        // Commit the data array
                        commit("mutateTimeTrackerDownload", res.data.data);
                        resolve(res.data.data);
                    } else {
                        console.warn("No data found");
                        commit("mutateTimeTrackerDownload", []);
                        resolve([]);
                    }
                }).catch((error) => {
                    console.error("ERROR in get Time Tracker Download: ", error);
                    reject(error);
                })
        }
        catch (error) {
            reject(error);
        }
    })
}

export const setTaskStatusArray = ({ commit }) => {
    return new Promise((resolve, reject) => {
        try {
            apiRequest('get', env.TASK_STATUS_SETTING_TEMPLATE)
                .then((res) => {
                    if (res.status === 200) {
                        const result = res.data;
                        resolve(result[0])
                        result.forEach((x) => {
                            commit("mutateTaskStatusArray", {
                                data: { ...x },
                                op: "added",
                            })
                        })
                    } else {
                        resolve([])
                    }
                })
                .catch((error) => {
                    reject(error)
                })
        } catch (error) {
            reject(error)
        }
    })
}

export const setProjectStatusArray = ({ commit }) => {
    return new Promise((resolve, reject) => {
        try {
            apiRequest('get', env.PROJECT_STATUS_SETTING_TEMPLATE)
                .then((res) => {
                    if (res.status === 200) {
                        const result = res.data;
                        resolve(result[0])
                        result.forEach((x) => {
                            commit("setProjectStatusArray", {
                                data: { ...x },
                                op: "added",
                            })
                        })
                    } else {
                        resolve([])
                    }
                })
                .catch((error) => {
                    reject(error)
                })
        } catch (error) {
            reject(error)
        }
    })
}
export const setCurrencyArray = ({ commit }) => {
    return new Promise((resolve, reject) => {
        try {
            let currencyArray = [];
            apiRequest("get", env.CURRENCY).then((response) => {
                if (response.status === 200) {
                    currencyArray = response.data;
                    commit("setCurrencyArray", { data: currencyArray, op: 'inital' });
                    resolve(currencyArray);
                } else {
                    resolve([]);
                }
            }).catch((error) => {
                console.error("ERROR in get setting currency: ", error);
                reject(error);
            })
        } catch (error) {
            console.error("ERROR in get setting currency: ", error);
            reject(error);
        }
    })
}

export const setProjectStatus = ({ commit }) => {
    return new Promise((resolve, reject) => {
        try {
            apiRequest("get", env.API_PROJECT_STATUS_TEMPLATE).then((response) => {
                const data = response.data.data;
                resolve(data)
                data.forEach((x) => {
                    commit("mutateProjectStatus", {
                        data: { ...x },
                        op: "added",
                    })
                    commit("setProjectStatus", {
                        data: JSON.parse(JSON.stringify({ ...x })),
                        op: "added"
                    })
                })
            }).catch((error) => {
                reject(error);
            })
        }
        catch (error) {
            reject(error);
        }
    })
}

export const setTaskTypeArray = ({ commit }) => {
    return new Promise((resolve, reject) => {
        try {
            apiRequest('get', env.TASK_TYPE_SETTING_TEMPLATE)
                .then((res) => {
                    if (res.status === 200) {
                        const result = res.data;
                        resolve(result[0])
                        result.forEach((x) => {
                            commit("setTaskTypeArray", {
                                data: { ...x },
                                op: "added",
                            })
                        })
                    } else {
                        resolve([]);
                    }
                }).catch((error) => {
                    reject(error)
                })
        } catch (error) {
            reject(error)
        }
    })
}



export const setplanFeatureDisplay = ({ commit }) => {
    return new Promise((resolve, reject) => {
        try {
            apiRequest("get", env.PLANFEATUREDISPLAY)
                .then((resp) => {
                    const result = resp.data || [];
                    commit("setplanFeatureDisplay", result);
                    resolve(result);
                }).catch((error) => {
                    console.error("Error GET SUBSCRIPRION PLAN", error)
                    reject(error)
                })
        } catch (error) {
            reject(error)
        }
    })
}