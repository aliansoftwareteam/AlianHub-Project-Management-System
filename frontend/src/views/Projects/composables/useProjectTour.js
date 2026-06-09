import { ref, inject, computed } from 'vue';
import { useStore } from 'vuex';
import { useGetterFunctions } from '@/composable';
import { tourHepler } from '@/components/organisms/Tour/helper';

export function useProjectTour() {
    const { getters } = useStore();
    const { getUser } = useGetterFunctions();
    const { startProjectTour } = tourHepler();

    const userId = inject('$userId');
    const clientWidth = inject('$clientWidth');
    const mainTour = inject('$mainTour');

    const companyUserDetail = computed(() => getters['settings/companyUserDetail']);

    const hanldeProjectTaktypeTour = ref(null);
    const hanldeProjectLastStep = ref(null);

    function tourHandler(key, isDirectTour = false) {
        try {
            if (!isDirectTour) {
                mainTour.value.handleTour(key);
            } else {
                startProjectTour(key);
            }
        } catch (error) {
            console.error('ER: ', error);
        }
    }

    const hanldeBlankProjectTour = () => {
        if (companyUserDetail.value && (companyUserDetail.value.roleType === 1 || companyUserDetail.value.roleType === 2)) {
            if (getUser(userId.value)?.tourStatus?.isProjectTour == undefined || getUser(userId.value)?.tourStatus?.isProjectTour === false || (getUser(userId.value)?.tourStatus == undefined || Object.keys(getUser(userId.value)?.tourStatus).length == 0)) {
                if (clientWidth.value > 767) {
                    tourHandler('isProjectTour1', true);
                }
            }
        }
    };

    hanldeProjectTaktypeTour.value = () => {
        if (companyUserDetail.value && (companyUserDetail.value.roleType === 1 || companyUserDetail.value.roleType === 2)) {
            if (getUser(userId.value)?.tourStatus?.isProjectTour == undefined || getUser(userId.value)?.tourStatus?.isProjectTour === false || (getUser(userId.value)?.tourStatus == undefined || Object.keys(getUser(userId.value)?.tourStatus).length == 0)) {
                if (clientWidth.value > 767) {
                    tourHandler('isProjectTour2', true);
                }
            }
        }
    };

    hanldeProjectLastStep.value = () => {
        if (companyUserDetail.value && (companyUserDetail.value.roleType === 1 || companyUserDetail.value.roleType === 2)) {
            if (getUser(userId.value)?.tourStatus?.isProjectTour == undefined || getUser(userId.value)?.tourStatus?.isProjectTour === false || (getUser(userId.value)?.tourStatus == undefined || Object.keys(getUser(userId.value)?.tourStatus).length == 0)) {
                if (clientWidth.value > 767) {
                    tourHandler('isProjectTour3', true);
                }
            }
        }
    };

    function runProjectStartupTours(projectsLength) {
        if (!companyUserDetail.value || (companyUserDetail.value.roleType !== 1 && companyUserDetail.value.roleType !== 2)) return;

        if (getUser(userId.value)?.tourStatus?.isProjectAndNavbarTour == undefined || getUser(userId.value)?.tourStatus?.isProjectAndNavbarTour === false || (getUser(userId.value)?.tourStatus == undefined || Object.keys(getUser(userId.value)?.tourStatus).length == 0)) {
            if (clientWidth.value > 767) {
                tourHandler('isProjectAndNavbarTour');
            }
            return;
        }

        if (getUser(userId.value)?.tourStatus?.isProjectViewTour == undefined || getUser(userId.value)?.tourStatus?.isProjectViewTour === false || (getUser(userId.value)?.tourStatus == undefined || Object.keys(getUser(userId.value)?.tourStatus).length == 0)) {
            if (clientWidth.value > 767 && projectsLength) {
                tourHandler('isProjectViewTour');
            }
        }

        if (getUser(userId.value)?.tourStatus?.isProjectLeftViewTour == undefined || getUser(userId.value)?.tourStatus?.isProjectLeftViewTour === false || (getUser(userId.value)?.tourStatus == undefined || Object.keys(getUser(userId.value)?.tourStatus).length == 0)) {
            if (clientWidth.value > 1300) {
                tourHandler('isProjectLeftViewTour');
            }
        }
    }

    return {
        tourHandler,
        hanldeBlankProjectTour,
        hanldeProjectTaktypeTour,
        hanldeProjectLastStep,
        runProjectStartupTours,
    };
}
