<template>
    <div class="d-flex flex-row h-100 overflow-hidden project__components" v-if="(isRuleData === false ? rulePermission !== null : true) && checkPermission('project.project_list',projectData.isGlobalPermission) !== null">
        <div :class="[{'section-left' : clientWidth && clientWidth > 1300}]" v-if="checkPermission('project.project_list',projectData.isGlobalPermission) !== null">
            <ProjectListing
                ref="projectList"
                v-if="checkPermission('project.project_list',projectData.isGlobalPermission) !== null"
                v-model:projectData="projectData"
                v-model:showArchivedProjects="showArchivedProjects"
                v-model:isFilterHasData="isFilterHasData"
                v-model:isAdvanceFilterApplied="isAdvanceFilterApplied"
                @update:showArchivedProjects="showArchived = showArchivedProjects"
                @showArchived="showArchived = $event"
                :filterFavorites="filterFavorites"
                @update:filterFavorites="filterFavorites = $event"
                @update:searchData="projectSearchText = $event"
                @createProject="openSidebar()"
                @createAiProject="openAiCreator()"
                :loadingProjects="loadingProjects"
                @changeAvatar="showColorAvatar = true, assignAvatarData($event)"
                v-model:sprintLoading="sprintLoading"
            />
        </div>
        <template v-if="!loadingProjects && !isRuleData">
            <template v-if="projects?.length && projectData && !isFilterHasData">
                <template v-if="isRuleData === false ? checkPermission('task.task_list',projectData.isGlobalPermission) !== null && !projectData.isRestrict : !projectData.isRestrict">
                    <div class="section-right bg-white position-re">
                        <div class="list-view-header">
                            <div class="list-head-leftrightwrappper">
                                <div class="list-head-left d-flex align-items-center">
                                    <img :src="sidebarArrowIcon" alt="sidebarArrowIcon" class="cursor-pointer mr-10px" @click="$refs.projectList.toggleSidebar(true)" v-if="clientWidth <= responseWidth" :class="[{'z-index-5' : projectData?.deletedStatusKey === 2}]">
                                    <img :src="projectData?.favouriteTasks?.filter((x) => x.userId === userId)?.length ? projectStar : blankStar" alt="projectStar" class="cursor-pointer mark__project-favourite" @click="markProjectFavourite()"/>
                                    <div v-if="clientWidth > 767">
                                        <span v-if="projectData?.projectIcon && projectData?.projectIcon.type === 'color'" class="d-flex align-items-center justify-content-center ml-9px" :class="{'inital-box' : clientWidth > 767 , 'project-firtsleeter-box' : clientWidth <=767}" :style="[{'background-color': projectData?.projectIcon.data}]">{{ projectData?.ProjectName.charAt(0).toUpperCase()}}</span>
                                        <template v-else-if="projectData?.projectIcon && projectData?.projectIcon?.type === 'image'">
                                            <WasabiImage thumbnail="60x60" class="profile-sm-square mobile-projectlist-icon" v-if="!projectData.projectIcon.data.includes('http')" :data="{url: projectData.projectIcon.data, filename: projectData.projectIcon.data.split('/').pop(), extension: projectData.projectIcon.data.split('/').pop().split('.').pop()}"/>
                                            <img v-else class="profile-sm-square mobile-projectlist-icon" :src="projectData.projectIcon.data" alt=""/>
                                        </template>
                                    </div>
                                    <div class="list-text-wrapper">
                                        <template v-if="!editProject">
                                            <span v-if="checkPermission('project.project_name_edit',projectData.isGlobalPermission) === true" class="text-ellipsis font-weight-bold text-capitalize black list-view-header-title ml-12px" @dblclick="projectName.value = projectData?.ProjectName, editProject = true" :title="projectData.ProjectName">
                                                {{ projectData?.ProjectName }}
                                            </span>
                                            <span v-else class="text-ellipsis font-weight-bold text-capitalize black list-view-header-title ml-12px" :title="projectData.ProjectName">
                                                {{ projectData?.ProjectName }}
                                            </span>
                                        </template>
                                        <div v-else class="position-re project-titlerename-input ml-10px mr-5px" :class="{'list-type-error': projectName.error }">
                                            <input
                                                type="text"
                                                class="form-control project__name-input"
                                                v-model.trim="projectName.value"
                                                :placeholder="$t('errorPage.project_name')"
                                                :maxLength="250"
                                                :minLength="3"
                                                :isOutline="false"
                                                :isDirectFocus="true"
                                                @blur="editProject = false"
                                                :style="{borderColor: !projectName.error.length ? '#cecece' : 'red'}"
                                                @keypress.enter="projectName.value !== projectData?.ProjectName ? updateProjectName() : editProject = false"
                                                @keyup="checkErrors({'field':projectName,
                                                'name':projectName.name,
                                                'validations':projectName.rules,
                                                'type':projectName.type,
                                                'event':$event.event})"
                                            />
                                            <div class="red position-ab z-index-1 font-size-11 text-nowrap project__name-error">{{ projectName.error }}</div>
                                        </div>

                                        <div v-if="clientWidth <= 767" class="d-flex align-items-center">
                                            <div>
                                                <span v-if="projectData?.projectIcon && projectData?.projectIcon.type === 'color'" class="d-flex align-items-center justify-content-center ml-9px" :class="{'inital-box' : clientWidth > 767 , 'project-firtsleeter-box' : clientWidth <=767}" :style="[{'background-color': projectData?.projectIcon.data}]">{{ projectData?.ProjectName.charAt(0).toUpperCase()}}</span>
                                                <template v-else-if="projectData?.projectIcon && projectData?.projectIcon?.type === 'image'">
                                                    <WasabiImage thumbnail="60x60" class="vertical-middle profile-sm-square mobile-projectlist-icon" v-if="!projectData.projectIcon.data.includes('http')" :data="{url: projectData.projectIcon.data, filename: projectData.projectIcon.data.split('/').pop(), extension: projectData.projectIcon.data.split('/').pop().split('.').pop()}"/>
                                                    <img v-else class="vertical-middle profile-sm-square mobile-projectlist-icon" :src="projectData.projectIcon.data" alt=""/>
                                                </template>
                                            </div>
                                            <DropDown id="project_avail_views" maxHeight="90vh" title="All Views" :bodyClass="{'viewlist-mobile-dropdown' : true}">
                                                <template #button>
                                                    <div
                                                        class="d-flex align-items-center text-nowrap border-top-radius-10-px cursor-pointer h-100"
                                                        :ref="projectView"
                                                    >
                                                        <img :src="publicIcon" v-if="!projectData.isPrivateSpace" class="pr-10px vertical-middle" alt="public-folder"/>
                                                        <span class="font-size-14 text-ellipsis d-inline-block gray81 project__requirement">
                                                            <img :src="activeTab !== 'EmbedView'
                                                                    ? projectComponentsIcons(projectData?.ProjectRequiredComponent?.find(x => x.keyName === activeTab)?.keyName)?.icon
                                                                    : projectComponentsIcons(projectData?.ProjectRequiredComponent?.find(x => x.name === embedViewName)?.type)?.icon" alt="list" class="mr-5px">
                                                            {{activeTab !== 'EmbedView' ? viewLabel(projectData?.ProjectRequiredComponent?.find(x => x.keyName === activeTab)?.name) : embedViewName || "N/A"}}
                                                        </span>
                                                        <img :src="listDropIcon" alt="ListDropIcon" :style="[{marginLeft : clientWidth <=375 ? '2px' : '10px'}]"/>
                                                    </div>
                                                </template>
                                                <template #options>
                                                    <DropDownOption
                                                        v-for="view in projectData.ProjectRequiredComponent"
                                                        :key="view.id"
                                                        @click="$refs[projectView].click(),handleView(view),!view?.keyName ? openEmbedView(view) : ''"
                                                    >
                                                        <div class="d-flex align-items-center justify-content-between w-100">
                                                            <div class="viewlistIcon d-flex align-items-center">
                                                                <span class="d-flex align-items-center justify-content-center border-radius-6-px mr-20px bg-white border-gray view__activeproject-name">
                                                                    <img :src="view?.keyName ? activeTab === view.keyName ? projectComponentsIcons(view?.keyName)?.activeIcon || '' : projectComponentsIcons(view?.keyName)?.icon || '' : icons?.[view?.type] || ''" alt="view.icon" class="mr-0">
                                                                </span>
                                                                <span class="font-size-16 font-weight-500 text-ellipsis d-inline-block gray81 mw-66" @click="handleViewName(view.name)">{{ $t(`ViewList.${view.name}`) }}</span>
                                                            </div>
                                                            <span v-if="view.setAsDefault" class="mobile-defaultview-text font-size-12 font-weight-400 darkblue"><img class="list_make_as_defaultimg" :src="viewDefaultIcon"/>
                                                                {{ $t('Projects.default_view') }}
                                                            </span>
                                                            <img class="ml-20px activeTab-tick" v-if="activeTab === view.keyName" :src="viewDefaultActive"/>
                                                        </div>
                                                    </DropDownOption>
                                                    <DropDownOption class="position-sti border d-flex justify-content-center addview__dropdown" @click="$refs[projectView].click(), $refs.all_views_dd.click()">
                                                        <div class="blue font-size-18 font-weight-700">
                                                            + {{ $t('Projects.add_view') }}
                                                        </div>
                                                    </DropDownOption>
                                                </template>
                                            </DropDown>
                                        </div>
                                    </div>
                                    <div class="key-wapper" v-if="clientWidth > 767">
                                        <span class="text-ellipsis border-left font-size-13 text-uppercase key-text pl-11px pr-10px GunPowder" :title="projectData.ProjectCode">
                                            {{ projectData?.ProjectCode }}
                                        </span>
                                    </div>
                                    <img :src="publicFolder" class="vertical-middle" alt="public-folder" v-if="clientWidth > 767 && !projectData.isPrivateSpace"/>
                                </div>
                                <div class="list-head-mid h-100" :class="{'desktop-view' : clientWidth > 767}" id="projectview_driver">
                                    <template v-if="clientWidth > 765">
                                        <div class="d-flex align-items-center overflow-x-auto style-scroll view_list_scroll h-100">
                                            <ViewsList
                                                v-for="(view, index) in (viewsListArray)"
                                                :key="view._id"
                                                :id="view.keyName"
                                                :item="view"
                                                :active="activeTab === view.keyName"
                                                :firstChild="index === 0"
                                                :isDeleteDisabled="viewsListArray.length == 1"
                                                :commentCount="view.keyName === 'Comments' ? myCounts?.[`project_${projectData._id}_comments`] || 0 : 0"
                                                @click="activeTab = view.keyName,$router.replace({query: {tab: view.keyName}})"
                                            />
                                            <div class="project__requirementcomponent-wrapper" v-if="projectData?.ProjectRequiredComponent && (embedViews).length">
                                                <DropDown :bodyClass="{'dropdown-width':true}" @isVisible="(val)=> !val? (renameValue = {name:'',id:''}) :''">
                                                    <template #button>
                                                        <div class="d-flex p9x-13px" ref="project_tabs_components" :class="{'bg-light-gray':activeTab == 'EmbedView'}">
                                                            <img :src="!selectedEmbedView ? icons[embedViews[0].type] : icons[selectedEmbedView.type]" alt="" class="list_make_as_defaultimg">
                                                            <span class="font-size-14 text-ellipsis gray81 mw-50 ml-10px">{{!selectedEmbedView ? embedViews[0].name : selectedEmbedView.name}}</span>
                                                            <div class="view-count">
                                                                {{ (embedViews).length }}
                                                                <img :src="whiteDownArrow" class="ml-2px">
                                                            </div>
                                                        </div>
                                                    </template>
                                                    <template #options>
                                                        <template v-for="(element, index) in (embedViews)" :key="index">
                                                            <div class="cursor-pointer d-flex embed-option justify-content-between" @click="openEmbedView(element),$refs['project_tabs_components'].click()">
                                                                <div class="align-items-center d-flex" v-if="element.id != renameValue.id">
                                                                    <img class="embed_view_dropdown mr-10-px" :src="icons[element.type]" alt="">
                                                                    <span class="d-block text-ellipsis embeded__element-name" :title="element.name">{{ element.name }}</span>
                                                                </div>
                                                                <div v-if="element.id == renameValue.id" @click.stop="">
                                                                    <InputText v-model="renameValue.name" :inputId="renameValue.id" :isDirectFocus="true"></InputText>
                                                                </div>
                                                                <div v-if="element.id != renameValue.id" class="d-flex align-items-center p5x-0px" @click.stop="">
                                                                    <img :src="require('@/assets/images/svg/active-pin.svg')" v-if="element?.isPin && element.isPin" class="ml-10px active__pin-img">
                                                                    <span class="notification-tick blinking position-sti ml-7px" v-if="element?.isPrivate"></span>
                                                                    <DropDown :id="Uid">
                                                                        <template #button>
                                                                            <img :src="threedots" :ref="Uid" class="vertical-middle"/>
                                                                        </template>
                                                                        <template #options>
                                                                            <div>
                                                                                <ul class="p-0 m-0 justify-content-start cursor-pointer">
                                                                                    <li class="embed-edit-options" @click.stop="renameValue = {name:element.name,id:element.id}">
                                                                                        <img :src="renameImage" class="inner-tagedit-list-item embed__options"/>
                                                                                        <span>{{ $t('Projects.rename') }}</span>
                                                                                    </li>
                                                                                    <li class="embed-edit-options" @click="copyToClipboard(element.id),$refs[Uid][index].click()">
                                                                                        <img :src="copy" class="inner-tagedit-list-item embed__options">
                                                                                        <span>{{ $t('Projects.copy_link') }}</span>
                                                                                    </li>
                                                                                    <li class="embed-edit-options cursor-pointer" @click.stop="openDelete = {flag:true,data:element},$refs[Uid][index].click(),$refs.project_tabs_components.click()">
                                                                                        <img :src="deleteImage" class="inner-tagedit-list-item embed__options"/>
                                                                                        <span class="red">{{ $t('Projects.delete') }}</span>
                                                                                    </li>
                                                                                </ul>
                                                                            </div>
                                                                        </template>
                                                                    </DropDown>
                                                                </div>
                                                                <div v-if="element.id == renameValue.id" class="d-flex align-items-center p5x-0px ml-5px">
                                                                    <img :src="saveImage" class="save__cancel-img" @click.stop="() => { editViewName(element)}">
                                                                    <img :src="cancelImage" class="save__cancel-img ml-5px" @click.stop="renameValue = {name:'',id:''}">
                                                                </div>
                                                            </div>
                                                        </template>
                                                    </template>
                                                </DropDown>

                                                <ConfirmationSidebar
                                                    v-model="openDelete.flag"
                                                    :title="$t('Projects.deleteview')"
                                                    :message="`${$t('Filters.are_you_sure')} ${openDelete.data.name} ${$t('Projects.view')}?`"
                                                    acceptButtonClass="btn-danger"
                                                    @confirm="() => deleteEmbedView()"
                                                    :acceptButton="$t('Projects.delete')"
                                                >
                                                    <template #body>
                                                        <div></div>
                                                    </template>
                                                </ConfirmationSidebar>
                                            </div>
                                        </div>
                                        <div class="d-flex align-items-center text-nowrap border-top-radius-10-px cursor-pointer view-list-wrapper h-100">
                                            <DropDown v-if="checkPermission('project.view_list',projectData.isGlobalPermission) === true" maxHeight="80vh" :bodyClass="{'embed__dropdown':true}" id="embeddropdown">
                                                <template #button>
                                                    <div ref="embeddropdown" id="embeddropdown_button" class="d-flex align-items-center justify-content-center font-size-14 view-list-title p0x-10px">
                                                        <img :src="addIcon" alt="addIcon" class="mr-10px">
                                                        <span>{{ $t('Projects.view') }}</span>
                                                    </div>
                                                </template>
                                                <template #options>
                                                    <ViewsDropdown :projectData="projectData" @closeDropdown="$refs['embeddropdown'].click()" :tourId="'projectviewlist_driver'"/>
                                                </template>
                                            </DropDown>
                                        </div>
                                    </template>
                                </div>
                            </div>
                            <ProjectActionsBar
                                :projectData="projectData"
                                :clientWidth="clientWidth"
                                :users="users"
                                :teams="teams"
                                @openSidebar="open"
                                @openWatcher="openProjectWatcher = true"
                                @changeAssignee="(type, $event) => changeAssignee(type, $event)"
                                @openPermissionSidebar="openPermissionSidebar"
                                @startEditName="projectName.value = projectData?.ProjectName; editProject = true"
                                @openColorAvatar="showColorAvatar = true; assignAvatarData({id: projectData._id, name: projectData.ProjectName, icon: projectData?.projectIcon})"
                                @archiveProject="(val) => { showSidebar = true; archive = val }"
                            />
                        </div>
                        <div v-if="showLoader" class="d-flex box-shadow-6 position-fi z-index-10 right-22px bottom-22px bg-white p-10px border-radius-5-px align-items-center">
                            <div class="progress-container d-flex align-items-center position-re">
                                <div class="progress-circle" :style="circleStyle">
                                    <span class="progress-text">{{ currentProgress }}%</span>
                                </div>
                            </div>
                            <div>
                                <span>{{ $t('importTaskButton.import_processing') }}</span>
                            </div>
                        </div>
                        <div :class="[`list-view-body bg-light-gray`,(clientWidth <= 767 && activeTab === 'ProjectDetail') ? 'overflow-auto' : '',
                                {
                                'd-flex': activeTab !== 'ProjectListView' &&
                                            activeTab !== 'Calendar' &&
                                            activeTab !== 'ProjectKanban' &&
                                            activeTab !== 'TableView' &&
                                            activeTab !== 'Reports' &&
                                            activeTab !== 'GanttView' &&
                                            activeTab !== 'RecurringTasks' &&
                                            activeTab !== 'TimelineView' &&
                                            activeTab !== 'MindMapView' &&
                                            activeTab !== 'WhiteboardView' &&
                                            activeTab !== 'CanvasView' &&
                                            activeTab !== 'MapView' &&
                                            (clientWidth > 767 || activeTab !== 'ProjectDetail')
                                },
                                {'board-veiw-main-parent': activeTab === 'ProjectKanban'}
                            ]"
                            :style="{height: clientWidth > 767 ? 'calc(100% - 48px)' : 'calc(100% - 62px)'}"
                        >
                            <ProjectFiltersToolbar
                                :activeTab="activeTab"
                                :projectData="projectData"
                                :clientWidth="clientWidth"
                                :showArchived="showArchived"
                                :showArchivedProjects="showArchivedProjects"
                                v-model:taskSearch="taskSearch"
                                v-model:taskNameSearch="taskNameSearch"
                                v-model:taskKeySearch="taskKeySearch"
                                v-model:taskDescriptionSearch="taskDescriptionSearch"
                                :filterUsers="filterUsers"
                                v-model:userSidebar="userSidebar"
                                v-model:collapsed="collapsed"
                                v-model:groupBy="groupBy"
                                :groupByOptions="groupByOptions"
                                :users="users"
                                :teams="teams"
                                :userId="userId"
                                :calendartoggle="calendartoggle"
                                :calendarDate="calendarDate"
                                :calenderSelectDate="calenderSelectDate"
                                :rangeObject="rangeObject"
                                @applyFilter="applyFilter"
                                @clearFilter="clearFilter"
                                @search="searchMongoDB"
                                @toggleSearch="toggleSearch"
                                @manageFilterUsers="manageFilterUsers"
                                @changeAssignee="(type, $event) => changeAssignee(type, $event)"
                                @openAi="openAiSidebar = true"
                                @openAiAssist="showAiTaskCreator = true"
                                @update:showArchived="(v) => showArchived = v"
                                @openCalendar="calendartoggle = true; rangeObjectFRun(calendarDate ? new Date(calenderSelectDate) : new Date())"
                                @handleStartEndDate="handleStartEndDate"
                                @prevMonth="prevMonth"
                                @nextMonth="nextMonth"
                                @defaultMonth="defaultMonth"
                            />
                            <!-- AI Assist (AHE-3777): project-level AI task generation, opened from the toolbar. -->
                            <AiTaskCreator v-if="projectData && projectData._id" v-model="showAiTaskCreator" :projectId="String(projectData._id)" />
                            <component
                                v-if="(clientWidth <= 767 && isVisible == true && isRuleData == false) || (clientWidth > 767 && isRuleData == false)"
                                :class="[{'showProjectDetailRight':activeTab !== 'ProjectListView' && activeTab !== 'Calendar' && activeTab != 'EmbedViewItem' && activeTab !== 'Workload' && activeTab !== 'ProjectKanban' && activeTab !== 'TableView' && activeTab !== 'Reports' && activeTab !== 'GanttView' && activeTab !== 'RecurringTasks' && activeTab !== 'TimelineView' && activeTab !== 'MindMapView' && activeTab !== 'WhiteboardView' && activeTab !== 'CanvasView' && activeTab !== 'MapView'}]"
                                :is="getView(activeTab)"
                                :data="selectedEmbedView"
                                :sprints="sprints"
                                :projectData="projectData"
                                :grouped="groupBy"
                                :billingPeriod="billingPer"
                                :startDate="projectStartDate"
                                :userIds="projectData?.isPrivateSpace ? (projectData?.AssigneeUserId || []) : users?.map((x) => x._id)"
                                :watchers="Object.keys(projectData?.watchers || {})"
                                :checklistArray="projectData?.checklistArray"
                                @openSeeAllProject="open('filesLinks')"
                                :isvisible="isVisibleProjectDetial"
                                :calendarDate="calenderSelectDate"
                                :calendarDateChange="calendarDateChange"
                                :creator="{uid: projectData?.projectCreatedBy, date: projectData?.createdAt}"
                                @rightSideBarEmit="handleEmitProjectRightSide"
                                @description="handleDescription"
                                :activeTab="activeTab"
                                :sprintLoading="sprintLoading"
                                :commentType="'project'"
                            />
                            <ProjectDetailRightSide v-if="activeTab !== 'ProjectListView' && clientWidth > 767 && activeTab !== 'Calendar' && activeTab != 'EmbedView' && activeTab !== 'Workload' && activeTab !== 'ProjectKanban' && activeTab !== 'TableView' && activeTab !== 'Reports' && activeTab !== 'GanttView' && activeTab !== 'RecurringTasks' && activeTab !== 'TimelineView' && activeTab !== 'MindMapView' && activeTab !== 'WhiteboardView' && activeTab !== 'CanvasView'" :projectData="projectData" @rightSideBarEmit="handleEmitProjectRightSide" @description="handleDescription"/>
                        </div>
                        <div class="position-ab z-index-1 p-5px border-radius-5-px text-center p0x-15px archived_wrapper" v-if="projectData?.deletedStatusKey === 2">
                            <div>
                                <div>
                                    <img src="@/assets/images/Frame.png" alt="fram_img"/>
                                    <h3 class="font-size-22 font-weight-700 text-center line-height-33 black">
                                        Project is currently archived
                                    </h3>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div>
                        <TaskDetail
                            v-if="isTaskDetail && selectedTask"
                            :companyId="companyId"
                            :projectId="projectData._id"
                            :sprintId="selectedTask.sprintId"
                            :taskId="selectedTask.id"
                            :isTaskDetailSideBar="isTaskDetail"
                            :selectedTask="selectedTask"
                            @toggleTaskDetail="toggleTaskDetail"
                        />
                    </div>

                    <ProjectSidebars
                        :filterUsers="filterUsers"
                        :assigneeFilterOptions="assigneeFilterOptions"
                        v-model:userSidebar="userSidebar"
                        v-model:isSidebar="isSidebar"
                        :sidebarTitle="sidebarTitle"
                        v-model:showColorAvatar="showColorAvatar"
                        :savingAvatar="savingAvatar"
                        :formData="formData"
                        :projectData="projectData"
                        :clientWidth="clientWidth"
                        @manageFilterUsers="manageFilterUsers"
                        @clearFilterUsers="filterUsers = []; manageFilterUsers()"
                        @resetFormData="resetFormData"
                        @saveAvatar="saveProjectAvatar"
                        @updateFormData="(v) => formData.projectProfileField = v"
                        @updateImage="updateImageValue"
                    />
                </template>
                <template v-else>
                    <template v-if="projectData?.isRestrict === true">
                        <div class="section-right bg-white" :class="[{'position-re': projectData?.isRestrict === true}]">
                            <UpgradYourPlanComponent
                                v-if="projectData?.isRestrict === true"
                                :buttonText="$t('Upgrades.upgrade_your_plan')"
                                :lastTitle="$t('Upgrades.to_unlcok_project')"
                                :secondTitle="$t('Upgrades.unlimited')"
                                :firstTitle="$t('Upgrades.upgrade_to')"
                                :message="$t('Upgrades.the_feature_not_available')"
                            />
                        </div>
                    </template>
                    <div v-else class="d-flex bg-light-gray align-items-center justify-content-center w-100 h-100">
                        <img :src="accessDenied" alt="accessDenied">
                    </div>
                </template>
            </template>
            <template v-else>
                <ProjectEmptyState
                    :showArchivedProjects="showArchivedProjects"
                    :canCreate="checkPermission('project.project_list',projectData.isGlobalPermission) === true && checkPermission('project.project_create',projectData.isGlobalPermission) === true"
                    :isFilterHasData="isFilterHasData"
                    :currentCompany="currentCompany"
                    @createProject="openSidebar"
                    @createAiProject="openAiCreator"
                    @hideArchive="handleUnarchived"
                />
            </template>
        </template>

        <ProjectBottomModals
            :clientWidth="clientWidth"
            :projectAddView="projectAddView"
            :projectData="projectData"
            :users="users"
            v-model:openProjectWatcher="openProjectWatcher"
            v-model:showSidebar="showSidebar"
            :archive="archive"
            :showSpinner="showSpinner"
            :isActiveCreateSidebar="isActiveCreateSidebar"
            :isAdvanceFilterApplied="isAdvanceFilterApplied"
            :isActiveAiCreator="isActiveAiCreator"
            v-model:permissionSidebar="permissionSidebar"
            :showDriverSidebar="showDriverSidebar"
            :openAiSidebar="openAiSidebar"
            @confirmArchive="updateProject()"
            @closeCreateSidebar="closeSidebar"
            @closeAiCreator="isActiveAiCreator = false"
            @aiProjectCreated="onAiProjectCreated"
            @tourModalAccept="currentVideoUrl == 0 ? updateTourStatusInUser('isProjectAndNavbarTour') : ''"
            @tourModalClose="closeModal"
            @closeAiSidebar="openAiSidebar = false"
        />
    </div>
    <div v-else class="d-flex align-items-center justify-content-center w-100 h-100">
        <img :src="accessDenied" alt="accessDenied">
    </div>
    <!-- Multi-select bulk action bar — renders only when tasks are selected -->
    <BulkActionBar />
