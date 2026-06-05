import { WASABI_RETRIVE_OBJECT, WASABI_RETRIVE_USER_PROFILE } from "@/config/env";
import { apiRequest, apiRequestWithoutCompnay } from "@/services";
import { getMessaging, getToken } from "firebase/messaging";
import Store from '@/store/index'
import { computed } from "vue";
import * as env from '@/config/env';
import moment from 'moment';
import { storageQueryBuilder } from '@/utils/storageQueryBuild';

export const fcmToken = () => {
    return new Promise((resolve, reject) => {
        try {
            const messaging = getMessaging();
            if (Notification.permission === 'granted') {
                getToken(messaging).then((currentToken) => {
                    if (currentToken) {
                        resolve({ status: true, token: currentToken, message: 'granted' });
                    } else {
                        console.info('No registration token available. Request permission to generate one.');
                    }
                }).catch((err) => {
                    reject({ status: true, token: '', message: err });
                    console.error('An error occurred while retrieving token. ', err);
                });
            } else {
                reject({ status: true, token: '', message: 'denied' });
            }
        } catch (error) {
            reject(error);
        }
    })
}


export const getConvertedTimeString = (n, type) => {
    try {
        var num = n;
        var hours = (num / 60);
        var rhours = Math.floor(hours);
        var minutes = (hours - rhours) * 60;
        var rminutes = Math.round(minutes);
        if (type == 'update') {
            if (rhours > 0 || rminutes > 0 || (rhours > 0 && rminutes > 0)) {
                // return rhours.toString().padStart(2, '0') + ':' + rminutes.toString().padStart(2, '0');
                return (rhours >= 0 && rhours <= 9 ? "0" + rhours : rhours) + ':' + ((rminutes >= 0 && rminutes <= 9) ? "0" + rminutes : rminutes);
            } else {
                return ''
            }
        } else if (type == 'fetch') {
            return rhours.toString().padStart(2, '0') + 'h' + ' ' + rminutes.toString().padStart(2, '0') + 'm';
        } else if (type == 'onSelectItem') {
            if (rminutes < 60) {
                return rminutes.toString() + 'm';
            } else if (rminutes == 60) {
                return rhours.toString() + 'h';
            } else if (rminutes > 60) {
                return rhours.toString() + 'h' + ' ' + rminutes.toString() + 'm';
            }
        }
        if (type == 'estimatedSuggestion') {
            let array = [];
            array.push(rhours.toString().padStart(2, '0') + 'hour' + ' ' + rminutes.toString().padStart(2, '0') + 'minute');
            return array
        }
    }
    catch (error) {
        console.error(error);
    }
}

export const totalDateRowLog = (colName, array, key) => {
    let finalTotal = 0;
    try {
        let idArray = [];
        let tempObj = colName[key] ? colName[key] : null;
        if (array.length > 0) {
            array.map((val) => {
                if (Object.keys(tempObj).length) {
                    if (Object.keys(tempObj).includes(val.id)) {
                        finalTotal += tempObj[`${val.id}`]
                    }
                }
                idArray.push(val.id)
            })
        }
        return finalTotal;
    }
    catch (error) {
        console.error(error);
        return finalTotal;
    }
}


export const totalDateProjectRowLog = (colName, array, key) => {
    let finalTotal = 0;
    try {
        let idArray = [];
        let tempObj = colName[key] ? colName[key] : null;
        if (array.length > 0) {
            array.map((val) => {
                if (Object.keys(tempObj).length) {
                    if (Object.keys(tempObj).includes(val.id)) {
                        finalTotal += tempObj[`${val.id}`]
                    }
                }
                idArray.push(val.id)
            })
        }
        return finalTotal;
    }
    catch (error) {
        console.error(error);
        return finalTotal;
    }
}

