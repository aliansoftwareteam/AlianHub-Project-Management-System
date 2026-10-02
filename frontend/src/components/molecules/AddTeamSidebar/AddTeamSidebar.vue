<template>
    <div class="mainTeamCreate team-management-settings">
        <Sidebar className="mainTeamSidebar" width="607px" :top="clientWidth<=767 ? '0px' : '46px' ">
            <template #head-left>
                <div class="blue font-ui">{{$t('subProjectRulesNames.Create_Team')}}</div>
            </template>
            <template #head-right>
                <button class="bg-white cancelButtonTeam blue cursor-pointer" @click="closeSidebarFun()">{{$t('Projects.cancel')}}</button>
            </template>
            <template #body>
                <form @submit.prevent="submitData" class="createteamSiebarform bg-white">
                    <div class="form-group d-flex align-items-center common-sidebar-div">
                        <label>{{$t('subProjectRulesNames.Team_Name')}}<span class="add-team-sidebar-red">*</span></label>
                        <div class="teaminput-sidebar">
                            <InputText
                                v-model="formData.teamName.value"
                                :placeHolder="$t('PlaceHolder.Enter_Team_Name')"
                                :isOutline="false"
                                :maxLength="30"
                                @keyup="checkErrors({'field':formData.teamName,
                                'name':formData.teamName.name,
                                'validations':formData.teamName.rules,
                                'type':formData.teamName.type,
                                'event':$event.event})"
                             />
                            <div class="add-team-sidebar-red add-team-sidebar-font-size-11 position-ab">{{formData.teamName.error}}</div>
                        </div>
                    </div>
                    <div class="d-flex align-items-center common-sidebar-div">
                        <label>{{$t('subProjectRulesNames.Team_Color')}}</label>
                        <ul class="ul-colors ul-color-sidebar d-flex flex-wrap justify-content-start">
                            <li v-for="(color, index) in colors" :key="index" @click="selectedColor(color)" :class="[{'active': color === teamColor.bgColor}]" :style="[{'cursor':'pointer', 'background-color': color,}]">
                                <span></span>
                            </li>
                        </ul>
                    </div>
                    <div class="d-flex align-items-center common-sidebar-div">
                        <label>{{$t('subProjectRulesNames.Add_Member')}}</label>
                        <div class="addmember">
                            <Assignee
                                :users="selectedUser"
                                :options="users.map((x) => x._id)"
                                @selected="selectAssignee('add',$event,row)"
                                @removed="selectAssignee('remove', $event,row)"
                                :imageWidth="'30px'"
                                :isDisplayTeam="false"
                            />
                        </div>
                    </div>
                    <button type="submit" class="blue_btn_save white cursor-pointer border-0" :class="{'disable-btn': saving}" :disabled="saving">{{$t('Projects.save')}}</button>
                </form>
            </template>
        </Sidebar>
    </div>
</template>

<script setup>
    import Sidebar from "@/components/molecules/Sidebar/Sidebar.vue"
    import Assignee from "@/components/molecules/Assignee/Assignee.vue"

    import InputText from "@/components/atom/InputText/InputText.vue"
    import { defineProps, ref, computed, inject } from "vue";
    import { useStore } from 'vuex';
    import { useValidation } from "@/composable/Validation.js";
    import { apiRequest } from "../../../services";
    import * as env from '@/config/env';
    const props = defineProps({
        openTeamSidebar: {
            type: Boolean,
        }
    })
    const emit = defineEmits(["closeTeamSidebar"]);
    const {getters, commit } = useStore();
    const  { checkErrors , checkAllFields} = useValidation();

    const users = computed(() => getters["users/users"]);
    const teams = computed(() => getters["settings/teams"]);
    // const companyId = inject("$companyId");
    const selectedUser = ref([])
    const saving = ref(false);
    const clientWidth = inject("$clientWidth");
    const closeSidebar = ref(props.openTeamSidebar);
    const teamColor = ref({"color": "#ffffff","bgColor":"#074354"});
    const colors = ref([
        "#40BC86","#1ABC9C","#27AE60","#00D717","#F31D2F",
        "#EC555C","#FC575E","#FCB410","#B17E22","#F24D16",
        "#FF8600","#EC6F32","#2980B9","#3498DB","#528CCB",
        "#03A2FD","#7B68EE","#BF4ACC","#074354","#34495E",
        "#181D21","#0918EC","#199EC7"
    ])

    const formData = ref({
        teamName: {
            name: "Team name",
            value: "",
            rules:
            "required | min: 3",
            errors: "",
        },
    });

    const closeSidebarFun = () => {
        closeSidebar.value = false;
        emit("closeTeamSidebar",closeSidebar.value)
    }

    const selectAssignee = (type,user) => {
        if(type === 'add'){
            selectedUser.value.push(user.id);
        }
        if(type === 'remove'){
            selectedUser.value = selectedUser.value.filter((x) => x !== user.id);
        }
    }

    const selectedColor = (color) => {
        teamColor.value = {
            "color": "#ffffff",
            "bgColor": color
        };
    }

    const submitData = () => {
        try {
            checkAllFields(formData.value)
            .then((valid)=>{
                if(valid) {
                    saving.value = true;
                    if(teams.value.length > 0){
                        let team = teams.value.find((x) => x.value === formData.value.teamName.value.replaceAll(" ", "_").toUpperCase());
                        if(team){
                            formData.value.teamName.error = "Team name already exists";
                        }
                    }
                    if(valid && formData.value.teamName.error === ""){
                        let obj = {
                            name: formData.value.teamName.value,
                            value: formData.value.teamName.value.replaceAll(" ", "_").toUpperCase(),
                            teamColor: teamColor.value,
                            assigneeUsersArray: selectedUser.value,
                            createdAt: new Date()
                        }

                        apiRequest("post", `${env.TEAMS}/addTeam`,obj).then((res) => {
                            const teamData = {...res.data,isEdit: false,isPopupOpen:false};
                            if(teamData){
                                commit("settings/mutateTeams", { data: teamData,op: "added"});
                            }
                            closeSidebarFun();
                            saving.value = false;
                        })
                        .catch((error) => {
                            saving.value = false;
                            console.error("ERROR in add teams: ", error);
                        })
                    }
                }
            })
            .catch((error) => {
                saving.value = false;
                console.error("ERROR: ", error);
            })
        } catch (error) {
            saving.value = false;
            console.error("ERROR: ", error);
        }
    }

</script>

<style scoped>
.add-team-sidebar-font-size-11 {
    font-size: 11px;
}
.add-team-sidebar-red {
    color: var(--danger-ink);
}
</style>

<style src="./style.css">
</style>