</template>

<script setup>
// PACKAGES
import { computed, defineComponent, inject, onMounted, provide, ref, watch, onUnmounted, nextTick } from 'vue';
import isEqual from 'lodash/isEqual';
import { useStore } from 'vuex';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useCustomComposable, useGetterFunctions } from '@/composable';
import { useValidation } from '@/composable/Validation';
import { projectComponentsIcons } from '@/composable/commonFunction';

// COMPONENTS
import ConfirmationSidebar from '@/components/molecules/ConfirmationSidebar/ConfirmationSidebar.vue';
import BulkActionBar from '@/components/molecules/BulkActionBar/BulkActionBar.vue';
import WasabiImage from '@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue';
import ProjectListing from './ProjectsListing/ProjectListing.vue';
import ViewsDropdown from '@/components/molecules/ProjectViews/ViewsDropdown.vue';
import UpgradYourPlanComponent from '@/components/atom/UpgradYourPlanComponent/UpgradYourPlanComponent.vue';
import ProjectDetailRightSide from '@/components/organisms/ProjectDetailRightSide/ProjectDetailRightSide.vue';
import DropDown from '@/components/molecules/DropDown/DropDown.vue';
import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue';
import TaskDetail from '@/views/TaskDetail/TaskDetail.vue';
import ViewsList from '@/components/atom/ViewsList/ViewsList.vue';
import InputText from '@/components/atom/InputText/InputText.vue';

