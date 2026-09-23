<template>
	<div class="position-re d-flex align-items-center w-100" :class="[{'empty-error-text': listName.error}]">
		<div class="position-re w-100">
			<input
				:id="id"
				type="text"
				class="form-control"
				:style="[{padding : clientWidth <=767 ? '5px 10px' : '0px 10px'}]"
				:max-length="50"
				v-model.trim="listName.value"
				:placeholder="createSprint ? $t('PlaceHolder.Enter_sprint_name') : $t('PlaceHolder.Enter_directory_name')"
				@keypress.enter="createSprint ? createEditSprint($event.value) : createEditFolder($event.value)"
				@keyup="checkErrors({'field':listName,
				'name':listName.name,
				'validations':listName.rules,
				'type':listName.type,
				'event':$event.event})"
				:isDirectFocus="true"
				:disabled="inProgress"
			>
			<span class="position-ab d-flex align-items-center bg-white pl-10px" :style="[{padding : clientWidth>767 ? '4px 10px' : '9px 10px', top : clientWidth>767 ? '4px' : '2px', right : clientWidth>767 ? '1px' : '5px'}]">
				<img :src="greenMarkIcon" alt="greenMarkIcon" class="cursor-pointer mr-10px green__mark-icon" @click.stop="createSprint ? createEditSprint(listName.value) : createEditFolder(listName.value)">
				<img :src="closeRedIcon" alt="closeRedIcon" class="cursor-pointer"  @click="$emit('cancel')">
			</span>
			<div class="red position-ab z-index-1 font-size-11 listname_error">{{listName.error}}</div>
		</div>
	</div>
</template>

<script setup>
// PACKAGE
import { ref, defineEmits, defineProps, inject, onMounted, nextTick } from "vue";
import { useStore } from "vuex";
import { useCustomComposable } from "@/composable";
import { useValidation } from "@/composable/Validation";
import * as env from '@/config/env';
import { useToast } from "vue-toast-notification";
import { apiRequest } from '../../../services';
import { dbCollections } from "../../../utils/Collections";
import { sprintPlanPermission } from "@/composable/commonFunction";
import { useI18n } from "vue-i18n";
const { t } = useI18n();

// UTILS
const companyId = inject('$companyId');
const clientWidth = inject("$clientWidth");
const projectData = inject('selectedProject');
const {commit} = useStore();
const  { checkErrors , checkAllFields } = useValidation();
const {makeUniqueId} = useCustomComposable();
const $toast = useToast();
const { checkPerProjectSprintPermission } = sprintPlanPermission();

// IMAGES
const greenMarkIcon = require("@/assets/images/svg/right_tick_green.svg");
const closeRedIcon = require("@/assets/images/svg/delete_cross_icon.svg");

const emit = defineEmits(["cancel","updateData"]);
const id = makeUniqueId();

const props = defineProps({
	item: {
		type: Object,
		default: null
	},

	createFolder: {
		type: Boolean,
		default: true
	},
	createSprint: {
		type: Boolean,
		default: true
	},
	folder: {
		type: Object,
		default: null
	},
	subItems: {
		type: Array,
		default: () => []
	}
})

const inProgress = ref(false);

const listName = ref({
	value: "",
	rules:
	"required | min: 3",
	name: "name",
	error: "",
});
onMounted(() => {
	listName.value.value = props.item ? props.item.name : "";

	nextTick(() => {
		document.getElementById(id).focus();
	})
})