export const projectComponentsIcons = (key) => {

    let data = [
        {
            icon: require("@/assets/images/svg/component-inactive-icons/comp_list_inactive.svg"),
            activeIcon: require("@/assets/images/svg/component-active-icons/comp_list_active.svg"),
            keyName: "ProjectListView"
        },
        {
            icon: require("@/assets/images/svg/component-inactive-icons/comp_board_inactive.svg"),
            activeIcon: require("@/assets/images/svg/component-active-icons/comp_board_active.svg"),
            keyName: "ProjectKanban"
        },
        {
            icon: require("@/assets/images/svg/component-inactive-icons/comp_project_detail_inactive.svg"),
            activeIcon: require("@/assets/images/svg/component-active-icons/comp_project_details_active.svg"),
            keyName: "ProjectDetail"
        },
        {
            icon: require("@/assets/images/svg/component-inactive-icons/comp_comments_inactive.svg"),
            activeIcon: require("@/assets/images/svg/component-active-icons/comp_comments_active.svg"),
            keyName: "Comments"
        },
        {
            icon: require("@/assets/images/svg/component-inactive-icons/comp_calender_inactive.svg"),
            activeIcon: require("@/assets/images/svg/component-active-icons/comp_calender_active.svg"),
            keyName: "Calendar"
        },
        {
            icon: require("@/assets/images/svg/component-inactive-icons/comp_activity_inactive.svg"),
            activeIcon: require("@/assets/images/svg/component-active-icons/comp_activity_active.svg"),
            keyName: "ActivityLog"
        },
        {
            icon: require("@/assets/images/svg/component-inactive-icons/comp_workload_inactive.svg"),
            activeIcon: require("@/assets/images/svg/component-active-icons/comp_workload_active.svg"),
            keyName: "Workload"
        },
        {
            icon: require("@/assets/images/svg/component-inactive-icons/comp_gantt_inactive.svg"),
            activeIcon: require("@/assets/images/svg/component-active-icons/comp_gantt_active.svg"),
            keyName: "Gantt"
        },
        {
            icon: require("@/assets/images/svg/component-inactive-icons/comp_table_inactive.svg"),
            activeIcon: require("@/assets/images/svg/component-active-icons/comp_table_active.svg"),
            keyName: "TableView"
        },
        {
            icon: require("@/assets/images/svg/component-inactive-icons/comp_timeline_inactive.svg"),
            activeIcon: require("@/assets/images/svg/component-active-icons/comp_timeline_active.svg"),
            keyName: "Timeline"
        },
        {
            icon: require("@/assets/images/svg/component-inactive-icons/comp_embed_inactive.svg"),
            activeIcon: require("@/assets/images/svg/component-active-icons/comp_embed_active.svg"),
            keyName: "Embed"
        }
    ];

    const result = data.filter(x => x.keyName === key);
    return result[0];
}

export const projectAppsIcons = (key) => {

    let data = [
        {
            key: "Priority",
            beforeIcon: require("@/assets/images/svg/project_apps_inactive_icons/apps_priority_inactive.svg"),
            afterIcon: require("@/assets/images/svg/project_apps_active_icons/apps_priority_active.svg")
        },
        {
            key: "MultipleAssignees",
            beforeIcon: require("@/assets/images/svg/project_apps_inactive_icons/apps_mulitple_assignee_inactive.svg"),
            afterIcon: require("@/assets/images/svg/project_apps_active_icons/apps_mulitple_assignee_active.svg")
        },
        {
            key: "TimeEstimates",
            beforeIcon: require("@/assets/images/svg/project_apps_inactive_icons/apps_estimate_time_inactive.svg"),
            afterIcon: require("@/assets/images/svg/project_apps_active_icons/apps_estimate_time_active.svg")
        },
        {
            key: "Milestones",
            beforeIcon: require("@/assets/images/svg/project_apps_inactive_icons/apps_milstone_inactive.svg"),
            afterIcon: require("@/assets/images/svg/project_apps_active_icons/apps_milstone_active.svg")
        },
        {
            key: "tags",
            beforeIcon: require("@/assets/images/svg/project_apps_inactive_icons/apps_tags_inactive.svg"),
            afterIcon: require("@/assets/images/svg/project_apps_active_icons/apps_tags_active.svg")
        },
        {
            key: "CustomFields",
            beforeIcon: require("@/assets/images/svg/project_apps_inactive_icons/app_custom_field_inactive.svg"),
            afterIcon: require("@/assets/images/svg/project_apps_active_icons/app_custom_field_active.svg")
        },
        {
            key: "TimeTracking",
            beforeIcon: require("@/assets/images/svg/project_apps_inactive_icons/apps_time_tracking_inactive.svg"),
            afterIcon: require("@/assets/images/svg/project_apps_active_icons/apps_time_tracking_active.svg")
        },
        {
            key: "AI",
            beforeIcon: require("@/assets/images/svg/project_apps_inactive_icons/apps_ai_inactive.svg"),
            afterIcon: require("@/assets/images/svg/project_apps_active_icons/apps_ai_active.svg")
        }
    ];

    const result = data.filter(x => x.key === key);
    return result[0];
}