// VIEWS (async-loaded so each tab pulls its own chunk on demand)
import { defineAsyncComponent } from 'vue';
const ProjectListView = defineAsyncComponent(() => import(/* webpackChunkName: "project-list-view" */ './ListView/ListView.vue'));
const Comments = defineAsyncComponent(() => import(/* webpackChunkName: "project-comments" */ '@/views/Projects/Comments/Comments.vue'));
const ActivityLog = defineAsyncComponent(() => import(/* webpackChunkName: "project-activity-log" */ '@/views/Projects/ActivityLog/ActivityLog.vue'));
const WorkloadView = defineAsyncComponent(() => import(/* webpackChunkName: "project-workload" */ '@/views/Projects/WorkloadView/WorkloadView.vue'));
const BoardView = defineAsyncComponent(() => import(/* webpackChunkName: "project-kanban" */ '@/views/Projects/Kanban/BoardView.vue'));
const ProjectDetail = defineAsyncComponent(() => import(/* webpackChunkName: "project-detail" */ '@/views/Projects/ProjectDetail/ProjectDetail.vue'));
const TableViewComp = defineAsyncComponent(() => import(/* webpackChunkName: "project-table-view" */ '@/views/Projects/TableView/TableView.vue'));
const EmbedViewItem = defineAsyncComponent(() => import(/* webpackChunkName: "embed-view" */ '@/components/molecules/EmbedView/EmbedViewItem.vue'));
const ReportsView = defineAsyncComponent(() => import(/* webpackChunkName: "project-reports" */ '@/views/Projects/Reports/ReportsView.vue'));
const GanttViewComp = defineAsyncComponent(() => import(/* webpackChunkName: "project-gantt" */ '@/views/Projects/GanttView/GanttView.vue'));
const RecurringTasksComp = defineAsyncComponent(() => import(/* webpackChunkName: "project-recurring" */ '@/views/Projects/RecurringTasks/RecurringTasksManager.vue'));
const TimelineViewComp = defineAsyncComponent(() => import(/* webpackChunkName: "project-timeline" */ '@/views/Projects/TimelineView/TimelineView.vue'));
const MindMapViewComp = defineAsyncComponent(() => import(/* webpackChunkName: "project-mindmap" */ '@/views/Projects/MindMapView/MindMapView.vue'));
const WhiteboardViewComp = defineAsyncComponent(() => import(/* webpackChunkName: "project-whiteboard" */ '@/views/Projects/WhiteboardView/WhiteboardView.vue'));
const CanvasViewComp = defineAsyncComponent(() => import(/* webpackChunkName: "project-canvas" */ '@/views/Projects/CanvasView/CanvasView.vue'));
const MapViewComp = defineAsyncComponent(() => import(/* webpackChunkName: "project-map" */ '@/views/Projects/MapView/MapView.vue'));
import NotFound from '../NotFound.vue';