// SPRINT OPERATIONS
function createEditSprint() {
	if(inProgress.value) {
		return
	}
	checkPerProjectSprintPermission(projectData.value._id,dbCollections.SPRINTS).then((result) => {
		if(result){
			if(listName?.value?.value?.length) {
				listName.value.value = listName.value.value.trim();
			}

			checkAllFields({listName: listName.value})
			.then((valid) => {
				if(valid) {
					inProgress.value = true;
		
					let sprintIndex = -1;
					if(props.item !== null) {
						if(listName.value.value === props.item.name.trim()) {
							$toast.success(t(`Toast.Nothing_to_update`), {position: "top-right"});
							inProgress.value = false;
							return;
						}
						sprintIndex = props.subItems.filter((x) => x.deletedStatusKey !== 1 && !x?.folderId).findIndex((x) => x.name?.toLowerCase() === listName.value.value.toLowerCase() && x.id !== props.item.id)
					} else {
						sprintIndex = props.subItems.filter((x) => x.deletedStatusKey !== 1 && !x?.folderId).findIndex((x) => x.name?.toLowerCase() === listName.value.value.toLowerCase())
					}
		
					if(sprintIndex !== -1) {
						$toast.error(t(`Toast.Sprint_already_exists`), {position: "top-right"});
						inProgress.value = false;
						return;
					}
		
					const axiosData = {
						companyId: companyId.value,
						projectId: projectData.value._id,
						sprintName: listName.value.value,
					}
		
					if(props.folder) {
						axiosData.folder = {
							folderId: props.folder.folderId,
							folderName: props.folder.folderName
						}
					} else {
						axiosData.folder = null
					}
		
					let endPoint = "";
					if(props.item !== null) {
						endPoint = env.SPRINT+"/"+props.item.id;
					} else {
						endPoint = env.SPRINT;
					}
					apiRequest(props.item !== null ? "patch" : "post", endPoint, {
							...axiosData,
							type: props.item !== null ? "editSprintName" : "addSprint",
					})
					.then((res) => {
						if(props.item !== null){
							commit("projectData/mutateSprints",{op:'modified',data:{...res?.data?.data}});
						}else{
							commit("projectData/mutateSprints",{op:'added',data:{...res?.data?.data}});
						}
						if(res?.data?.data) {
							emit("updateData",res?.data?.data,"Sprint");
						}
						if(res.data.status === true){
							$toast.success(t(`Toast.Sprint ${props.item !== null ? 'updated' : 'created'} successfully`), {position: "top-right"})
							emit('cancel');
							listName.value.value = "";
							listName.value.error = "";
						}else if(res.data.isUpgrade){
							$toast.error(t(`Toast.Upgrade_your_plan_you_have_reached_the_limit_for_creating_sprints`), {position: "top-right"});
						}else{
							$toast.error(t(`Toast.something_went_wrong`), {position: "top-right"});
						}
						inProgress.value = false;
					})
					.catch((err) => {
						inProgress.value = false;
						$toast.error(t(`Toast.something_went_wrong`), {position: "top-right"})
						emit('cancel');
						console.error("Error: ", err);
					})
				} else {
					inProgress.value = false;
				}
			})
			.catch((error) => {
				inProgress.value = false;
				console.error("ERROR in validation: ", error);
			})
		}else{
			$toast.error(t(`Toast.Upgrade_your_plan_you_have_reached_the_limit_for_creating_sprints`), {position: "top-right"});
		}
	});
}

// FOLDER OPERATIONS
function createEditFolder() {
	if(inProgress.value) {
		return;
	}
	if(!listName?.value?.value?.length) {
		listName.value.value = listName.value.value.trim();
	}

	checkAllFields({listName: listName.value})
	.then((valid) => {
		if(valid) {
			inProgress.value = true;
			let folderIndex = -1;
			if(props.item !== null) {
				if(listName.value.value === props.item.name.trim()) {
					$toast.success(t(`Toast.Nothing_to_update`), {position: "top-right"});
					inProgress.value = false;
					return;
				}
				folderIndex = props.subItems?.filter((y) => y.folderId && y.deletedStatusKey !== 1).findIndex((x) => x.name?.toLowerCase() === listName.value.value.toLowerCase() && x.folderId !== props.item.id)
			} else {
				folderIndex = props.subItems?.filter((y) => y.folderId && y.deletedStatusKey !== 1).findIndex((x) => x.name?.toLowerCase() === listName.value.value.toLowerCase())
			}

			if(folderIndex !== -1) {
				$toast.error(t(`Toast.Folder_already_exists`), {position: "top-right"});
				inProgress.value = false;
				return;
			}

			const axiosData = {
				companyId: companyId.value,
				projectId: projectData.value._id,
				folderName: listName.value.value,
			}

			let endPoint = "";
			if(props.item !== null) {
				endPoint = env.FOLDER+"/"+props.item.id;
			} else {
				endPoint = env.FOLDER;
			}
			apiRequest(props.item !== null ? "patch" : "post", endPoint, {
					...axiosData,
					type: props.item !== null ? "editFolderName" : "addFolder",
			})
			.then((result) => {
				if(props.item !== null){
					commit("projectData/mutateFolders",{op:'modified',data:{...result?.data?.data}});
				}else{
					commit("projectData/mutateFolders",{op:'added',data:{...result?.data?.data}});
				}
				if(result?.data?.data) {
					emit("updateData",result?.data?.data,"Folder");
				}
				if(result.data.status){
					$toast.success(t(`Toast.Folder ${props.item !== null ? 'updated' : 'created'} successfully`), {position: "top-right"})
					emit('cancel');
					listName.value.value = "";
					listName.value.error = "";
				}else if(result.data.isUpgrade){
					$toast.error(t(`Toast.upgrade_plan_folder_limit_reached`), {position: "top-right"});
				}else{
					$toast.error(t(`Toast.something_went_wrong`), {position: "top-right"});
				}
				inProgress.value = false;
			})
			.catch((err) => {
				$toast.error(t(`Toast.something_went_wrong`), {position: "top-right"})
				emit('cancel');
				inProgress.value = false;
				console.error("Error: ", err);
			})
		} else {
			inProgress.value = false;
		}
	})
	.catch((error) => {
		inProgress.value = false;
		console.error("ERROR in validation: ", error);
	})
}
</script>

<style scoped>
.empty-error-text {
    margin-bottom: 17px;
}
.listname_error{
	bottom: -14px; 
	left: 0px;
}
.green__mark-icon{
	width: 15px !important;
}

@media(max-width: 767px){
	.sprint-input-tag {height: auto !important;padding: 6px 15px;font-size: 16px;line-height: 26px;}
	.sprint-input-tag::placeholder{font-size: 16px;}
	.empty-error-text {margin-bottom: 10px;}
}
</style>