export const companyPrioritiesIcons = (key) => {

    let data = [
        {
            value: "HIGH",
            statusImage: require("@/assets/images/png/priority_high.png")
        },
        {
            value: "MEDIUM",
            statusImage: require("@/assets/images/png/priority_medium.png")
        },
        {
            value: "LOW",
            statusImage: require("@/assets/images/png/priority_low.png")
        }
    ];

    const result = data.filter(x => x.value === key);
    return result[0];
}

export const getImageUrl = (item) => {
    const { name, appStatus } = item;

    switch (name) {
        case 'Multiple Assignees':
            return appStatus
                ? require("@/assets/images/png/mutipleblue.png")
                : require("@/assets/images/png/mutiplegrey.png");
        case 'Time Estimate':
            return appStatus
                ? require("@/assets/images/timeBlue.png")
                : require("@/assets/images/timegrey.png");
        case 'Priority':
            return appStatus
                ? require("@/assets/images/priorityblue.png")
                : require("@/assets/images/prioritygrey.png");
        case 'Time Tracking':
            return appStatus
                ? require("@/assets/images/timevalueblue.png")
                : require("@/assets/images/timetracking.png");
        case 'Milestones':
            return appStatus
                ? require("@/assets/images/checkflagblue.png")
                : require("@/assets/images/checkflaggrey.png");
        case 'Tags':
            return appStatus
                ? require("@/assets/images/tagsblue.png")
                : require("@/assets/images/tagsgrey.png");
        case 'Custom Fields':
            return appStatus
                ? require("@/assets/images/editblue.png")
                : require("@/assets/images/editgrey.png");
        default:
            return undefined;
    }
}

function getStorageImage({ companyId, filePath, userImage = false, tuhumbnailSize = null, isCache = false }) {
    return new Promise((resolve, reject) => {
        (async () => {
            try {
                let path = filePath;

                if (tuhumbnailSize) {
                    const lastDotIndex = filePath.lastIndexOf(".");
                    const filename = filePath.substring(0, lastDotIndex);
                    const extension = filePath.substring(lastDotIndex + 1);
                    path = `${filename}-${tuhumbnailSize}.${extension}`;
                }

                const formData = { companyId, path, isCache };
                const url = userImage ? WASABI_RETRIVE_USER_PROFILE : WASABI_RETRIVE_OBJECT;

                const reqApi = userImage
                    ? apiRequestWithoutCompnay("get", `${url}/${companyId}/${path}`, formData)
                    : apiRequest("post", url, formData);

                const response = await reqApi;

                if (response.data.status === true) {
                    resolve({
                        url: response.data.statusText,
                        downloadUrl: response.data.statusText,
                    });
                } else {
                    reject(new Error(response.data.statusText || "Failed to retrieve image"));
                }
            } catch (error) {
                reject(error);
            }
        })();
    });
}