// EXTRACTED PIECES
import ProjectActionsBar from './components/ProjectActionsBar.vue';
import ProjectFiltersToolbar from './components/ProjectFiltersToolbar.vue';
import AiTaskCreator from '@/components/organisms/AiTaskCreator/AiTaskCreator.vue';
import ProjectSidebars from './components/ProjectSidebars.vue';
import ProjectBottomModals from './components/ProjectBottomModals.vue';
import ProjectEmptyState from './components/ProjectEmptyState.vue';
import { useProjectCalendar } from './composables/useProjectCalendar';
import { useProjectRules } from './composables/useProjectRules';
import { useProjectNameEdit } from './composables/useProjectNameEdit';
import { useProjectAssignee } from './composables/useProjectAssignee';
import { useEmbedViews } from './composables/useEmbedViews';
import { useProjectLifecycle } from './composables/useProjectLifecycle';
import { useProjectAvatar } from './composables/useProjectAvatar';
import { useProjectSearch } from './composables/useProjectSearch';
import { useProjectTour } from './composables/useProjectTour';

import { useProjectsHelper } from './helper';

// UTILS
const { checkErrors } = useValidation();
const { t, te } = useI18n();
// Short display label for a view tab: the ViewList i18n value drops the "View"
// suffix (e.g. "Map View" → "Map"); fall back to the raw name for custom/embed views.
const viewLabel = (name) => (name && te(`ViewList.${name}`)) ? t(`ViewList.${name}`) : (name || 'N/A');
const { projects, filteredProjects, dispatchProjects } = useProjectsHelper();
const showArchivedProjects = ref(false);
const isAdvanceFilterApplied = ref(false);
const isFilterHasData = ref(false);
const sprintLoading = ref(false);
provide('showArchivedProjects', showArchivedProjects);

const currentVideoUrl = ref(0);
const openAiSidebar = ref(false);
const showDriverSidebar = ref(false);
const showAiTaskCreator = ref(false);
const skipWatcher = ref(false);
const socket = inject('$socket');

defineComponent({
    name: 'Projects-Page',
});

// Reactive Variables to show the progress of the tasks being imported
const progress = ref(0);
const showLoader = ref(false);

