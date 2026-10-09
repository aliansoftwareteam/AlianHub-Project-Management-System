import * as env from '@/config/env';
import { computed } from "vue";
import { useStore } from "vuex";
import { apiRequest } from "@/services";
import { i18n } from "@/locales/main";
import { clockText, fullText } from "@/utils/clockText";
const t = i18n.global.t;
export function useProjects() {
	const { getters } = useStore();

	/**
	 * This function is used to manage "Mark as Favorites" functionality for the projects
	 * @param {*} param
	 * @returns
	 */
	function markFavourite({ projectId = "", userId = "", data = null }) {

		return new Promise((resolve, reject) => {
			try {
				let key;
				if (data === null) {
					key = '$addToSet';
				} else {
					key = '$pull';
				}

				apiRequest("put", `/api/v1/${env.PROJECTACTIONS}/${projectId}`, { updateObject: { favouriteTasks: { userId: userId } }, key: key }).then(() => {
					resolve(`${!data ? `${t('Toast.Added_to_favourite')}` : `${t('Toast.Removed_from_favourite')}`}`);
				}).catch((error) => {
					reject(error);
				})
			} catch (error) {
				reject(error)
			}
		})
	}
	const getDateType = clockText;
	const getDateAndTime = fullText;

	function checkProjectPlan(requestFor) {
		const currentCompany = computed(() => getters['settings/selectedCompany']);
		if (currentCompany.value?.planFeature === undefined) {
			return false;
		}
		let maxProject = currentCompany.value?.planFeature?.project;
		let projectCount = currentCompany.value?.projectCount?.projectCount || 0;
		if (maxProject === null) {
			//request specific type
			return checkSpecificTypeCount(requestFor);
		} else {
			let mainAvailable = maxProject - projectCount;

			if (mainAvailable > 0) {
				//request specific type
				return checkSpecificTypeCount(requestFor);
			} else {
				return false
			}
		}
	}
	function checkSpecificTypeCount(requestFor) {
		const currentCompany = computed(() => getters['settings/selectedCompany']);
		let maxPublicProject = currentCompany.value?.planFeature?.maxPublicProject;
		let maxPrivateProject = currentCompany.value?.planFeature?.maxPrivateProject;
		let projectPublicCount = currentCompany.value?.projectCount?.publicCount || 0;
		let projectPrivateCount = currentCompany.value?.projectCount?.privateCount || 0;
		if (requestFor === 'public') {
			if (maxPublicProject === null) {
				return true
			} else {
				let available = maxPublicProject - projectPublicCount

				if (available > 0) {
					return true
				} else {
					return false
				}
			}
		} else if (requestFor === 'private') {
			if (maxPrivateProject === null) {
				return true
			} else {
				let available = maxPrivateProject - projectPrivateCount

				if (available > 0) {
					return true
				} else {
					return false
				}
			}
		}
	}
	return {
		markFavourite,
		getDateType,
		getDateAndTime,
		checkProjectPlan,
		checkSpecificTypeCount
	}
}