function getStorageImageServerStorage({ companyId, filePath, userImage = false, tuhumbnailSize = null, emit = null }) {
    return new Promise((resolve, reject) => {
        (async () => {
            try {
                let path = filePath;

                if (tuhumbnailSize) {
                    const lastDotIndex = filePath.lastIndexOf(".");
                    const filename = filePath.substring(0, lastDotIndex);
                    const extension = filePath.substring(lastDotIndex + 1);
                    path = `${filename}-${tuhumbnailSize}.${extension}`;
                }

                const bucketId = userImage ? "USER_PROFILES" : companyId;
                const axiosObject = storageQueryBuilder('get', bucketId, path);
                const response = await apiRequestWithoutCompnay(axiosObject.method, axiosObject.route);
                const downloadUrl = response.data.url + "&download=true";
                if (emit) {
                    emit("downloadUrl", downloadUrl);
                }
                resolve({
                    url: response.data.url,
                    downloadUrl
                });
            } catch (error) {
                reject(error);
            }
        })();
    });
}

export const storageHelper = () => {
    const handleStorageImageRequest = ({ companyId, data, tuhumbnailSize = null, userImage = false }) => {
        const filePath = data.url;

        if (env.STORAGE_TYPE && env.STORAGE_TYPE === 'server') {
            
            return getStorageImageServerStorage({ companyId, filePath, userImage, tuhumbnailSize })
                .then(result => result)
                .catch(error => { throw error });
        }

        return getStorageImage({ companyId, filePath, userImage, tuhumbnailSize })
            .then(result => result)
            .catch(error => { throw error });
    };

    return { handleStorageImageRequest };
};

export const taskPlanPermission = () => {
    function checkTaskPerSprintPermisssion(sprintId) {
        return new Promise((resolve, reject) => {
            try {
                const findQuery = [
                    {
                        "$match": {
                            objId: {
                                sprintId: sprintId,
                            },
                            deletedStatusKey: { $in: [0, 2, undefined] }
                        },
                    },
                    {
                        $count: "count"
                    }
                ];
                apiRequest('post', `${env.TASK}/find`, { findQuery: findQuery, count: "count" }).then((response) => {
                    if (response.status === 200) {
                        const result = response.data;
                        if (result) {
                            resolve(checkPlanPermission(result[0]?.count || 0));
                        }
                    }
                    else {
                        reject();
                    }
                }).catch((err) => {
                    console.error(err, "ERROR IN GET PER TASK COUNT");
                    reject();
                })
            } catch (error) {
                console.error(error, "Error");
                reject();
            }
        })
    }

    function checkPlanPermission(totalCreated) {
        const currentCompany = computed(() => Store.getters["settings/selectedCompany"]);
        let planfeatures = currentCompany.value?.planFeature;
        let taskPerSprint = planfeatures?.maxTaskPerSprint
        if (planfeatures === undefined) {
            return false;
        }
        if (taskPerSprint === null) {
            return true;
        } else {
            if (taskPerSprint > totalCreated) {
                return true;
            } else {
                return false;
            }
        }
    }

    return {
        checkTaskPerSprintPermisssion,
        checkPlanPermission
    }
}