provide('progress', progress);
provide('showLoader', showLoader);

const currentProgress = ref(0);

const circleStyle = computed(() => ({
    background: `conic-gradient(#4caf50 0% ${currentProgress.value}%, #ddd ${currentProgress.value}% 100%)`,
}));

watch(progress, (newVal) => {
    animateProgress(newVal);
});

function animateProgress(target) {
    const step = () => {
        if (currentProgress.value < target) {
            currentProgress.value++;
            requestAnimationFrame(step);
        } else if (currentProgress.value === 100) {
            setTimeout(() => {
                currentProgress.value = 0;
                progress.value = 0;
                showLoader.value = false;
            }, 1200);
        }
    };
    requestAnimationFrame(step);
}

const { getters, commit, dispatch } = useStore();

const companyUserDetail = computed(() => getters['settings/companyUserDetail']);
const myCounts = computed(() => getters['users/myCounts']?.data || {});

const userId = inject('$userId');
// template ref: bound via ref="embeddropdown" in the View list DropDown,
// accessed via $refs in @closeDropdown handler.
// eslint-disable-next-line no-unused-vars
const embeddropdown = ref(null);
const isVisible = ref(true);
const isVisibleProjectDetial = ref(true);
// `visible` was a separate ref in the original (initialized false) and
// mutated by clientWidth watcher / onMounted / open('searchIcon') /
// handleUnarchived. Kept separate from `isVisible` to preserve original
// behavior (the template binds isVisible, not visible).
const visible = ref(false);
const openProjectWatcher = ref(false);

const isActiveCreateSidebar = ref(false);
const permissionSidebar = ref(false);
const projectSearchText = ref('');

const filterFavorites = ref(localStorage.getItem('favoriteFilter') == 'true');
const clientWidth = inject('$clientWidth');
const route = useRoute();
const router = useRouter();
const responseWidth = 1300;
const sidebarArrowIcon = require('@/assets/images/svg/sidebarclose_arrow.svg');
const projectStar = require('@/assets/images/svg/start13.svg');
const blankStar = require('@/assets/images/svg/blankStar.svg');
const viewDefaultIcon = require('@/assets/images/svg/list_home_icon.svg');
const viewDefaultActive = require('@/assets/images/svg/blue_tick.svg');
const projectList = ref();

const companyId = inject('$companyId');
const { checkPermission, makeUniqueId } = useCustomComposable();
const { getUser } = useGetterFunctions();

// IMAGES
const accessDenied = require('@/assets/images/access_denied_img.png');
const listDropIcon = require('@/assets/images/svg/list_view_dropicon.svg');
const publicIcon = require('@/assets/images/svg/public_folder.svg');
const addIcon = require('@/assets/images/Shape 614.png');
const publicFolder = require('@/assets/images/public_folder.png');
const whiteDownArrow = require('@/assets/images/svg/embed_drop_arrow.svg');
const deleteImage = require('@/assets/images/svg/delete-red.svg');
const renameImage = require('@/assets/images/svg/rename.svg');
const saveImage = require('@/assets/images/save.png');
const cancelImage = require('@/assets/images/svg/deletered.svg');
const threedots = require('@/assets/images/svg/tagdots.svg');
const copy = require('@/assets/images/svg/copy-link.svg');

const projectData = ref({});
const showArchived = ref(false);
const assigneeFilterOptions = ref([]);

// COMPOSABLES
const { calendartoggle, rangeObject, calendarDate, calenderSelectDate, prevMonth, nextMonth, defaultMonth, handleStartEndDate, rangeObjectFRun, calendarDateChange } = useProjectCalendar();
const { isRuleData, rulePermission, getProjectRule } = useProjectRules();
const { editProject, projectName, updateProjectName } = useProjectNameEdit(projectData);
const { changeAssignee } = useProjectAssignee(projectData);
const { archive, showSidebar, showSpinner, updateProject, markProjectFavourite } = useProjectLifecycle(projectData);
const { showColorAvatar, savingAvatar, formData, resetFormData, assignAvatarData, updateImageValue, saveProjectAvatar } = useProjectAvatar(projectData);
const { taskSearch, taskNameSearch, taskKeySearch, taskDescriptionSearch, filterUsers, searchTask, collapsed, groupBy, userSidebar, resetFilters, toggleSearch, searchMongoDB, manageFilterUsers, applyFilter, clearFilter } = useProjectSearch(projectData, showArchived);
const { runProjectStartupTours, hanldeBlankProjectTour, hanldeProjectTaktypeTour, hanldeProjectLastStep } = useProjectTour();

const Uid = ref('embed' + makeUniqueId(6));
const renameValue = ref('');
const openDelete = ref({ flag: false, data: '' });
const selectedEmbedView = ref('');
const embedViewName = ref('');
const activeTab = ref('ProjectListView');
const embedViews = ref([]);
const projectView = ref(`projectView${makeUniqueId(6)}`);
const projectAddView = ref(`projectAddView${makeUniqueId(6)}`);
const companyUserData = computed(() => getters['settings/companyUsers']);
const companyUser = ref('');
const viewsListArray = ref([]);
const loadingProjects = ref(false);

const { copyToClipboard, editViewName, deleteEmbedView } = useEmbedViews(projectData, embedViews, companyUser, renameValue, openDelete, selectedEmbedView);
// openEmbedView lives in the parent because it mutates activeTab/selectedEmbedView refs owned here
const openEmbedView = (item) => {
    embedViewName.value = item?.name;
    activeTab.value = 'EmbedView';
    router.replace({ query: { tab: 'EmbedView', eid: item.id } });
    selectedEmbedView.value = item;
};

provide('taskCollapsed', collapsed);
provide('searchedTask', searchTask);
provide('showArchived', showArchived);
provide('selectedProject', projectData);
provide('isSupport', ref(false));

const icons = ref({
    Anything_url: require('@/assets/images/svg/anything.svg'),
    Anything_html: require('@/assets/images/svg/anything.svg'),
    Docs: require('@/assets/images/svg/Googledocs.svg'),
    Sheets: require('@/assets/images/svg/googlesheets.svg'),
    Youtube: require('@/assets/images/svg/Youtube.svg'),
    Figma: require('@/assets/images/svg/figma.svg'),
});
const groupByOptions = ref([
    { label: 'status', image: require('@/assets/images/groupbySattus.png'), id: 0 },
    { label: 'priority', image: require('@/assets/images/groupbyFlag.png'), id: 2 },
    { label: 'due_date', image: require('@/assets/images/calendar_month.png'), id: 3 },
]);

const projectDetailPermission = computed(() => checkPermission('project.project_details', projectData.value.isGlobalPermission, { gettersVal: getters }));

watch(projectData, (newVal, oldVal) => {
    if (newVal._id != oldVal._id) {
        const data = newVal;
        getProjectRule(data);
        selectedEmbedView.value = !(route?.query?.eid) ? '' : embedViews.value.filter((item) => item.id == route.query.eid)[0];
        if (!showArchivedProjects.value) {
            showArchived.value = false;
        }
        resetFilters();
    }
    getChange();
});

watch(() => companyUserData, () => {
    getChange();
}, { deep: true });

watch(route, (newVal) => {
    if (newVal.query.tab === 'comment') {
        activeTab.value = `Comments`;
    }
});

watch(() => projectDetailPermission.value, () => {
    getChange();
});

watch(activeTab, (newVal, oldVal) => {
    if (newVal !== oldVal) {
        document.getElementById(activeTab.value)?.scrollIntoView();
    }
});

watch([() => embedViews.value, () => projectData.value, () => route], ([newEmbedView, newProject, newRoute], [, oldProject]) => {
    if (newRoute.query.tab === 'EmbedView') {
        if (!newEmbedView.length && isEqual(newProject._id, oldProject._id)) {
            activeTab.value = 'ProjectListView';
            router.replace({ query: { tab: 'ProjectListView' } });
        } else if (newEmbedView.length) {
            if (newEmbedView[0].id === route.query.eid) {
                selectedEmbedView.value = newEmbedView[0];
            } else {
                selectedEmbedView.value = newEmbedView.find((item) => item.id === route.query.eid) || newEmbedView[0];
            }

            nextTick(() => {
                loadingProjects.value = false;
            });
        }
    }
});

watch(clientWidth, () => {
    if (clientWidth.value < 765) {
        if (visible.value) {
            visible.value = false;
        }
    }
});

