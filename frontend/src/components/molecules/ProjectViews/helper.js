import { apiRequest } from '@/services';
import * as env from '@/config/env';

/* The catalogue rows the API returns carry no grouping of their own, so the palette's
 * sections are derived here from keyName. The last group claims everything unlisted,
 * which keeps a company's legacy or future rows visible instead of silently dropped. */
const VIEW_GROUPS = [
    { key: 'popular', labelKey: 'Projects.menu_popular', keyNames: ['ProjectListView', 'ProjectKanban', 'Calendar', 'GanttView', 'TableView', 'ProjectDashboard', 'Workload', 'ActivityLog'] },
    { key: 'integrations', labelKey: 'Projects.menu_integrations', keyNames: ['Embed'] },
    { key: 'more', labelKey: 'Projects.menu_more_views', keyNames: null },
];

export const groupViews = (views = []) => {
    const claimed = new Set(VIEW_GROUPS.flatMap((group) => group.keyNames || []));
    return VIEW_GROUPS.map((group) => ({
        key: group.key,
        labelKey: group.labelKey,
        items: views.filter((view) => (group.keyNames ? group.keyNames.includes(view?.keyName) : !claimed.has(view?.keyName))),
    })).filter((group) => group.items.length);
};

export const viewTagKey = (keyName) => `ViewListTag.${keyName}`;

/**
 * This function is used to add new private view
 * @param {Object} ids 
 * @param {Object} data 
 * @returns 
 */
export const addPrivateView = (ids, data) => {
    return new Promise((resolve, reject) => {
        try {
            /* `id` is what deletePrivateView and editPrivateName match on, and what
             * splitProjectViews classifies the record by. Stored without it the view
             * is saved but never appears in the tab bar and can never be removed. */
            const params = {
                id: ids.uid,
                data: { ...data, id: ids.uniqueId, createdAt: new Date() },
                operation: 'push'
            }

            apiRequest("post", `${env.API_MEMBERS}/private-view`, params).then(() => {
                resolve({ statusText: 'View_added_successfully', status: true })
            }).catch((error) => {
                console.error(`Error in addPrivateView hook => ${error}`)
            });

        } catch (error) {
            reject({ statusText: error, status: false })
        }
    })
}

/**
 * This function is used to remove or delete existing private view
 * @param {Object} ids 
 * @returns 
 */
export const deletePrivateView = (ids) => {
    return new Promise((resolve, reject) => {
        try {
            const params = {
                id: ids.uid,
                data: { id: ids.uniqueId },
                operation: 'delete'
            }

            apiRequest("post", `${env.API_MEMBERS}/private-view`, params).then(() => {
                resolve({ statusText: 'View_Deleted_Successfully', status: true })
            }).catch((error) => {
                console.error(`Error in deletePrivateView hook => ${error}`)
            });

        } catch (error) {
            reject({ statusText: error, status: false })
        }
    })
}

/**
 * This function is used to update private view name
 * @param {Object} ids 
 * @param {Object} data 
 * @param {String} name 
 * @returns 
 */
export const editPrivateName = (ids, data, name) => {
    return new Promise((resolve, reject) => {
        try {
            const params = {
                id: ids.uid,
                data: { id: data.id, name: name },
                operation: 'update',
                key: 'name'
            }

            apiRequest("post", `${env.API_MEMBERS}/private-view`, params).then(() => {
                resolve({ statusText: 'View_updated_successfully', status: true })
            }).catch((error) => {
                console.error(`Error in editPrivateName hook => ${error}`)
            });

        } catch (error) {
            reject({ statusText: error, status: false })
        }
    })
}