export const sprintPlanPermission = () => {
    function checkPerProjectSprintPermission(projectId, collectionName) {
        return new Promise((resolve, reject) => {
            try {
                apiRequest("get", `/api/v1/${env.GET_SPRINT_OR_PROJECT}/${projectId}?collection=${collectionName}&count=true`).then((response) => {
                    if (response) {
                        resolve(checkSprintPlanPermission(response?.data[0]?.count || 0, collectionName));
                    }
                }).catch((err) => {
                    console.error(err, "ERROR IN GET PER PROJECT COUNT");
                    reject();
                })
            } catch (error) {
                console.error(error, "Error");
                reject();
            }
        })
    }

    function checkSprintPlanPermission(totalCreated, type) {
        const currentCompany = computed(() => Store.getters["settings/selectedCompany"]);
        let planfeatures = currentCompany.value?.planFeature;
        let perProjectData = type === 'sprints' ? planfeatures?.sprintPerProject : planfeatures?.folderPerProject;
        if (planfeatures === undefined) {
            return false;
        }
        if (perProjectData === null) {
            return true;
        } else {
            if (perProjectData > totalCreated) {
                return true;
            } else {
                return false;
            }
        }
    }

    return {
        checkPerProjectSprintPermission,
        checkSprintPlanPermission
    }
}
export const getTimeRange = (range) => {
    const now = new Date();
    let start, end;

    switch (range) {
        case 1: { // Today
            start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
            end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).getTime() / 1000;
            break;
        }

        case 2: { // Yesterday
            const yesterday = new Date(now);
            yesterday.setDate(yesterday.getDate() - 1);
            start = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate()).getTime() / 1000;
            end = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59, 59, 999).getTime() / 1000;
            break;
        }

        case 3: { // This Week
            const startOfWeek = new Date(now);
            startOfWeek.setDate(now.getDate() - now.getDay());
            start = new Date(startOfWeek.getFullYear(), startOfWeek.getMonth(), startOfWeek.getDate()).getTime() / 1000;
            const endOfWeek = new Date(startOfWeek);
            endOfWeek.setDate(startOfWeek.getDate() + 6);
            end = new Date(endOfWeek.getFullYear(), endOfWeek.getMonth(), endOfWeek.getDate(), 23, 59, 59, 999).getTime() / 1000;
            break;
        }

        case 4: { // Last Week
            const lastWeekStart = new Date(now);
            lastWeekStart.setDate(now.getDate() - now.getDay() - 7);
            const lastWeekEnd = new Date(lastWeekStart);
            lastWeekEnd.setDate(lastWeekStart.getDate() + 6);
            start = new Date(lastWeekStart.getFullYear(), lastWeekStart.getMonth(), lastWeekStart.getDate()).getTime() / 1000;
            end = new Date(lastWeekEnd.getFullYear(), lastWeekEnd.getMonth(), lastWeekEnd.getDate(), 23, 59, 59, 999).getTime() / 1000;
            break;
        }

        case 5: { // This Month
            start = new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000;
            end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).getTime() / 1000;
            break;
        }

        case 6: { // Last Month
            const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
            start = lastMonth.getTime() / 1000;
            end = lastMonthEnd.getTime() / 1000;
            break;
        }

        case 7: { // This Year
            start = new Date(now.getFullYear(), 0, 1).getTime() / 1000;
            end = now.getTime() / 1000;
            break;
        }

        case 8: { // Last 30 Days
            const thirtyDaysAgo = new Date(now);
            thirtyDaysAgo.setDate(now.getDate() - 30);
            start = new Date(thirtyDaysAgo.getFullYear(), thirtyDaysAgo.getMonth(), thirtyDaysAgo.getDate()).getTime() / 1000;
            end = now.getTime() / 1000;
            break;
        }

        default: {
            throw new Error("Invalid range selected");
        }
    }

    return { start, end };
}