const isActiveAiCreator = ref(false);
const currentCompany = computed(() => getters['settings/selectedCompany']);
const openSidebar = () => {
    isActiveCreateSidebar.value = true;
};
function closeSidebar(value) {
    isActiveCreateSidebar.value = value;
}
const openAiCreator = () => {
    isActiveAiCreator.value = true;
};
async function onAiProjectCreated({ projectId }) {
    if (!projectId) {
        isActiveAiCreator.value = false;
        return;
    }
    try {
        // Refresh the projects list so the newly AI-created project is in
        // the Vuex store. We `await` here because the next step needs to
        // find it; without the await we'd race the store update and almost
        // always miss the new project.
        await dispatch('projectData/setProjects', { roleType: 'currentUser' });

        const projectsData = (getters['projectData/projects'] && getters['projectData/projects'].data) || [];
        const newProject = projectsData.find((p) => String(p._id) === String(projectId));

        // Re-use the sidebar's selection flow. `mutateCurrentProjectDetails`
        // does ALL the work clicking a project in the left sidebar does:
        //   - expands the project in the sidebar
        //   - computes the correct `?tab=` query from the project's
        //     ProjectRequiredComponent (falls back to 'ProjectListView')
        //   - pushes the route with full params + query
        //   - commits the project to Vuex (`projectData/mutateCurrentProjectDetails`)
        //   - emits `update:projectData` up to this component, whose existing
        //     watcher then loads sprints + tasks
        //
        // Plain `router.push` alone skips the Vuex commit and the
        // update:projectData emit, so the main panel renders before the
        // active-project state is set and the user sees "No Data Found"
        // until they manually click the project in the sidebar.
        if (newProject && projectList.value && typeof projectList.value.mutateCurrentProjectDetails === 'function') {
            projectList.value.mutateCurrentProjectDetails(newProject, true, true);
        } else {
            // Defensive fallback: at minimum get the user to the right URL
            // with the tab query even if we couldn't reach the sidebar
            // component (e.g. it failed to mount).
            const cid = (currentCompany.value && currentCompany.value._id) || route.params.cid;
            router.push({
                name: 'Project',
                params: { cid, id: projectId },
                query: { tab: 'ProjectListView' },
            });
        }
    } catch (_e) { /* ignore */ }
    isActiveAiCreator.value = false;
}

const getChange = () => {
    companyUser.value = (companyUserData.value.filter((item) => userId.value == item.userId))[0];
    const userTabs = (companyUser.value?.ProjectRequiredComponent)
        ? (Object.entries(companyUser.value?.ProjectRequiredComponent)).map((element) => ({ uniqueId: element[0], ...element[1] })).filter((item) => item.projectId === projectData.value._id)
        : [];
    const Tabs2 = projectData.value.ProjectRequiredComponent?.filter((item) => item._id.length > 6);
    const ids = projectData.value.ProjectRequiredComponent?.map((item) => item._id);
    viewsListArray.value = [...(userTabs.filter((element) => element.id.length > 6 && (!ids.includes(element.id)))), ...Tabs2].sort((a, b) => !(a.isPin) ? 0 : (a.isPin == b.isPin ? 0 : (((!a.isPin && b.isPin) ? 1 : -1))));
    embedViews.value = ([...projectData.value.ProjectRequiredComponent.filter((item) => item._id.length == 6), ...(userTabs.filter((element) => element.id.length == 6))].sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase()) ? -1 : ((b.name.toLowerCase() < a.name.toLowerCase()) ? 1 : 0))).sort((a, b) => !(a.isPin) ? 0 : (a.isPin == b.isPin ? 0 : (((!a.isPin && b.isPin) ? 1 : -1))));
    if (projectDetailPermission.value === null) {
        viewsListArray.value = viewsListArray.value.filter((item) => item.keyName !== 'ProjectDetail');
    }
};

function checkSprint(sprintData) {
    let addSprint = false;
    if (!showArchived.value) {
        addSprint = (sprintData?.deletedStatusKey === 0 || sprintData?.deletedStatusKey === undefined) && sprintData._id;
    } else {
        addSprint = (sprintData?.deletedStatusKey === 2) && sprintData._id;
        if (!addSprint && getters['projectData/searchedTasks']?.length) {
            addSprint = getters['projectData/searchedTasks'].filter((task) => task.sprintId === sprintData.id).length;
        }
    }

    return addSprint;
}

async function assignProjects(data = []) {
    await filteredProjects(JSON.parse(JSON.stringify(data)), showArchivedProjects.value, filterFavorites.value);
    nextTick(() => {
        loadingProjects.value = false;
    });
}

watch(showArchivedProjects, (newVal, oldVal) => {
    if (newVal !== oldVal && projectData.value && Object.keys(projectData.value)?.length) {
        loadingProjects.value = true;
    }
});

watch([() => getters['projectData/projects'], showArchivedProjects, route, filterFavorites], ([data]) => {
    localStorage.setItem('favoriteFilter', filterFavorites.value);
    if (data.data && data.data.length) {
        assignProjects(data.data);
    } else if (showArchivedProjects.value) {
        loadingProjects.value = false;
    }
}, { deep: true });

onMounted(() => {
    if (clientWidth.value <= 1300) {
        visible.value = true;
        projectList.value.toggleSidebar(true);
    }
    loadingProjects.value = true;
    dispatchProjects()
        .then(() => {
            nextTick(() => {
                if (getters['projectData/projects'] && getters['projectData/projects']?.data?.length) {
                    if (!route.query?.tab) {
                        if (route.params.id) {
                            const index = projects.value.findIndex((e) => e._id === route.params.id);
                            if (index !== -1) {
                                const viewFind = projects.value[index].ProjectRequiredComponent?.find((e) => e.setAsDefault) || projects.value[index].ProjectRequiredComponent?.find((e) => e.viewStatus) || projects.value[index].ProjectRequiredComponent[0];
                                router.replace({ query: { tab: (viewFind ? viewFind?.keyName : 'ProjectListView'), ...route.query } });
                            }
                        } else {
                            const viewFind = projects.value[0]?.ProjectRequiredComponent?.find((e) => e.setAsDefault) || projects.value[0]?.ProjectRequiredComponent?.find((e) => e.viewStatus) || projects.value[0]?.ProjectRequiredComponent[0];
                            router.replace({ query: { tab: (viewFind ? viewFind?.keyName : 'ProjectListView'), ...route.query } });
                        }
                    }
                }
                loadingProjects.value = false;
            });
        })
        .catch((error) => {
            nextTick(() => {
                loadingProjects.value = false;
            });
            console.error('ERROR: in set projects: ', error);
        });
    if (getters['projectData/projects'] && getters['projectData/projects']?.data?.length) {
        assignProjects(getters['projectData/projects'].data);
    }
    setTimeout(() => {
        runProjectStartupTours(projects.value.length);
    }, 1500);
});
onUnmounted(() => {
    socket.value.emit('getRoomList', socket.value.id, (rooms) => {
        const currentSocketRooms = rooms.find((x) => x.includes(socket.value.id) && x.includes('project_sprint_'));
        if (currentSocketRooms) {
            socket.value.emit('leaveProjectSprintForTask', currentSocketRooms);
            const sprintId = currentSocketRooms.split('**')[0].split('_').pop();
            commit('projectData/setGetPaginatedTasksPayload', { data: { projectData, pid: projectData.value._id }, op: 'remove' });
            commit('projectData/setGetTableTaskPayload', { data: { sprintId, pid: projectData.value._id }, op: 'remove' });
            const events = ['taskInsert', 'taskUpdate', 'taskDelete', 'taskReplace'];
            events.forEach((event) => {
                socket.value.off(event);
            });
        }
    });
});

// UPDATE PROJECT DATA ON UPDATES IN DATABASE
watch([projects, route], () => {
    if (projects.value && route?.params?.id && projectData.value && Object.keys(projectData.value).length) {
        if (route.params.id !== projectData.value._id) {
            searchMongoDB();
        }

        if (projects.value && projects.value.length) {
            const index = projects.value.findIndex((x) => x._id == projectData.value._id);
            if (index !== -1) {
                projectData.value = projects.value[index] || {};
            } else {
                projectData.value = projects.value[0] || {};
            }
        }
    }
});

watch(route, () => {
    if (projects.value && route?.params?.id && projectData.value && Object.keys(projectData.value).length && route.params.id !== projectData.value._id) {
        const index = projects.value.findIndex((x) => x._id == route.params.id);
        if (index !== -1) {
            projectData.value = projects.value[index] || {};
        } else {
            router.replace({ name: 'Project', params: { cid: route.params?.cid, id: route.params?.id }, query: { ...route.query } });
            projectData.value = projects.value[0] || {};
        }
    }
});

