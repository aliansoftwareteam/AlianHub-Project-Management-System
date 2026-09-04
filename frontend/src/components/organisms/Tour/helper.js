import { driver } from 'driver.js';
import "driver.js/dist/driver.css";
import createTaskTour from '@/utils/tourslist/createTaskTour.json';
import { apiRequestWithoutCompnay } from '@/services';
import * as env from '@/config/env';
import { useStore } from 'vuex';
import { useGetterFunctions } from '@/composable';
import { inject,computed } from 'vue';
import { i18n } from "@/locales/main";
import { useProjectsHelper } from '@/views/Projects/helper';
const t = i18n.global.t;

export function tourHepler() {
    let driverObj = null;
    const {getters,commit} = useStore();
    const companyUserDetail = computed(() => getters['settings/companyUserDetail'])
    const {getUser} = useGetterFunctions();
    const userId = inject("$userId");
    const clientWidth = inject("$clientWidth");
    const mainTour = inject("$mainTour");
    const {projects} = useProjectsHelper();
    
    // Close, Esc and the overlay must end the tour on every step, not only the last one;
    // a popover that ignores its own close button reads as broken.
    const handleTours = (tNum = 0) => {

        // startProjectTour()
        let currentTour = {
            popoverClass: 'ah-tour ah-tour--legacy',
            showProgress: false,
            overlayColor: 'black',
            showButtons: ['next', 'previous','close'],
            disableActiveInteraction : true,
            smoothScroll: true,
            nextBtnText: 'Next',
            prevBtnText: 'Previous',
            doneBtnText: 'Next',
        };
        if(tNum === "isTaskTour"){
            const updatedData = createTaskTour.map(item => {
                return {
                    ...item,
                    popover: {
                        ...item.popover,
                        title: t(`Tour.${item.popover.title}`),
                        description: t(`Tour.${item.popover.description}`)
                    }
                };
            });
            currentTour = {
                ...currentTour,
                steps: [
                    ...updatedData
                ],
                onCloseClick: () => closeTaskButtonClick(),
                onNextClick: (element, step, options) => onNextClickHandler('isTaskTour',element, step, options),
                onPrevClick: (element, step, options) => onPrevClickHanler('isTaskTour',element, step, options),
                onDestroyStarted: () => {
                    closeTaskButtonClick()
                    driverObj.destroy();
                },
            }
        }
        return currentTour;
    
    }
    const closeButtonClick = () => {
        updateTourStatusInUser('isProjectAndNavbarTour');
        driverObj.destroy();
        if(projects.value.length) {
            if(getUser(userId.value)?.tourStatus?.isProjectLeftViewTour == undefined || getUser(userId.value)?.tourStatus?.isProjectLeftViewTour === false || (getUser(userId.value)?.tourStatus == undefined || Object.keys(getUser(userId.value)?.tourStatus).length == 0)) {
                mainTour.value.handleTour('isProjectLeftViewTour');
            } else if(getUser(userId.value)?.tourStatus?.isProjectViewTour == undefined || getUser(userId.value)?.tourStatus?.isProjectViewTour === false || (getUser(userId.value)?.tourStatus == undefined || Object.keys(getUser(userId.value)?.tourStatus).length == 0)) {
                mainTour.value.handleTour('isProjectViewTour');
            }
        }
    }
    const closeTaskButtonClick = () => {
        updateTourStatusInUser('isTaskTour');
        driverObj.destroy();
    }
    const closeIconTaskHandler = (tourKey) => {
        updateTourStatusInUser(tourKey)
    }

    const handleTourOpenManual = (tourKey) => {
        if(projects.value.length) {
            if(tourKey == 'isProjectAndNavbarTour') {
                if(getUser(userId.value)?.tourStatus?.isProjectLeftViewTour == undefined || getUser(userId.value)?.tourStatus?.isProjectLeftViewTour === false || (getUser(userId.value)?.tourStatus == undefined || Object.keys(getUser(userId.value)?.tourStatus).length == 0)) {
                    mainTour.value.handleTour('isProjectLeftViewTour');
                } else if(getUser(userId.value)?.tourStatus?.isProjectViewTour == undefined || getUser(userId.value)?.tourStatus?.isProjectViewTour === false || (getUser(userId.value)?.tourStatus == undefined || Object.keys(getUser(userId.value)?.tourStatus).length == 0)) {
                    mainTour.value.handleTour('isProjectViewTour');
                }
            } else if(tourKey == 'isProjectLeftViewTour') {
                if(getUser(userId.value)?.tourStatus?.isProjectViewTour == undefined || getUser(userId.value)?.tourStatus?.isProjectViewTour === false || (getUser(userId.value)?.tourStatus == undefined || Object.keys(getUser(userId.value)?.tourStatus).length == 0)) {
                    mainTour.value.handleTour('isProjectViewTour');
                }
            }
        }
    }
    
    const updateTourStatusInUser = (currentTour="isProjectAndNavbarTour") => {
        try {
            let tourObject = {
                ...(getUser(userId.value).tourStatus && getUser(userId.value).tourStatus),
                [currentTour]: true
            }
            const updateObject = {
                $set: { tour: tourObject }
            } 
            const newObj = {
                returnDocument: 'after'
            }
            apiRequestWithoutCompnay("put",env.USER_UPATE,{
                userId: userId.value,
                updateObject: updateObject,
                newObj
            }).then((response)=>{
                commit("ToursData/mutateSingleTours",{
                    id:currentTour,
                    isCompleted: true
                });
                commit("users/mutateUsers", {
                    data: {
                        ...response.data.data,
                        tourStatus: tourObject,
                    },
                    op: "modified",
                });
                handleTourOpenManual(currentTour);
            }).catch((err)=>{
                console.error("ERROR: ", err);
            });
        } catch (error) {
            console.error(error.message);
        }
    }
    
    const onNextClickHandler = (fromTour='') => {
        if(fromTour == '') {
            if(driverObj.isLastStep() == false) {
                if(driverObj.getActiveStep().element === '#time_sheet_driver' || driverObj.getActiveStep().element === '#tracker_time_sheet_driver') {
                    document.querySelector('#time_sheet_driver').click()
                } 
                setTimeout(()=>{
                    driverObj.moveNext()
                })
            } else {
                closeButtonClick()
            }
        } else if(fromTour == 'isTaskTour') {
            if(driverObj.isLastStep() == false) {
                if((document.querySelector('#createtaskinput_driver') == null && driverObj.getActiveStep().element === '#createtask_driver')) {
                    document.querySelector('#createtask_driver').click()
                } 
                if(driverObj.getActiveStep()?.element === '#tasklist_driver' && document.getElementById('taskquickmenudriver') == null) {
                    closeTaskButtonClick();
                    return;
                }
                if(driverObj.getActiveStep()?.element === '#taskquickmenudriver' && document.getElementById('tasktoggle_driver') == null) {
                    closeTaskButtonClick();
                    return;
                }
                if(driverObj.getActiveStep().element === '#taskquickmenudriver' || driverObj.getActiveStep().element === '#taskquickmenu_driver') {
                    document.querySelector('#taskquickmenudriver').click()
                }
                if((document.querySelector('#subtasklist_driver .subTaskAddRemove') == null && driverObj.getActiveStep().element === '#taskquickmenu_driver') || driverObj.getActiveStep().element === '#subtasklist_driver') {
                    if(document.querySelector('#taskquickmenu_driver')) {
                        document.querySelector('#taskquickmenu_driver').click()
                    }
                }
                setTimeout(()=>{
                    driverObj.moveNext()
                })
            } else {
                closeTaskButtonClick()
            }
        }
    }
    const onPrevClickHanler = (fromTour="") => {
        if(fromTour == '') {
            if(driverObj.isFirstStep() == false) {
                if(driverObj.getActiveStep().element === '#company_dropdown_driver' || driverObj.getActiveStep().element === '#user_time_sheet_driver') {
                    document.querySelector('#time_sheet_driver').click()
                    setTimeout(()=>{
                        driverObj.movePrevious();
                    })
                } else {
                    driverObj.movePrevious();
                }
            }
        } else if(fromTour == 'isTaskTour') {
            if(driverObj.isFirstStep() == false) {
                if(driverObj.getActiveStep().element === '#createtaskinput_driver') {
                    document.querySelector('#createtask_driver').click()
                    setTimeout(()=>{
                        driverObj.movePrevious()
                    })
                } else {
                    if(driverObj.getActiveStep().element === '#taskquickmenu_driver' || driverObj.getActiveStep().element === '#tasktoggle_driver') {
                        document.querySelector('#taskquickmenudriver').click()
                    }
                    if(driverObj.getActiveStep().element === '#subtasklist_driver' || driverObj.getActiveStep().element === undefined) {
                        document.querySelector('#tasktoggle_driver').click()
                    }
                    setTimeout(()=>{
                        driverObj.movePrevious()
                    })
                }
            }
        }
    }
    const startProjectTour = (key) => {
        if(companyUserDetail.value && (companyUserDetail.value.roleType === 1 || companyUserDetail.value.roleType === 2)) {
            if(clientWidth.value > 1300) {
                let tours = handleTours(key)
                
                setTimeout(() => {
                    driverObj = driver(tours)
                    driverObj.drive();
                });
            }
        }
    }
    
    const hanldeProjectTour = (key) => {
        if(companyUserDetail.value && (companyUserDetail.value.roleType === 1 || companyUserDetail.value.roleType === 2)) {
            if(getUser(userId.value)?.tourStatus?.[key] == undefined || getUser(userId.value)?.tourStatus?.[key] === false || (getUser(userId.value)?.tourStatus == undefined || Object.keys(getUser(userId.value)?.tourStatus).length == 0)) {
                if(clientWidth.value > 1300) {
                    if(key === 'isTaskTour') {
                        if(driverObj?.isActive() === true) {
                            return false;
                        } else {
                            return true;
                        }
                    } else {
                        return true;
                    }
                }
            }else{
                return false;
            }
        }

    }

    return{
        handleTours,
        startProjectTour,
        closeIconTaskHandler,
        hanldeProjectTour,
        updateTourStatusInUser,
        handleTourOpenManual
    }
}