export const getCardsComponentsSize = (key) => {
    switch (key) {
        case 'QueueListComp':
            return {
                "minW": 3,
                "maxW": 12,
                "minH": 5,
                "maxH": 18
            };
        case 'TasksByAssigneePieChartCard':
            return {
                "minW": 3,
                "maxW": 12,
                "minH": 5,
                "maxH": 18
            };
        case 'TasksByAssigneeStackBarChartCard':
            return {
                "minW": 3,
                "maxW": 12,
                "minH": 5,
                "maxH": 18
            };
        case 'TasksByAssigneeBarChartCard':
            return {
                "minW": 3,
                "maxW": 12,
                "minH": 5,
                "maxH": 18
            };
        case 'WorkloadByStatusStackBarChartCard':
            return {
                "minW": 3,
                "maxW": 12,
                "minH": 5,
                "maxH": 18
            };
        case 'WorkloadByStatusPieChartCard':
            return {
                "minW": 3,
                "maxW": 12,
                "minH": 5,
                "maxH": 18
            };
        case 'WorkloadByStatusBarChartCard':
            return {
                "minW": 3,
                "maxW": 12,
                "minH": 5,
                "maxH": 18
            };
        case 'TASKLIST':
            return {
                "minW": 3,
                "maxW": 12,
                "minH": 5,
                "maxH": 18
            };
        case 'CalendarCard':
            return {
                "minW": 3,
                "maxW": 12,
                "minH": 5,
                "maxH": 18
            };
        case 'TimeEstimatedComp':
        case 'TimeTrackComp':
        case 'TimeEstimatedWorkloadComp':
            return {
                "minW": 3,
                "maxW": 12,
                "minH": 5,
                "maxH": 18
            };
        case 'TotalUrgentTasksComp':
            return {
                "minW": 2,
                "maxW": 12,
                "minH": 4,
                "maxH": 18
            };
        case 'EmployeeWorkloadReportCard':
            // Tall and wide by default — this card has a summary
            // banner, an employee table, and two side-by-side charts,
            // so it needs more vertical room than a single chart card.
            return {
                "minW": 6,
                "maxW": 12,
                "minH": 10,
                "maxH": 22
            };
        default:
            return {
                "minW": 3,
                "maxW": 12,
                "minH": 5,
                "maxH": 18
            };
    }
}

export const buildFilterQuery = (queries, userID) => {

    let filterBy = {};

    queries?.forEach((query) => {
        if (query.comparisonsData.length === 0) {
            return;
        }

        const queryField = query.name.value;
        const comparison = query.comparison.value;
        const condition = query.condition === '||' ? '$or' : '$and';
        const filterOn = query.name.filterOn;

        if (filterBy[condition] === undefined) {
            filterBy[condition] = [];
        }
        if (query.name.type === "arrayOfObject") {
            filterBy[condition].push({ [queryField]: { $elemMatch: { [filterOn]: { $in: query.values } } } })
        } else if (query.name.type === "object") {
            const filteField = `${queryField}.${filterOn}`;
            filterBy[condition].push({ [filteField]: { $in: query.values } });
        } else if (query.name.type === "string" || query.name.type === "array") {
            if (comparison == ':!=') {
                filterBy[condition].push({ [filterOn]: { $nin: query.values } });
            } else {
                filterBy[condition].push({ [filterOn]: { $in: query.values } });
            }
        } else if (query.name.type === "date") {
            let startDate, endDate;
            switch (query.values[0]) {
                case "Today":
                    startDate = moment().startOf("day");
                    endDate = moment().endOf("day");
                    break;
                case "Yesterday":
                    startDate = moment().subtract(1, "day").startOf("day");
                    endDate = moment().subtract(1, "day").endOf("day");
                    break;
                case "Tomorrow":
                    startDate = moment().add(1, "day").startOf("day");
                    endDate = moment().add(1, "day").endOf("day");
                    break;
                case "This week":
                    startDate = moment().startOf("week");
                    endDate = moment().endOf("week");
                    break;
                case "Next week":
                    startDate = moment().add(1, "week").startOf("week");
                    endDate = moment().add(1, "week").endOf("week");
                    break;
                case "Last 7 days":
                    startDate = moment().subtract(6, "days").startOf("day");
                    endDate = moment().endOf("day");
                    break;
                case "Next 7 days":
                    startDate = moment().startOf("day");
                    endDate = moment().add(6, "days").endOf("day");
                    break;
                case "Last month":
                    startDate = moment().subtract(1, "month").startOf("month");
                    endDate = moment().subtract(1, "month").endOf("month");
                    break;
                case "This month":
                    startDate = moment().startOf("month");
                    endDate = moment().endOf("month");
                    break;
                case "Next month":
                    startDate = moment().add(1, 'month').startOf('month');
                    endDate = moment().add(1, 'month').endOf('month');
                    break;
                case "Date range":
                    if (query.comparison.value === ':=') {
                        startDate = moment(query.date[0]).startOf('day');
                        endDate = moment(query.date[1]).endOf('day');
                    }
                    else {
                        startDate = moment(query.date).startOf('day');
                        endDate = moment(query.date).endOf('day');
                    }
                    break;
            }
            if (comparison === ":=") {
                filterBy[condition].push({
                    [filterOn]: {
                        dbDate: {
                            $gte: startDate.toDate(),
                            $lte: endDate.toDate()
                        }
                    }
                });
            } else if (comparison === ":>") {
                filterBy[condition].push({
                    [filterOn]: {
                        dbDate: {
                            $gt: endDate.toDate()
                        }
                    }
                });
            } else if (comparison === ":<") {
                filterBy[condition].push({
                    [filterOn]: {
                        dbDate: {
                            $lt: startDate.toDate()
                        }
                    }
                });
            }
        } else if (query.name.type === "dateNumber") {
            const date = new Date(query.date);
            const now = moment(new Date(query.date));
            const nextDate = new Date(now.endOf('day'));
            date.setHours(0);
            date.setMinutes(0);
            date.setSeconds(0);

            if (comparison === ':=') {
                const startDate = new Date(query.date).setHours(0, 0, 0, 0);
                const endDate = new Date(query.date).setHours(23, 59, 59, 59);
                filterBy[condition].push({ [filterOn]: { $gte: new Date(startDate).getTime() / 1000, $lte: new Date(endDate).getTime() / 1000 } });
            } else if (comparison === ':>') {
                filterBy[condition].push({ [filterOn]: { $gt: new Date(nextDate).getTime() / 1000 } });
            } else {
                filterBy[condition].push({ [filterOn]: { $lt: new Date(date).getTime() / 1000 } });
            }
        } else {
            filterBy = { ...filterBy }
        }
    })
    let query = JSON.parse(JSON.stringify(filterBy).replaceAll("$meMode", userID));

    return query;
}