const sprints = ref([]);

// UPDATE/FILTER SPRINTS ARRAY FOR LISTING
watch([projectData, route, () => getters['projectData/searchedTasks']], () => {
    if (skipWatcher.value) return;
    if (!route.name.toLowerCase().includes('project')) return;
    let tmp = sprints.value;
    if (!projectData.value || !Object.keys(projectData.value).length) return;
    const projectId = route.params?.id ? route.params.id : projectData.value._id;
    let project;
    if (projectSearchText.value === '') {
        project = getters['projectData/projects']?.data?.find((x) => x._id === projectId) || null;
    } else {
        project = getters['projectData/searchedProjects']?.find((x) => x._id === projectId) || null;
    }

    if (!project) return;

    try {
        if (route.name === 'Projects' || route.name === 'Project') {
            tmp = project?.sprintsObj && Object.values(project?.sprintsObj).length ? Object.values(project.sprintsObj).filter((x) => checkSprint(x)) : [];
            Object.values(project.sprintsfolders || {}).forEach((value) => {
                try {
                    if (showArchived.value && value?.deletedStatusKey === 2) {
                        tmp.push({
                            name: value.name,
                            id: value.folderId,
                            isExpanded: false,
                            items: [],
                            archivedSprintList: value.sprintsObj || {},
                            deletedStatusKey: 2,
                            isFolder: true,
                        });
                    } else if (showArchived.value && !value?.deletedStatusKey) {
                        tmp = [
                            ...tmp,
                            ...(Object.values(value?.sprintsObj || {})?.length ? Object.values(value.sprintsObj || {}).filter((x) => checkSprint(x)) : []),
                        ];
                    } else if (!showArchived.value && !value?.deletedStatusKey) {
                        tmp = [
                            ...tmp,
                            ...(Object.values(value?.sprintsObj || {})?.length ? Object.values(value?.sprintsObj || {}).filter((x) => checkSprint(x)) : []),
                        ];
                    }
                } catch (error) {
                    console.error('ERROR: ', error, value);
                }
            });
        } else if (route.name.includes('ProjectFolder')) {
            if (route.params.sprintId && !project?.sprintsfolders?.[route.params.folderId]?.deletedStatusKey) {
                const sprintIndex = Object.values(project?.sprintsfolders?.[route.params.folderId]?.sprintsObj || {})?.findIndex((x) => x.id === route.params.sprintId);
                if (sprintIndex !== -1) {
                    tmp = [Object.values(project.sprintsfolders[route.params.folderId].sprintsObj)[sprintIndex]];
                } else {
                    tmp = [];
                }
            } else {
                if (project.sprintsfolders?.[route.params.folderId]?.deletedStatusKey === 2) {
                    if (showArchived.value) {
                        const val = project.sprintsfolders?.[route.params.folderId];
                        tmp = [{
                            name: val.name,
                            id: val.folderId,
                            isExpanded: false,
                            archivedSprintList: project?.sprintsfolders?.[route.params.folderId]?.sprintsObj || {},
                            items: [],
                            deletedStatusKey: 2,
                            isFolder: true,
                        }];
                    } else {
                        tmp = [];
                    }
                } else {
                    tmp = Object.values(project.sprintsfolders[route.params.folderId]?.sprintsObj || {})?.length ? Object.values(project.sprintsfolders[route.params.folderId].sprintsObj).filter((x) => checkSprint(x)) : [];
                }
            }
        } else if (route.name.includes('ProjectSprint')) {
            const sprintsArray = Object.values(project?.sprintsObj || {});
            const sprintIndex = sprintsArray.findIndex((x) => x.id === route.params.sprintId && (!showArchived.value ? (x?.deletedStatusKey === 0 || x?.deletedStatusKey === undefined) : true));
            if ((companyUserDetail.value.roleType === 1 || companyUserDetail.value.roleType === 2) || (sprintIndex !== -1 && (!sprintsArray[sprintIndex]?.private || sprintsArray[sprintIndex]?.AssigneeUserId?.includes(userId.value)))) {
                tmp = sprintIndex !== -1 ? [sprintsArray[sprintIndex]] : [];
            } else {
                tmp = [];
            }
        }
    } catch (error) {
        console.error(error, 'Error');
    }

    if (companyUserDetail.value.roleType !== 1 && companyUserDetail.value.roleType !== 2) {
        tmp = tmp.filter((x) => !x?.private || x?.AssigneeUserId?.includes(userId.value));
    }

    tmp = tmp.sort((a, b) => a?.createdAt?.seconds > b?.createdAt?.seconds ? -1 : 1);

    if (searchTask.value) {
        if (getters['projectData/searchedTasks']?.length) {
            if (showArchived.value) {
                tmp = tmp?.filter((x) => getters['projectData/searchedTasks'].filter((y) => y.sprintId === x.id || x.isFolder === true || x.deletedStatusKey === 2).length) || [];
            } else {
                tmp = tmp?.filter((x) => getters['projectData/searchedTasks'].filter((y) => y.sprintId === x.id || x.isFolder === true).length) || [];
            }
        } else {
            tmp = tmp?.filter((x) => x.isFolder || x.deletedStatusKey === 2);
        }
    }

    tmp = tmp.filter((x) => x && x?.deletedStatusKey !== 1);
    tmp = tmp?.filter((x) => (showArchived.value ? (x?.deletedStatusKey === 2 || x.archiveTaskCount) : !x?.deletedStatusKey));

    if (!tmp.length && !showArchived.value) {
        if (route.params?.cid && route.params?.id === project.id && ['ProjectListView', 'ProjectKanban', 'Calendar', 'TableView'].includes(route.params?.tab || '')) {
            let tab = route.query?.tab;
            if (!project?.ProjectRequiredComponent?.find((x) => x.keyName === route.query?.tab)) {
                const viewFind = project?.ProjectRequiredComponent?.find((e) => e.setAsDefault) || project?.ProjectRequiredComponent?.find((e) => e.viewStatus) || project?.ProjectRequiredComponent[0];
                tab = viewFind ? viewFind?.keyName : 'ProjectListView';
            }
            if (route.params?.id) {
                router.replace({ name: 'Project', params: { cid: route.params?.cid, id: route.params?.id }, query: { ...route.query, tab } });
            } else {
                router.replace({ name: 'Projects', params: { cid: route.params?.cid }, query: { ...route.query, tab } });
            }
        }
    }
    if (!isEqual(tmp, sprints.value)) {
        sprints.value = tmp;
    }

    if (project && project?.ProjectRequiredComponent?.length) {
        if ((route.query && route.query.tab && (project?.ProjectRequiredComponent.filter((x) => x.keyName === route.query.tab || x.id != route.query.eid).length)) || route.query.tab == 'EmbedView') {
            activeTab.value = route.query.tab;
        } else {
            activeTab.value = route.query.tab ? route.query.tab : 'ProjectListView';
        }
    } else {
        activeTab.value = 'ProjectListView';
    }

    assigneeFilterOptions.value = [];
    let usersArr = [];
    if (project.isPrivateSpace) {
        usersArr = project.AssigneeUserId;
    } else {
        usersArr = users.value.map((x) => x._id);
    }

    usersArr.forEach((x) => {
        if (x !== userId.value) {
            const user = getUser(x);
            if (!user.ghostUser) {
                assigneeFilterOptions.value.push({
                    value: x,
                    label: user.Employee_Name,
                    image: user.Employee_profileImageURL,
                });
            }
        }
    });
    assigneeFilterOptions.value = assigneeFilterOptions.value.sort((a, b) => a.label?.trim()?.toLowerCase().localeCompare(b.label?.trim()?.toLowerCase()));
}, { deep: true });

function getView(val) {
    switch (val) {
        case 'ProjectListView':
            return ProjectListView;
        case 'Comments':
            return Comments;
        case 'ActivityLog':
            return ActivityLog;
        case 'ProjectDetail':
            return projectDetailPermission.value == null ? NotFound : ProjectDetail;
        case 'EmbedView':
            return EmbedViewItem;
        case 'Workload':
            return WorkloadView;
        case 'TableView':
            return TableViewComp;
        case 'Calendar':
            return ProjectListView;
        case 'ProjectKanban':
            return BoardView;
        case 'Reports':
            return ReportsView;
        case 'GanttView':
            return GanttViewComp;
        case 'RecurringTasks':
            return RecurringTasksComp;
        case 'TimelineView':
            return TimelineViewComp;
        case 'MindMapView':
            return MindMapViewComp;
        case 'WhiteboardView':
            return WhiteboardViewComp;
        case 'CanvasView':
            return CanvasViewComp;
        case 'MapView':
            return MapViewComp;
        default:
            return NotFound;
    }
}