export const teamIdToUserId = (query, teams) => {
    try {
        let storeQuery = JSON.stringify(query);
        const queryFind = storeQuery.match(/"tId_.*?"/g);
        if (queryFind && queryFind.length) {
            queryFind.forEach((x) => {
                const teamDetails = teams.filter((y) => `"${("tId_" + y._id)}"` === x);
                let assignTeamUserIds = [];
                if (teamDetails && teamDetails.length) {
                    assignTeamUserIds = teamDetails[0]?.assigneeUsersArray || [];
                    if (assignTeamUserIds && assignTeamUserIds.length) {
                        storeQuery = storeQuery.replace(`${x}`, assignTeamUserIds.map(id => `"${id}"`).join(","))
                    }
                }
            });
            return JSON.parse(storeQuery);
        } else {
            return query;
        }
    } catch (error) {
        console.error("team id to user id convert error:", error?.message || error);
        return query;
    }
};

export const escapeCSVValue = (value) => {
    if (value === null || value === undefined) return "";

    // Convert non-string values to string
    value = String(value);

    // Escape double quotes by doubling them
    const escaped = value.replace(/"/g, '""');

    // Wrap value in quotes if it contains comma, double-quote, or newline
    if (/[",\n]/.test(escaped)) {
        return `"${escaped}"`;
    }
    return escaped;
}

export const isAuthDeviderShow = () => {
    const isAuthWithGoogle = process.env.VUE_APP_IS_GOOGLE_LOGIN || null;
    const isAuthWithGithub = process.env.VUE_APP_IS_GITHUB_LOGIN || null;
    return (isAuthWithGoogle && isAuthWithGoogle === 'true') || (isAuthWithGithub && isAuthWithGithub === 'true')
}