// Task Detail
const isTaskDetail = ref(false);
const selectedTask = ref({});

watch(() => route.params.taskId, (taskId) => {
    if (taskId && !isTaskDetail.value) {
        selectedTask.value = { id: taskId, sprintId: route.params.sprintId };
        isTaskDetail.value = true;
    } else if (!taskId) {
        isTaskDetail.value = false;
        selectedTask.value = {};
    }
}, { immediate: true });

const toggleTaskDetail = async (task) => {
    skipWatcher.value = true;
    const routeObj = {
        cid: companyId.value,
        id: task.ProjectID,
        sprintId: task.sprintId,
    };
    if (task.folderObjId) {
        routeObj.folderId = task.folderObjId;
    }

    if (!isTaskDetail.value) {
        routeObj.taskId = task._id;
        const taskDetail = { ...task, sprintName: task?.sprintArray?.name, folderName: task?.sprintArray?.folderName, id: task._id };
        selectedTask.value = taskDetail;
        isTaskDetail.value = true;
        await router.push({ name: task.folderObjId?.length ? 'ProjectFolderSprint' : 'ProjectSprint', params: routeObj });
        await router.push({ name: task.folderObjId?.length ? 'ProjectFolderSprintTask' : 'ProjectSprintTask', params: routeObj, query: { ...route.query, detailTab: 'task-detail-tab' } });
    } else {
        isTaskDetail.value = false;
        selectedTask.value = {};
        await router.push({ name: task.folderObjId?.length ? 'ProjectFolderSprint' : 'ProjectSprint', params: routeObj, query: { tab: route.query.tab } });
    }
    await nextTick();
    skipWatcher.value = false;
};
provide('toggleTaskDetail', toggleTaskDetail);
provide('isRouteRequired', true);
provide('hanldeBlankProjectTour', hanldeBlankProjectTour);
provide('hanldeProjectTaktypeTour', hanldeProjectTaktypeTour);
provide('hanldeProjectLastStep', hanldeProjectLastStep);

const users = computed(() => getters['users/users']);
const teams = computed(() => getters['settings/teams']);

const isSidebar = ref(false);
const sidebarTitle = ref('');
const open = (val) => {
    switch (val) {
        case 'filesLinks':
            isSidebar.value = true;
            sidebarTitle.value = t('Projects.files_links');
            break;
        case 'audio':
            isSidebar.value = true;
            sidebarTitle.value = t('Projects.audio_files');
            break;
        case 'searchIcon':
            visible.value = true;
            break;
        default:
            break;
    }
};
const billingPer = ref('');
const projectStartDate = ref({});
const handleEmitProjectRightSide = (action, value) => {
    if (action === 'billingPeriod') {
        projectData.value.BillingPeriod = value;
        billingPer.value = value;
    }
    if (action === 'startDate') {
        projectStartDate.value = value;
    }
    if (action === 'currency') {
        projectData.value.ProjectCurrency = value;
    }
    if (action === 'projectType') {
        if (value?.updateObject?.ProjectType) {
            projectData.value.ProjectType = value?.updateObject?.ProjectType || '';
        }
        if (value?.updateObject?.BillingPeriod) {
            projectData.value.BillingPeriod = value?.updateObject?.BillingPeriod || '';
        }
    }
};

const handleDescription = (value) => {
    isVisibleProjectDetial.value = value;
};
const handleViewName = (value) => {
    if (value === 'Project Details') {
        isVisibleProjectDetial.value = true;
    }
};

function openPermissionSidebar() {
    permissionSidebar.value = true;
}
const handleView = (view) => {
    activeTab.value = view.keyName;
    if (route.query.tab !== view.keyName) {
        router.push({
            query: {
                ...route.query,
                tab: view.keyName,
            },
        });
    }
};
function handleUnarchived() {
    showArchived.value = false;
    visible.value = !visible.value;
    showArchivedProjects.value = false;
}

// Tour modal handlers (kept inline since they touch local refs)
function updateTourStatusInUser() {
    showDriverSidebar.value = false;
}
function closeModal() {
    showDriverSidebar.value = false;
}

</script>
<style scoped>
@import "./style.css";

.show-archived-active {
    width: 100%;
    background-color: #FBE6D3 !important;
    height: 44px;
    padding: 0px 20px;
}

</style>
<style>
.viewlist-mobile-dropdown-new .dropdown_option{
    padding: 0px !important;
}
.project__components li{
    list-style: none !important;
}
.mark__project-favourite{
    width: 13.6px;
    height: 13px;
}
.mobile-projectlist-icon{
    margin-left: 6px;
    width: 28px;
    height: 28px;
}
.project__requirement{
    padding: 0px 10px 0 2px;
}
.project__requirement img{
    height: 10px;
    width: 12px;
}
.project__name-input{
    height: 20px !important;
    margin-left: 0px  !important;
}
.project__name-error{
    bottom: -10px;
    left: 0px;
}
.view__activeproject-name{
    width:35px;
    height:35px;
}
.addview__dropdown{
    border-color: #2F3990;
    background-color: white !important;
    margin-bottom: 0px !important;
    bottom: 0px;
}
.project__requirementcomponent-wrapper{
    max-width:120px;
}
.element__rename-id{
    max-width:100px !important;
}
.embeded__element-name{
    width:90px !important;
    margin-right: 4px;
}
.active__pin-img{
   height: 10px;
   width: 10px;
   margin-right: 5px;
}
.embed__options{
    height:20px !important;
    width:15px !important;
}
.save__cancel-img{
    height:10px !important;
    width:15px !important;
}
.search__icon-img{
    top: 3px;
}
.open__watcher{
    height: 30px;
    width: 30px;
}
.task-filtersearchassignee-wrapper{
    padding: 14px 20px 14px 20px;
}
.board-veiw-main-parent.list-view-body,
.board-veiw-main-parent .task-filtersearchassignee-wrapper {
    background-color: #FFF;
}
.board-veiw-main-parent .task-assigneesearch-groupbywrapper {
    margin-bottom: 0;
}
.dropdown-image-horizontal{
   right: 10px;
   top: 5px;
}
.search__in{
    line-height: 19px;
}
.current__dropdown{
   padding: 5px 10px 5px 2.58px;
}
.manage__filter-users{
    height: 30px;
}
.saving__avtar-div{
    top: 0px;
    left: 0px;
    background-color: #FFFFFFde !important;
}
.skelaton__option{
    height: 35px;
}
.empty__skelaton{
   height: 47px;
}
.driver-popover.driverjs-theme .driver-popover-close-btn {
    font-size: 17px !important;
}
.projecttour_driver_modal .cancel__icon-img {
    height: 12px !important;
    width: 12px !important;
}
.projecttour_driver_modal .outline-secondary {
    background: transparent;
    border: none;
    font-size: 16px;
    color: #2F3990;
    cursor: pointer;
}
.projecttour_driver_modal .btn-primary {
    font-size: 16px;
    width: 100px;
}
.ai_button{
    height: 30px;
    background: linear-gradient(270deg, #F241CD 0%, #4B5DEE 100%);
    border: 0px solid transparent;
    border-radius: 8px;
    color: #FFFFFF;
    box-shadow: 0px 5px 10px 0px #9941F24D;
    padding: 0px 15px 0px 15px;
    font-size: 13px;
}
.main_ai_image{
    top: 2px;
    right: 8px;
    position: relative;
}

.progress-container {
  width: 75px;
  height: 75px;
}
.progress-circle {
  width: 90%;
  height: 90%;
  border-radius: 50%;
  display: flex;
  justify-content: center;
  align-items: center;
  position: relative;
}
.progress-circle::before {
  content: "";
  width: 85%;
  height: 85%;
  background-color: #fff;
  border-radius: 50%;
  position: absolute;
}
.progress-text {
  position: absolute;
  font-size: 1.3em;
}
@media(max-width: 1024px){
.task-filter-assignee .ai_button.btn{
    margin-left: 0px;
  }
}
</style>
