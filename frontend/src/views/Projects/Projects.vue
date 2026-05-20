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
                                        <div v-else class="position-re project-titlerename-input ml-10px mr-5px" :class="{'list-type-error': projectName.error }" >
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
                                            <div class="red position-ab z-index-1 font-size-11 text-nowrap project__name-error">{{projectName.error}}</div>
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
                                                    <img :src="publicIcon"  v-if="!projectData.isPrivateSpace" class="pr-10px vertical-middle"   alt="public-folder"/>
                                                        <span class="font-size-14 text-ellipsis d-inline-block gray81 project__requirement">
                                                            <img :src="activeTab !== 'EmbedView' 
                                                                    ? projectComponentsIcons(projectData?.ProjectRequiredComponent?.find(x => x.keyName === activeTab)?.keyName)?.icon 
                                                                    : projectComponentsIcons(projectData?.ProjectRequiredComponent?.find(x => x.name === embedViewName)?.type)?.icon"  alt="list" class="mr-5px">
                                                            {{activeTab !== 'EmbedView' ? projectData?.ProjectRequiredComponent?.find(x => x.keyName === activeTab)?.name || "N/A" : embedViewName || "N/A"}}
                                                        </span>
                                                        <img :src="listDropIcon" alt="ListDropIcon" :style="[{marginLeft : clientWidth <=375 ? '2px' : '10px'}]" />
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
                                                                <span class="font-size-16 font-weight-500 text-ellipsis d-inline-block gray81 mw-66"  @click="handleViewName(view.name)">{{$t(`ViewList.${view.name}`)}}</span>
                                                            </div>
                                                            <span v-if="view.setAsDefault" class="mobile-defaultview-text font-size-12 font-weight-400 darkblue"><img class="list_make_as_defaultimg" :src="viewDefaultIcon" />
                                                                {{$t('Projects.default_view')}}
                                                            </span>
                                                            <img class="ml-20px activeTab-tick" v-if="activeTab === view.keyName" :src="viewDefaultActive"/>
                                                        </div>
                                                    </DropDownOption>
                                                    <DropDownOption class="position-sti border d-flex justify-content-center addview__dropdown" @click="$refs[projectView].click(), $refs.all_views_dd.click()">
                                                        <div class="blue font-size-18 font-weight-700">
                                                            + {{$t('Projects.add_view')}}
                                                        </div>
                                                    </DropDownOption>
                                                </template>
                                            </DropDown>
                                        </div>
                                    </div>
                                <div class="key-wapper" v-if="clientWidth > 767">
                                    <span class="text-ellipsis border-left font-size-13 text-uppercase key-text pl-11px pr-10px GunPowder"  :title="projectData.ProjectCode">
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
                                                        <div class="cursor-pointer d-flex embed-option justify-content-between"   @click="openEmbedView(element),$refs['project_tabs_components'].click()">
                                                            <div class="align-items-center d-flex" v-if="element.id != renameValue.id">
                                                                <img class="embed_view_dropdown mr-10-px" :src="icons[element.type]" alt="">
                                                                <span class="d-block text-ellipsis embeded__element-name" :title="element.name">{{element.name}}</span>
                                                            </div>
                                                            <div v-if="element.id == renameValue.id" @click.stop="">
                                                                    <InputText  v-model="renameValue.name"  :inputId="renameValue.id" :isDirectFocus="true" ></InputText>
                                                            </div>
                                                            <div v-if="element.id != renameValue.id" class="d-flex align-items-center p5x-0px" @click.stop="">
                                                                <img :src="require('@/assets/images/svg/active-pin.svg')" v-if="element?.isPin && element.isPin"  class="ml-10px active__pin-img">
                                                                <span class="notification-tick blinking position-sti ml-7px" v-if="element?.isPrivate"></span>                  
                                                                <DropDown :id="Uid">
                                                                        <template #button>         
                                                                            <img :src="threedots" :ref="Uid" class="vertical-middle" />
                                                                        </template>
                                                                        <template #options>
                                                                                    <div class="">
                                                                                        <ul class="p-0 m-0 justify-content-start cursor-pointer">
                                                                                            <li class="embed-edit-options" @click.stop="renameValue = {name:element.name,id:element.id}">
                                                                                                <img :src="renameImage" class="inner-tagedit-list-item embed__options"/>
                                                                                                <span>{{$t('Projects.rename')}}</span>
                                                                                            </li>
                                                                                            <li v-if="false" class="embed-edit-options" @click="$refs[Uid][index].click()">
                                                                                                <img :src="pin" class="inner-tagedit-list-item embed__options" />
                                                                                                <span>{{$t('Projects.pin')}}</span>
                                                                                            </li>
                                                                                            <li v-if="false" class="embed-edit-options" @click="$refs[Uid][index].click()">
                                                                                                <img :src="code" class="inner-tagedit-list-item embed__options" >
                                                                                                <span>{{$t('Projects.edit_code')}}</span>
                                                                                            </li>
                                                                                            <li class="embed-edit-options" @click="copyToClipboard(element.id),$refs[Uid][index].click()">
                                                                                                <img :src="copy" class="inner-tagedit-list-item embed__options" >
                                                                                                <span>{{$t('Projects.copy_link')}}</span>
                                                                                            </li> 
                                                                                            <li class="embed-edit-options cursor-pointer" @click.stop="openDelete = {flag:true,data:element},$refs[Uid][index].click(),$refs.project_tabs_components.click()">
                                                                                                <img :src="deleteImage" class="inner-tagedit-list-item embed__options"/>
                                                                                                <span class="red">{{$t('Projects.delete')}}</span>
                                                                                            </li>
                                                                                        </ul>
                                                                                    </div>
                                                                        </template>
                                                            </DropDown>
                                                            </div>
                                                            <div v-if="element.id == renameValue.id" class="d-flex align-items-center p5x-0px ml-5px" >
                                                                <img :src="saveImage" class="save__cancel-img"  @click.stop="() => { editViewName(element)}">
                                                                <img :src="cancelImage" class="save__cancel-img ml-5px" @click.stop="renameValue = {name:'',id:''} ">
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
                                    <div
                                        class="d-flex align-items-center text-nowrap border-top-radius-10-px cursor-pointer view-list-wrapper h-100"
                                    >
                                    <DropDown v-if="checkPermission('project.view_list',projectData.isGlobalPermission) === true" maxHeight="80vh" :bodyClass="{'embed__dropdown':true}" id="embeddropdown" >
                                        <template #button>
                                        <div ref="embeddropdown" id="embeddropdown_button" class="d-flex  align-items-center justify-content-center font-size-14 view-list-title p0x-10px">
                                            <img :src="addIcon" alt="addIcon" class="mr-10px">
                                            <span>{{$t('Projects.view')}}</span>
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
                            <div class="list-head-right">
                                <ul class="d-flex align-items-center m-0">
                                    <li v-if="clientWidth > 767">
                                        <img @click="open('filesLinks')" id="projectviewfiles_driver" :src="fileLinks" class="cursor-pointer"/>
                                    </li>
                                    <li class="ml-10px"  v-if="clientWidth > 767" :class="clientWidth>767 ? 'mr-10px' : 'm-0'">
                                        <img @click="open('audio')" id="projectviewaudio_driver" :src="audio" alt="audio" class="cursor-pointer"/>
                                    </li>
                                    <li v-if="clientWidth > 767">
                                        <div class="position-re">
                                            <a href.prevent="#" @click="openProjectWatcher = true" class="d-flex align-items-center justify-content-center border border-radius-5-px open__watcher cursor-pointer">
                                                <img id="projectviewwatch_driver" :src="eyeIcon">
                                            </a>
                                            <span class="sprint-watcher-count">{{ Object.keys(projectData?.watchers || {})?.length || 0 }}</span>
                                        </div>
                                    </li>
                                    <li :style="[{marginLeft : clientWidth > 767 ? '1rem' : '20px'}]" class="audio-list-wrapper" >
                                        <DropDown maxHeight="64dvh" class="audio_dropdown" :bodyClass="{'assigneelist-audiofile-dropdown' : true}"  >
                                            <template #head v-if="clientWidth<=767">
                                                <div class="mobiledropdown-projecttitleimage-wrapper">
                                                    <span v-if="projectData?.projectIcon && projectData?.projectIcon.type === 'color'" class="d-flex align-items-center justify-content-center ml-9px" :class="{'inital-box' : clientWidth > 767 , 'project-firtsleeter-box' : clientWidth <=767}" :style="[{'background-color': projectData?.projectIcon.data}]">{{ projectData?.ProjectName.charAt(0).toUpperCase()}}</span>
                                                    <template v-else-if="projectData?.projectIcon && projectData?.projectIcon?.type === 'image'">
                                                        <WasabiImage thumbnail="60x60" class="profile-sm-square mobile-projectlist-icon" v-if="!projectData.projectIcon.data.includes('http')" :data="{url: projectData.projectIcon.data, filename: projectData.projectIcon.data.split('/').pop(), extension: projectData.projectIcon.data.split('/').pop().split('.').pop()}"/>
                                                        <img v-else class="profile-sm-square mobile-projectlist-icon" :src="projectData.projectIcon.data" alt=""/>
                                                    </template>
                                                    <div class="list-text-wrapper">
                                                    <span v-if="!editProject2" class="text-ellipsis font-weight-bold text-capitalize black list-view-header-title ml-12px"  @dblclick="projectName.value = projectData?.ProjectName, editProject = true" :title="projectData.ProjectName">
                                                        {{ projectData?.ProjectName }} 
                                                    </span>
                                                    <!-- <span v-if="editProject2 ">
                                                        <input
                                                            type="text"
                                                            class="form-control"
                                                            v-model.trim="projectName.value"
                                                            placeholder="Project name"
                                                            style="height: 20px;"
                                                            :maxLength="250"
                                                            :minLength="3"
                                                            :isOutline="false"
                                                            :isDirectFocus="true"
                                                            @blur="editProject2 = false"
                                                            :style="{borderColor: !projectName.error.length ? '#cecece' : 'red'}"
                                                            @keypress.enter="projectName.value !== projectData?.ProjectName ? updateProjectName() : editProject2 = false"
                                                            @keyup="checkErrors({'field':projectName,
                                                            'name':projectName.name,
                                                            'validations':projectName.rules,
                                                            'type':projectName.type,
                                                            'event':$event.event})"
                                                        />
                                                        <div class="red position-ab z-index-1 font-size-11 text-nowrap" style="bottom: -10px; left: 0px;">{{projectName.error}}</div>
                                                    </span> -->
                                                </div>
                                                </div>
                                            </template>
                                            <template #button>
                                                <button class="cursor-pointer dot-btn border-0" :ref="`projectdd_${projectData._id || ''}`">
                                                    <img :src="clientWidth > 767 ? horizontalDots : horizontalDotsMobile" id="projectoptions_driver" />
                                                </button>
                                            </template>
                                            <template #options>
                                                <!-- <DropDownOption @click="toggleShowAllTasks(!projectData?.showAllTasks)" v-if="false">
                                                    <div class="d-flex justify-content-between w-100">
                                                        <span>Show all Tasks</span>
                                                        <Toggle :modelValue="projectData?.showAllTasks" @click="toggleShowAllTasks(!projectData?.showAllTasks)" class="filter-toggle" width="20"/>
                                                    </div>
                                                </DropDownOption> -->
                                                <div id="projectoptionslist_driver">
                                                    <DropDownOption v-if="projectData?.isPrivateSpace && clientWidth<=767" class="border-bottom mb-20px">
                                                        <Assignee
                                                            class="assignee-data ml-15px"
                                                            :users="projectData.AssigneeUserId"
                                                            :options="[...users.map((x) => x._id), ...teams.map((x) => 'tId_'+x._id)]"
                                                            :imageWidth="clientWidth>1024 ? '30px' : '25px'"
                                                            :num-of-users="clientWidth>1024 ? 4 : 2"
                                                            :addUser="checkPermission('project.project_assignee',projectData.isGlobalPermission) === true"
                                                            :showAddUser="true"
                                                            @selected="changeAssignee('add', $event)"
                                                            @removed="changeAssignee('remove', $event)"
                                                            :isDisplayTeam="true"
                                                            :z-index-assigne="8"
                                                        />
                                                    </DropDownOption>
                                                    <template v-if="clientWidth<=767" >
                                                        <DropDownOption @click="$refs[`projectdd_${projectData._id || ''}`].click(), openProjectWatcher = true">
                                                            <div :style="[{padding : clientWidth <= 767 ? '10px 0px !important' : '3.5px 10px !important'}]"  class="d-flex align-items-center">
                                                                <div class="position-re mr-15px">
                                                                    <div class="d-flex align-items-center justify-content-center border border-radius-5-px open__watcher">
                                                                        <img :src="eyeIcon">
                                                                    </div>
                                                                    <span class="sprint-watcher-count">{{ Object.keys(projectData?.watchers || {})?.length || 0 }}</span>
                                                                </div>
                                                                <span :class="{'font-size-16': clientWidth <= 767 }" class="font-weight-400 gray4b">{{$t('Projects.watchers')}}</span>
                                                            </div>
                                                        </DropDownOption>
                                                        <DropDownOption @click="$refs[`projectdd_${projectData._id || ''}`].click(), open('filesLinks')" >
                                                            <div class="d-flex align-items-center project-mobile-desc avtar-options" :class="`${clientWidth <= 767 ? 'project_detail_dropdown_wrapper' : ''}`">
                                                                <div class="d-flex align-items-center">
                                                                    <img :src="fileLink" class="mr-20px" />
                                                                </div>
                                                                <span :class="{'font-size-16': clientWidth <= 767 }" class="font-weight-400 gray4b">{{$t('Projects.files_links')}}</span>
                                                            </div>
                                                        </DropDownOption>
                                                        <DropDownOption @click="$refs[`projectdd_${projectData._id || ''}`].click(), open('audio')" class="border-bottom pb-20px">
                                                            <div class="d-flex align-items-center project-mobile-desc avtar-options" :class="`${clientWidth <= 767 ? 'project_detail_dropdown_wrapper' : ''}`">
                                                                <div class="d-flex align-items-center">
                                                                    <img :src="audioLinkMobile" class="mr-20px" />
                                                                </div>
                                                                <span :class="{'font-size-16': clientWidth <= 767 }" class="font-weight-400 gray4b">{{$t('Projects.audio_files')}}</span>
                                                            </div>
                                                        </DropDownOption>
                                                    </template>
                                                    <DropDownOption @click="$refs[`projectdd_${projectData._id || ''}`].click(),openPermissionSidebar()" v-if="checkPermission('settings.settings_security_permissions') !== null">
                                                        <div class="d-flex align-items-center project-mobile-desc avtar-options" :class="`${clientWidth <= 767 ? 'project_detail_dropdown_wrapper' : ''}`">
                                                            <div class="d-flex align-items-center">
                                                                <img :src="lockIcon" alt="lockIcon" class="mr-20px">
                                                            </div>
                                                            <span :class="{'font-size-16': clientWidth <= 767 }" class="font-weight-400 gray4b">{{$t('Projects.project_permissions')}}</span>
                                                        </div>
                                                    </DropDownOption>
                                                    <DropDownOption @click="$refs[`projectdd_${projectData._id || ''}`].click(), projectName.value = projectData?.ProjectName, editProject = true" v-if="checkPermission('project.project_name_edit',projectData.isGlobalPermission) === true">
                                                        <div class="d-flex align-items-center project-mobile-desc avtar-options" :class="`${clientWidth <= 767 ? 'project_detail_dropdown_wrapper' : ''}`">
                                                            <div class="d-flex align-items-center">
                                                                <img :src="listIcon" alt="listIcon" class="mr-20px">
                                                            </div>
                                                            <span :class="{'font-size-16': clientWidth <= 767 }" class="font-weight-400 gray4b">{{$t('Projects.rename')}}</span>
                                                        </div>
                                                    </DropDownOption>
                                                    <DropDownOption @click="$refs[`projectdd_${projectData._id || ''}`].click(), showColorAvatar = true, assignAvatarData({id: projectData._id, name: projectData.ProjectName, icon: projectData?.projectIcon})" v-if="checkPermission('project.project_create',projectData.isGlobalPermission) === true">
                                                        <div class="d-flex align-items-center project-mobile-desc avtar-options" :class="`${clientWidth <= 767 ? 'project_detail_dropdown_wrapper' : ''}`">
                                                            <div class="d-flex align-items-center">
                                                                <img :src="colorPalletIcon" alt="colorPalletIcon" class="mr-20px">
                                                            </div>
                                                            <span :class="{'font-size-16': clientWidth <= 767 }" class="font-weight-400 gray4b">{{$t('Projects.color_avatar')}}</span>
                                                        </div>
                                                    </DropDownOption>
                                                    <DropDownOption v-if="false">
                                                        <div class="d-flex align-items-center project-mobile-desc avtar-options" :class="`${clientWidth <= 767 ? 'project_detail_dropdown_wrapper' : ''}`">
                                                            <div class="d-flex align-items-center">
                                                                <img :src="copyIcon" alt="copyIcon" class="mr-20px">
                                                            </div>
                                                            <span :class="{'font-size-16': clientWidth <= 767 }" class="font-weight-400 gray4b">{{$t('Projects.duplicate')}}</span>
                                                        </div>
                                                    </DropDownOption>
                                                    <DropDownOption @click="$refs[`projectdd_${projectData._id || ''}`].click(), showSidebar = true, archive=0" v-if="checkPermission('project.project_close',projectData.isGlobalPermission) === true">
                                                        <div class="d-flex align-items-center project-mobile-desc avtar-options" :class="`${clientWidth <= 767 ? 'project_detail_dropdown_wrapper' : ''}`">
                                                            <div class="d-flex align-items-center">
                                                                <img :src="cancelIcon" alt="cancelIcon" class="mr-20px">
                                                            </div>
                                                            <span :class="{'font-size-16': clientWidth <= 767 }" class="font-weight-400 gray4b">{{$t('Projects.close_project')}}</span>
                                                        </div>
                                                    </DropDownOption>
                                                    <!-- <DropDownOption @click="$refs[`projectdd_${projectData._id || ''}`].click(), showSidebar = true,archive=1">
                                                        <div class="d-flex align-items-center project-mobile-desc avtar-options" :class="`${clientWidth <= 767 ? 'project_detail_dropdown_wrapper' : ''}`">
                                                            <div class="d-flex align-items-center">
                                                                <img :src="inventoryIcon" alt="inventoryIcon" class="mr-20px">
                                                            </div>
                                                            <span :class="{'font-size-16': clientWidth <= 767 }" class="font-weight-400 gray4b">{{$t('Projects.archive')}}</span>ee
                                                        </div>
                                                    </DropDownOption> -->
                                                    <DropDownOption  v-if="checkPermission('project.project_delete',projectData.isGlobalPermission) === true" @click="$refs[`projectdd_${projectData._id || ''}`].click(), showSidebar = true,archive=2">
                                                        <div class="d-flex align-items-center project-mobile-desc avtar-options" :class="`${clientWidth <= 767 ? 'project_detail_dropdown_wrapper' : ''}`">
                                                            <div class="d-flex align-items-center">
                                                                <img :src="deleteIcon" alt="deleteIcon" class="mr-20px">
                                                            </div>
                                                            <span :class="{'font-size-16': clientWidth <= 767 }" class="font-weight-400 gray4b">{{$t('Projects.delete')}}</span>
                                                        </div>
                                                    </DropDownOption>
                                                </div>
                                            </template>
                                        </DropDown>
                                    </li>
                                </ul>
                            </div>
                        </div>
                        <div v-if="showLoader" class="d-flex box-shadow-6 position-fi z-index-10 right-22px bottom-22px bg-white p-10px border-radius-5-px align-items-center">
                            <div class="progress-container d-flex align-items-center position-re ">
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
                                            (clientWidth > 767 || activeTab !== 'ProjectDetail')
                                },
                                {'board-veiw-main-parent': activeTab === 'ProjectKanban'}
                            ]"
                            :style="{height: clientWidth > 767 ? 'calc(100% - 48px)' : 'calc(100% - 62px)'}"
                        >
                            <div class="task-assigneesearch-groupbywrapper" :class="{'overflow-auto' : clientWidth <=767}">
                                <div class="d-flex align-items-center justify-content-between flex-wrap task-filtersearchassignee-wrapper" :class="{'w-545' : clientWidth <=767 }" v-if="['ProjectListView', 'Calendar', 'ProjectKanban','TableView'].includes(activeTab)">
                                    <div class="d-flex align-items-center justify-content-start task-filtersearch" :class="[{ 'mb-10px': clientWidth <= 767 }]" :style="{width: (clientWidth <= 767 ? '100%' : '')}" v-if="!showArchived">
                                        <TaskFilter :projectData="projectData" @apply="applyFilter" @clear="clearFilter" v-if="Object.keys(projectData).length > 0"/>
                                        <div class="position-re task-fitler-search"  id="projectviewfiltersearch_driver">
                                            <input type="text" :placeHolder="$t('PlaceHolder.search')" class="form-control" :style="{width: (clientWidth > 1025 ? '392px' : '90%')}" v-model="taskSearch">
                                            <DropDown title="Search In" id="searchfilterdropdownoptions_driver" class="position-ab dropdown-image-horizontal" :bodyClass="{'search__in-dropdown' : true}">
                                                <template #head>
                                                    <h4 class="black font-size-13 font-weight-500 p-10px m-0 search__in" :class="{'border-bottom': clientWidth > 767}">
                                                        {{$t('Projects.search_in')}}
                                                    </h4>
                                                </template>
                                                <template #button>
                                                    <img :src="horizontalDots" alt="horizontalDots" class="vertical-middle" id="searchfilterdropdown_driver">    
                                                </template>
                                                <template #options>
                                                    <DropDownOption @click="taskDescriptionSearch || taskKeySearch ? taskNameSearch = !taskNameSearch : ''" class="task-serachstatus-dropdown border-radius-4-px">
                                                        <span class="project-mobile-desc mr-10px">{{$t('Projects.task_name')}}</span>
                                                        <Toggle  width="20" v-model="taskNameSearch" :disabled="taskNameSearch && !taskDescriptionSearch && !taskKeySearch" @change="searchMongoDB()"/>
                                                    </DropDownOption>
                                                    <DropDownOption @click="taskKeySearch = !taskKeySearch" class="task-serachstatus-dropdown border-radius-4-px">
                                                        <span class="project-mobile-desc mr-10px">{{$t('Projects.task_key')}}</span>
                                                        <Toggle width="20" v-model="taskKeySearch" @change="toggleSearch(),searchMongoDB()"/>
                                                    </DropDownOption>
                                                    <DropDownOption @click="taskDescriptionSearch = !taskDescriptionSearch" class="task-serachstatus-dropdown border-radius-4-px">
                                                        <span class="project-mobile-desc mr-10px">{{$t('ProjectDetails.description')}}</span>
                                                        <Toggle width="20" v-model="taskDescriptionSearch" @change="toggleSearch(),searchMongoDB()"/>
                                                    </DropDownOption>
                                                </template>
                                            </DropDown>
                                        </div>
                                        <Assignee
                                            :tourId="'projectviewassignee_driver'"
                                            v-if="clientWidth> 767 && projectData?.isPrivateSpace"
                                            class="assignee-data ml-15px"
                                            :users="projectData.AssigneeUserId"
                                            :options="[...users.map((x) => x._id), ...teams.map((x) => 'tId_'+x._id)]"
                                            :imageWidth="clientWidth>1024 ? '30px' : '25px'"
                                            :num-of-users="clientWidth>1024 ? 4 : 2"
                                            :showAddUser="true"
                                            :addUser="checkPermission('project.project_assignee',projectData.isGlobalPermission) === true"
                                            @selected="changeAssignee('add', $event)"
                                            @removed="changeAssignee('remove', $event)"
                                            :isDisplayTeam="true"
                                        />
                                    </div>
                                    <div v-if="['ProjectListView', 'ProjectKanban','TableView'].includes(activeTab)" class="d-flex align-items-center justify-content-end task-filter-assignee overflow-auto style-scroll" :style="`${showArchived ? 'width: 100%;' : ''}`" :class="clientWidth <= 767 ? 'justify-content-start' : ''">
                                        <template v-if="!showArchived">
                                            <button class="text-nowrap btn ai_button mr-1 cursor-pointer" @click="openAiSidebar = true" v-if="checkApps('AI',projectData) && checkPermission('artificial_intelligence',projectData?.isGlobalPermission) === true">
                                                <img src="@/assets/images/svg/ai_image_white.svg" class="mr-10-px"/>
                                                <span>{{$t('AI.write_with_ai')}}</span>
                                            </button>
                                            <DropDown id="group_by" class="mr-1 group_by">
                                                <template #button>
                                                    <button class="text-nowrap btn-white border-groupBy border-radius-6-px cursor-pointer" ref="group_by_status" @click="currentActive='group'">
                                                        <div class="group-by-dropdown" :class = "{'active' : clientWidth <= 767 && currentActive == 'group' }">
                                                        <strong :style="{color: (clientWidth <= 767 ? '#535358' : '#000')}" :class="{'font-size-12 font-weight-500' : clientWidth > 767 , 'font-size-14 font-weight-400' : clientWidth <=767}">{{$t('Projects.group_by')}} : </strong> <span :style="{color: (clientWidth <= 767 ? '#535358' : '#818181')}" :class="{'font-size-12' : clientWidth > 767 , 'font-size-14' : clientWidth <=767}">{{$t(`Projects.${groupByOptions.find(x => x.id === groupBy).label}`)}}</span>
                                                        </div>
                                                    </button>
                                                </template>
                                                <template #options>
                                                    <DropDownOption v-for="item in groupByOptions" :key="item.id" @click="groupBy = item.id,$refs.group_by_status.click(item)" :class="{'bg-light-gray' : item.id === groupBy}">
                                                        <div>
                                                            <img :src="item.image" :alt="item.label" class="pr-10px">
                                                            <span :class="{'purple' : item.id === groupBy}">{{$t(`Projects.${item.label}`)}}</span>
                                                        </div>
                                                    </DropDownOption>
                                                </template>
                                            </DropDown>
                                            <DropDown class="mr-1 group_by" v-if="activeTab === 'ProjectListView'">
                                                <template #button>
                                                    <button class="text-nowrap btn-white border-groupBy border-radius-6-px cursor-pointer" ref="expand_collapse" @click="currentActive='subtask'">
                                                        <div class="group-by-dropdown current__dropdown" :class = "{'active' : clientWidth <= 767 && currentActive == 'subtask' }">
                                                        <strong :style="{color: (clientWidth <= 767 ? '#535358' : '#000')}" :class="{'font-size-12 font-weight-500' : clientWidth > 767 , 'font-size-14 font-weight-400' : clientWidth <=767}">{{$t('Projects.subtask')}}: </strong> <span :style="{color: (clientWidth <= 767 ? '#535358' : '#818181')}" :class="{'font-size-12' : clientWidth > 767 , 'font-size-14' : clientWidth <=767}"> {{collapsed ? $t('Projects.collapsed') : $t('Projects.expanded')}}</span>
                                                        </div>
                                                    </button>
                                                </template>
                                                <template #options>
                                                    <DropDownOption @click="collapsed = false, $refs.expand_collapse.click()" :class="{'bg-light-gray' : !collapsed}">
                                                        <span :class="{'purple' : !collapsed}">{{$t('Projects.expanded')}}</span>
                                                    </DropDownOption>
                                                    <DropDownOption @click="collapsed = true, $refs.expand_collapse.click()" :class="{'bg-light-gray' : collapsed}">
                                                        <span :class="{'purple' : collapsed}">{{$t('Projects.collapsed')}}</span>
                                                    </DropDownOption>
                                                </template>
                                            </DropDown>
                                            <div class="mr-1 border-groupBy border-radius-6-px d-flex align-items-center assignee-filter manage__filter-users">
                                                <div
                                                    @click="manageFilterUsers(userId)"
                                                    :class="{'bg-white' : filterUsers.includes(userId)}"
                                                    class="border-radius-6-px border-right-radius-0 border-right cursor-pointer assignee-user font-size-12 font-weight-400 p7x-5px"
                                                >
                                                    <img :src="filterUsers.includes(userId) ? activeUserIcon : userIcon" alt="user icon" class="vertical-middle">
                                                    <span class="font-size-12 font-weight-400 ml-7px"> {{$t('Projects.me')}} </span>
                                                </div>
                                                <div
                                                    v-if="projectData?.isGlobalPermission === false  ? checkPermission('task.show_tasks',projectData.isGlobalPermission) === 2 || checkPermission('task.show_tasks',projectData.isGlobalPermission) === true : true"
                                                    @click="userSidebar = !userSidebar"
                                                    class="border-radius-6-px border-left-radius-0 cursor-pointer assignee-status p4x-5px"
                                                    :class="{'bg-white blue' : filterUsers.length && filterUsers.filter((x) => x !== userId).length}"
                                                >
                                                    <img :src="filterUsers.length && filterUsers.filter((x) => x !== userId).length ? activeGroupIcon : groupIcon" alt="user icon">
                                                    <span class="font-size-12 font-weight-400 ml-10px"> {{filterUsers.length && filterUsers.filter((x) => x !== userId).length ? `(${filterUsers.filter((x) => x !== userId).length})` : $t('ProjectDetails.assignee')}}</span>
                                                </div>
                                            </div>
                                        </template>
                                        <button class="archived-btn font-weight-400 d-flex align-items-center justify-content-between" :style="{color: (clientWidth <= 767 ? '#535358' : '')}" :class="{'outline-primary show-archived-active': showArchived, 'outline-secondary': !showArchived, 'border-radius-6-px font-size-14' : clientWidth <=767 , 'border-0 font-size-13' : clientWidth > 767 }">
                                            <template v-if="showArchived">
                                                <span class="font-weight-bold font-size-16 dark-gray">
                                                    {{$t('ProjectSlider.archived_list')}}
                                                </span>
                                                <span v-if="!showArchivedProjects" @click="showArchived = false">
                                                    {{$t('ProjectSlider.hide_archive')}}
                                                </span>
                                            </template>
                                            <template v-else>
                                                <span @click="showArchived = true" class="text-nowrap">
                                                    {{$t('ProjectSlider.show_archive')}}
                                                </span>
                                            </template>
                                        </button>
                                    </div>
                                    <div v-if="['Calendar'].includes(activeTab)" class="d-flex align-items-center justify-content-end task-filter-assignee style-scroll" :class="clientWidth <= 767 ? 'justify-content-start' : ''">
                                        <div class="mr-1 border-groupBy border-radius-6-px d-flex align-items-center assignee-filter manage__filter-users">
                                            <div
                                                @click="manageFilterUsers(userId)"
                                                :class="{'bg-white' : filterUsers.includes(userId)}"
                                                class="border-radius-6-px border-right-radius-0 border-right cursor-pointer assignee-user font-size-12 font-weight-400 p7x-5px"
                                            >
                                                <img :src="filterUsers.includes(userId) ? activeUserIcon : userIcon" alt="user icon" class="vertical-middle">
                                                <span class="font-size-12 font-weight-400 ml-7px">{{ $t('Projects.me') }} </span>
                                            </div>
                                            <div
                                                v-if="projectData?.isGlobalPermission === false  ? checkPermission('task.show_tasks',projectData.isGlobalPermission) === 2 || checkPermission('task.show_tasks',projectData.isGlobalPermission) === true : true"
                                                @click="userSidebar = !userSidebar"
                                                class="border-radius-6-px border-left-radius-0 cursor-pointer assignee-status p4x-5px"
                                                :class="{'bg-white blue' : filterUsers.length && filterUsers.filter((x) => x !== userId).length}"
                                            >
                                                <img :src="filterUsers.length && filterUsers.filter((x) => x !== userId).length ? activeGroupIcon : groupIcon" alt="user icon">
                                                <span class="font-size-12 font-weight-400 ml-10px"> {{filterUsers.length && filterUsers.filter((x) => x !== userId).length ? `(${filterUsers.filter((x) => x !== userId).length})` : $t('ProjectDetails.assignee')}}</span>
                                            </div>
                                        </div>
                                        <div class="d-flex align-items-center assignee-filter">
                                            <div class="mr-1 group_by monthly-calendar monthly-calendar-view" @click="calendartoggle = true,rangeObjectFRun(calendarDate ? new Date(calenderSelectDate) : new Date())">
                                                {{ calendarDate ? calendarDate : new Date().toLocaleString('default', { month: 'long', year: 'numeric' }) }}
                                                <MonthlyCalendarMilestone
                                                    v-if="calendartoggle"
                                                    :rangeObject="rangeObject"
                                                    :startDate="calendarDate ? new Date(calenderSelectDate) : new Date()"
                                                    @startEndDate="handleStartEndDate"
                                                />
                                            </div>
                                            <div class="mr-1 group_by d-flex">
                                                <button type="button" title="Previous month" class="calendar-button" @click="prevMonth()">
                                                    <span class="fc-icon fc-icon-chevron-left"></span>
                                                </button>
                                                <button type="button" title="Next month" class="calendar-button" @click="nextMonth()">
                                                    <span class="fc-icon fc-icon-chevron-right"></span>
                                                </button>
                                            </div>
                                            <div class="mr-1 group_by">
                                                <button type="button" title="This month" class="calendar-button calendar-currentday-text" @click="defaultMonth()">{{ $t('Home.Today') }}</button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <component
                                v-if="(clientWidth <= 767 && isVisible == true && isRuleData == false) || (clientWidth > 767 && isRuleData == false)"
                                :class="[{'showProjectDetailRight':activeTab !== 'ProjectListView' && activeTab !== 'Calendar' && activeTab != 'EmbedViewItem' && activeTab !== 'Workload' && activeTab !== 'ProjectKanban' && activeTab !== 'TableView'}]"
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
                            <ProjectDetailRightSide v-if="activeTab !== 'ProjectListView' && clientWidth > 767 && activeTab !== 'Calendar' && activeTab != 'EmbedView' && activeTab !== 'Workload' && activeTab !== 'ProjectKanban' && activeTab !== 'TableView'" :projectData="projectData" @rightSideBarEmit="handleEmitProjectRightSide" @description="handleDescription" />
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

                    <Sidebar
                        :value="filterUsers.map((x) => ({value: x}))"
                        :multiSelect="true"
                        :enableSearch="true"
                        :options="assigneeFilterOptions"
                        v-model:visible="userSidebar"
                        :title="$t('Projects.list_of_user')"
                        @selected="manageFilterUsers($event.value)"
                        @itemClicked="manageFilterUsers($event.value)"
                        @removed="manageFilterUsers($event.value)"
                        @clear="filterUsers = [], manageFilterUsers()"
                    />
                    <Sidebar
                        className="task-sub-sidebar"
                        v-model:visible="isSidebar"
                        :title="$t(`${sidebarTitle}`)"
                        width="358px"
                        :top="clientWidth <= 767 ? '0px' : '46px'"
                    >
                        <template #body>
                            <FileAndLinks
                                v-if="sidebarTitle === $t('Projects.Files_&_Links')"
                                :attachments="projectData.attachments"
                                :description=" projectData.description"
                                @closeSidebar="(val) => isSidebar = val"
                                :handleType="'project'"
                                :selectedData="projectData"
                            />
                            <TaskAudioFiles
                                v-else-if="sidebarTitle === $t('Projects.audio_files')"
                                :key="`${projectData?._id}` + 'audiofiles'"
                                :fromWhich="'project'"
                                :selectedData="projectData"
                            />
                        </template>
                    </Sidebar>
                    <Sidebar
                        v-model:visible="showColorAvatar"
                        width="607px"
                        :title="$t('Projects.change_color')"
                        @update:visible="resetFormData()"
                    >
                        <template #head-right>
                            <div>
                                <button class="btn-primary p0x-10px" @click="saveProjectAvatar()">{{ $t('Projects.save') }}</button>
                                <button class="outline-secondary p0x-10px ml-10px" @click="showColorAvatar = false">{{ $t('Projects.cancel') }}</button>
                            </div>
                        </template>
                        <template #body>
                            <div class="bg-white p-1 m-1 border-radius-8-px">
                                <div v-if="savingAvatar" class="bg-blue position-ab z-index-1 h-100 w-100 saving__avtar-div">
                                    <SpinnerComp :isSpinner="true"/>
                                </div>
                                <ProjectProfileForm v-model="formData.projectProfileField" :name="{value: formData.projectName} || {value: 'N/A'}" @update:image="(ele)=>{updateImageValue(ele)}"/>
                            </div>
                        </template>
                    </Sidebar>
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
                <div class="bg-light-gray d-flex align-items-center justify-content-center flex-column w-100 h-100">
                    <img :src="noProjectsIcon" alt="noProjectsIcon">
                    <template v-if="!showArchivedProjects">
                        <h2>{{$t('ProjectSlider.you_dont')}}</h2>
                        <div v-if="checkPermission('project.project_list',projectData.isGlobalPermission) === true && checkPermission('project.project_create',projectData.isGlobalPermission) === true && !isFilterHasData">
                            <button class="outline-primary ml-1 font-size-16 p0x-13px" @click="openSidebar()">+ {{$t('ProjectSlider.new_project')}}</button>
                            <button v-if="currentCompany?.planFeature?.aiPermission" class="btn btn-primary ml-1 font-size-16 p0x-13px" @click="openAiCreator()">✨ Create with AI</button>
                        </div>
                    </template>
                    <template v-else>
                        <h2>{{$t('ProjectSlider.no_archived')}}</h2>
                        <button class="outline-primary" @click="handleUnarchived()">{{$t('ProjectSlider.hide_archive')}}</button>
                    </template>
                </div>
            </template>
        </template>

        <!-- PROJECT VIEWS DD -->
        <DropDown title="All Views" :ref="projectAddView" :bodyClass="{'viewlist-mobile-dropdown-new' : true}" maxHeight="unset" v-if="clientWidth <= 768">
            <template #button>
                <span ref="all_views_dd"></span>
            </template>
            <template #options>
                <div>
                    <ViewsDropdown @handleCloseDropdown="$refs.all_views_dd.click()" :projectData="projectData"/>
                </div>
            </template>
        </DropDown>

        <ProjectWatcher
            v-model:openSidebar="openProjectWatcher"
            :watchers="projectData?.watchers"
            :options="projectData?.isPrivateSpace ? projectData?.AssigneeUserId : users.map((x) => x._id)"
            :projectId="projectData?._id || ''"
        />
        <ConfirmationSidebar
            v-model="showSidebar"
            :title="`${archive === 0 ? $t('Projects.close') : archive === 1 ? $t('Projects.archive') : $t('Projects.delete')}`"
            :message="archive === 0 ? $t('conformationmsg.archive0mesg') : archive === 1 ? $t('conformationmsg.archive'): $t('conformationmsg.delete')"
            :confirmationString="`${archive === 0 ? 'close' : archive === 1 ? 'archive' : 'delete'}`"
            :acceptButtonClass="archive === 1 ? 'btn-primary': 'btn-danger'"
            :acceptButton="`${archive === 0 ? $t('Projects.close') : archive === 1 ? $t('Projects.archive') : $t('Projects.delete')}`"
            @confirm="updateProject()"
            :showSpinner="showSpinner"
        />
        <CreateProjectSidebar v-if="isActiveCreateSidebar" :isAdvanceFilterApplied='isAdvanceFilterApplied' :isActiveCreateSidebar="isActiveCreateSidebar" @click:closeSidebar="closeSidebar" @closeSidebar="closeSidebar"/>
        <AiProjectCreator v-if="isActiveAiCreator" :visible="isActiveAiCreator" @close="isActiveAiCreator = false" @created="onAiProjectCreated"/>
        <ProjectPermission v-if="permissionSidebar" @isClose="(val) => {permissionSidebar = !val}" :projectData="projectData"></ProjectPermission>
        <ConfirmModal
            className="projecttourend_driver_modal"
            :modelValue="showDriverSidebar"
            :acceptButtonText="$t('Tour.watch_video')"
            :cancelButtonText="$t('Projects.cancel')"
            :header="false"
            :cancelButton='false'
            :showCloseIcon="false"
            :footer="false"
            @accept="currentVideoUrl == 0 ? updateTourStatusInUser('isProjectAndNavbarTour'):''"
            @close="closeModal, currentVideoUrl == 0 ? updateTourStatusInUser('isProjectAndNavbarTour'):''"
        >
            <template #body>
                <div class="d-flex flex-column justify-content-center align-items-center position-re">
                    <div class="position-ab tourendmodal__close_button">
                        <img :src="cancelIconForTour" class="cursor-pointer cancel__icon-img tourendmodal__close_img" alt="close" @click.prevent="closeModal()">
                    </div>
                    <div>
                        <img :src="tourModalImage" alt="tourmodalimage">
                    </div>
                    <div class="text-center">
                        <h1>{{$t('Tour.tour_completed')}}</h1>
                        <!-- <div class="mb-20px tourendmodal__description">{{$t('Tour.do_you_have_any')}}</div> -->
                        <!-- <button class="btn-primary tourendmodal__watch_button font-size-16" @click="currentVideoUrl == 0 ? updateTourStatusInUser('isProjectAndNavbarTour'):'',openVideo()">Watch Video</button> -->
                    </div>
                </div>
            </template>
        </ConfirmModal>
        <AISidebar v-if="openAiSidebar" @closeAi="openAiSidebar = false"></AISidebar>
    </div>
    <div v-else class="d-flex align-items-center justify-content-center w-100 h-100">
        <img :src="accessDenied" alt="accessDenied">
    </div>
</template>

<script setup>
// PACKAGES
import { computed, defineComponent, inject, onMounted, provide, ref, watch,onUnmounted, nextTick } from 'vue'
import isEqual from "lodash/isEqual"
import { useStore } from 'vuex';
import { useRoute, useRouter } from 'vue-router';
import { useCustomComposable, useGetterFunctions } from '@/composable';
import { useValidation } from '@/composable/Validation';
import ConfirmationSidebar from "@/components/molecules/ConfirmationSidebar/ConfirmationSidebar.vue"
import {deleteView , editView} from '@/components/molecules/EmbedView/helper.js'
import { deletePrivateView ,editPrivateName} from '@/components/molecules/ProjectViews/helper.js'
import { calendar } from '@/components/organisms/HourlyMilestone/helper.js';
import { projectComponentsIcons } from '@/composable/commonFunction';
import { EditProjectName } from '@/utils/NotificationTemplate';

// COMPONENTS
import ProjectWatcher from "@/components/organisms/ProjectWatcher/ProjectWatcher.vue"
import CreateProjectSidebar from '@/components/organisms/CreateProject/CreateProjectSidebar.vue'
import AiProjectCreator from '@/components/organisms/AiProjectCreator/AiProjectCreator.vue'
import ProjectProfileForm from '@/components/templates/CreateProject/ProjectProfileForm.vue';
import WasabiImage from "@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue";
import SpinnerComp from "@/components/atom/SpinnerComp/SpinnerComp.vue";
import ProjectListing from './ProjectsListing/ProjectListing.vue'
import TableViewComp from "@/views/Projects/TableView/TableView.vue"
import EmbedViewItem from '@/components/molecules/EmbedView/EmbedViewItem.vue'
import ViewsDropdown from '@/components/molecules/ProjectViews/ViewsDropdown.vue'
import MonthlyCalendarMilestone from '@/components/atom/MonthlyCalendarMilestone/MonthlyCalendarMilestone.vue';
import ProjectPermission from '@/components/atom/ProjectPermission/ProjectPermission.vue';
import UpgradYourPlanComponent from '@/components/atom/UpgradYourPlanComponent/UpgradYourPlanComponent.vue';
import AISidebar from '@/components/molecules/AISidebar/AISidebar.vue';
// VIEWS
import ProjectListView from './ListView/ListView.vue'
import Comments from "@/views/Projects/Comments/Comments.vue"
import ActivityLog from "@/views/Projects/ActivityLog/ActivityLog.vue"
import WorkloadView from "@/views/Projects/WorkloadView/WorkloadView.vue"
import BoardView from '@/views/Projects/Kanban/BoardView.vue';
import ProjectDetail from "@/views/Projects/ProjectDetail/ProjectDetail.vue"
import ProjectDetailRightSide from '@/components/organisms/ProjectDetailRightSide/ProjectDetailRightSide.vue'
import NotFound from '../NotFound.vue'
import Sidebar from "@/components/molecules/Sidebar/Sidebar.vue"
import DropDown from '@/components/molecules/DropDown/DropDown.vue'
import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue'
import TaskDetail from '@/views/TaskDetail/TaskDetail.vue'
import Assignee from "@/components/molecules/Assignee/Assignee.vue"
import ViewsList from "@/components/atom/ViewsList/ViewsList.vue"
import InputText from "@/components/atom/InputText/InputText.vue"
import { useToast } from 'vue-toast-notification';
import { projectAssignee, projectAssigneeRemove } from '@/utils/NotificationTemplate';
import Toggle from '@/components/atom/Toggle/Toggle.vue'
import FileAndLinks from '@/components/molecules/FileAndLinks/FileAndLinks.vue'
import TaskAudioFiles from '@/components/molecules/TaskAudioFiles/TaskAudioFiles.vue'
import TaskFilter from '@/components/molecules/TaskFilter/TaskFilter.vue'
import { useProjectsHelper } from './helper';
import { useProjects } from '@/composable/projects';
import { useHistoryNotification } from '@/composable';
import * as env from '@/config/env';
import { apiRequest, apiRequestWithoutCompnay } from '../../services';
const {addHistory, addNotification} = useHistoryNotification();
import {storageQueryBuilder,generateFileName} from '@/utils/storageQueryBuild.js';
import { useI18n } from "vue-i18n";
const { t } = useI18n();

// UTILS
const  { checkErrors , checkAllFields } = useValidation();
const $toast = useToast();
const {projects, filteredProjects, dispatchProjects} = useProjectsHelper();
const showArchivedProjects = ref(false);
const isAdvanceFilterApplied = ref(false);
const isFilterHasData = ref(false);
const sprintLoading = ref(false);
const showSpinner = ref(false);
const previewImage = ref(null);
const {markFavourite} = useProjects();
const { calendarRange} = calendar();
provide("showArchivedProjects", showArchivedProjects);
import ConfirmModal from '@/components/atom/Modal/Modal.vue';
const cancelIconForTour = require("@/assets/images/cancel_icon.png");
const tourModalImage = require("@/assets/images/tourmodalimage.png");

// 1 for Project and 2 for Task
const currentVideoUrl = ref(0)
const embeddropdown = ref(null);
const openAiSidebar = ref(false);
const showDriverSidebar = ref(false);
const skipWatcher = ref(false);
const mainTour = inject("$mainTour");
const socket = inject("$socket");
import { tourHepler } from "@/components/organisms/Tour/helper";
const { startProjectTour } = tourHepler();

// IMAGES
const eyeIcon = require('@/assets/images/svg/PriorityIcon/watchProjectEye.svg');
const accessDenied = require("@/assets/images/access_denied_img.png");
const listDropIcon = require("@/assets/images/svg/list_view_dropicon.svg");
const publicIcon = require("@/assets/images/svg/public_folder.svg");
// const listViewIcon = require("@/assets/images/svg/listViewSvg.svg");
const noProjectsIcon = require("@/assets/images/svg/No-Search-Result.svg");
const horizontalDots = require("@/assets/images/svg/horizontalDots.svg");
const horizontalDotsMobile = require("@/assets/images/svg/threedot_mobile_list.svg");
const addIcon = require("@/assets/images/Shape 614.png");
const activeUserIcon = require("@/assets/images/peopleBlue.png");
const userIcon = require("@/assets/images/peopleGray.png");
const activeGroupIcon = require("@/assets/images/peopleBlue.png");
const groupIcon = require("@/assets/images/peopleGray.png");
const lockIcon = require("@/assets/images/lock.png");
const listIcon = require("@/assets/images/svg/edit_rename_icon.svg");
const colorPalletIcon = require("@/assets/images/svg/palette.svg");
const copyIcon = require("@/assets/images/svg/content_copy.svg");
const cancelIcon = require("@/assets/images/svg/cancel.svg");
const deleteIcon = require("@/assets/images/svg/Delete_Icon.svg");
const publicFolder = require("@/assets/images/public_folder.png");
const fileLinks = require("@/assets/images/svg/Fileslinks.svg");
const whiteDownArrow = require('@/assets/images/svg/embed_drop_arrow.svg')
const deleteImage = require('@/assets/images/svg/delete-red.svg')
const renameImage = require('@/assets/images/svg/rename.svg')
const saveImage = require("@/assets/images/save.png")
const cancelImage = require("@/assets/images/svg/deletered.svg")
const threedots = require("@/assets/images/svg/tagdots.svg")
const pin = require("@/assets/images/svg/pin.svg")
const code = require("@/assets/images/svg/code.svg")
const copy = require("@/assets/images/svg/copy-link.svg")


    defineComponent({
        name: "Projects-Page",

        components: {
            ProjectListing,
            ProjectListView,
            Comments,
            ActivityLog,
            ProjectDetail,
            Sidebar,
            DropDown,
            DropDownOption,
            TaskDetail,
            Assignee,
            ViewsList,
            NotFound,
            ProjectDetailRightSide,
            InputText,
            Toggle,
            TaskFilter,
            SpinnerComp,
            EmbedViewItem
        }
    })

    // Reactive Variables to show the progress of the tasks being imported
    const progress = ref(0);
    const showLoader = ref(false);

    provide('progress', progress);
    provide('showLoader', showLoader);

    const currentProgress = ref(0);

    const circleStyle = computed(() => {
        return {
            background: `conic-gradient(#4caf50 0% ${currentProgress.value}%, #ddd ${currentProgress.value}% 100%)`
        };
    });

    // Watch progress value and animate changes
    watch(progress, (newVal) => {
        animateProgress(newVal);
    });

    function animateProgress(target) {
        let step = () => {
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

    const {getters, commit, dispatch} = useStore();

    const companyUserDetail = computed(() => getters['settings/companyUserDetail'])
    const myCounts = computed(() => getters["users/myCounts"]?.data || {})

    const editProject2 = ref(false)
    const archive = ref(0)
    const userId = inject("$userId");
    const showSidebar = ref(false);
    const isVisible = ref(true);
    const isVisibleProjectDetial = ref(true);
    const openProjectWatcher = ref(false);

    const isActiveCreateSidebar = ref(false);
    const savingAvatar = ref(false);
    const showColorAvatar = ref(false);
    const calendartoggle = ref(false);
    const rangeObject = ref({});
    const calendarDate = ref('')
    const calenderSelectDate = ref(0)
    const permissionSidebar = ref(false);
    const projectSearchText = ref("");
    // const isSprintLoad = ref(false);
    // const folderSprintsData = ref({})
    const prevMonth = () => {
        if (!calendarDate.value) {
            const now = new Date();
            const nextDate = now.setMonth(now.getMonth() - 1, 1);
            calenderSelectDate.value = nextDate;
            calendarDate.value = new Date(nextDate).toLocaleString('default', { month: 'long', year: 'numeric' });
        } else {
            const now = new Date(calenderSelectDate.value);
            const nextDate = now.setMonth(now.getMonth() - 1, 1);
            calenderSelectDate.value = nextDate;
            calendarDate.value = new Date(nextDate).toLocaleString('default', { month: 'long', year: 'numeric' });
        }
    }
    const nextMonth = () => {
        if (!calendarDate.value) {
            const now = new Date();
            const nextDate = now.setMonth(now.getMonth() + 1, 1);
            calenderSelectDate.value = nextDate;
            calendarDate.value = new Date(nextDate).toLocaleString('default', { month: 'long', year: 'numeric' });
        } else {
            const now = new Date(calenderSelectDate.value);
            const nextDate = now.setMonth(now.getMonth() + 1, 1);
            calenderSelectDate.value = nextDate;
            calendarDate.value = new Date(nextDate).toLocaleString('default', { month: 'long', year: 'numeric' });
        }
    }
    const defaultMonth = () => {
        if (calendarDate.value) {
            calendarDate.value = ''
            calenderSelectDate.value = 0
        }
    }
    const handleStartEndDate = (value) => {
        calendartoggle.value = false;
        const startEndObj = value;
        const getYear = new Date(startEndObj.start).getFullYear();
        const getMonth = new Date(startEndObj.start);
        const month = getMonth.toLocaleString('default', { month: 'short' });
        const tmpValue = JSON.parse(JSON.stringify(value));
        rangeObject.value.monthValueRange = `${getYear}`;
        rangeObject.value.selectedmonth = `${month}`;
        rangeObject.value.rangeValueMonthly = rangeObject.value.monthlyOrweeklyRangesValue[`${getYear}`];
        calenderSelectDate.value = new Date(tmpValue.start).getTime();
        calendarDate.value = new Date(tmpValue.start).toLocaleString('default', { month: 'long', year: 'numeric' });
    }
    const rangeObjectFRun = (value) => {
        const startEndObj = value;
        const getYear = new Date(startEndObj).getFullYear();
        const getMonth = new Date(startEndObj);
        const month = getMonth.toLocaleString('default', { month: 'short' });
        rangeObject.value.monthValueRange = `${getYear}`;
        rangeObject.value.selectedmonth = `${month}`;
        rangeObject.value.rangeValueMonthly = rangeObject.value.monthlyOrweeklyRangesValue[`${getYear}`];
    }
    const handleClickOutside = (event) => {
        if(calendartoggle.value && !event.target.closest('.monthly-calendar')) {
            calendartoggle.value = false;
        }
    };
    const formData = ref({
        projectName: "",
        projectId: "",
        projectProfileField:{
            selectedColor : {
                value: "",
                rules:
                "required",
                name: "selectedColor",
                error: "",
            },
            uploadedImage : {
                value: "",
                rules:
                "required",
                name: "Choose an Image to Upload",
                error: "",
            },
            previewImage : {
                value: "",
                rules:
                "required",
                name: "previewImage",
                error: "",
            }
        }
    })
    const resetFormData = () => {
        formData.value = {
            projectName: "",
            projectId: "",
            projectProfileField:{
                selectedColor : {
                    value: "",
                    rules:
                    "required",
                    name: "selectedColor",
                    error: "",
                },
                uploadedImage : {
                    value: "",
                    rules:
                    "required",
                    name: "Choose an Image to Upload",
                    error: "",
                },
                previewImage : {
                    value: "",
                    rules:
                    "required",
                    name: "previewImage",
                    error: "",
                }
            }
        }
    }
    const openSidebar = () => {
        isActiveCreateSidebar.value = true;
    }
    function closeSidebar(value){
        isActiveCreateSidebar.value = value;
    }
    const isActiveAiCreator = ref(false);
    const currentCompany = computed(() => getters['settings/selectedCompany']);
    const openAiCreator = () => {
        isActiveAiCreator.value = true;
    }
    function onAiProjectCreated({ projectId }) {
        // The project-list socket pipeline doesn't fan out an 'insert' event
        // for new projects, so we re-fetch the project list ourselves so the
        // new project shows up immediately without a page reload.
        try {
            dispatch('projectData/setProjects', { roleType: 'currentUser' });
        } catch (_e) { /* ignore */ }
        if (projectId) {
            try {
                const cid = (currentCompany.value && currentCompany.value._id) || route.params.cid;
                router.push({ name: 'Project', params: { cid, id: projectId } });
            } catch (_e) { /* ignore */ }
        }
        isActiveAiCreator.value = false;
    }

    const assigneeInProgress = ref({});
    const visible = ref(false);
    const filterFavorites = ref(localStorage.getItem('favoriteFilter') == 'true');
    const activeTab = ref("ProjectListView");
    const clientWidth = inject("$clientWidth");
    const route = useRoute();
    const router = useRouter();
    const responseWidth = 1300;
    const sidebarArrowIcon = require("@/assets/images/svg/sidebarclose_arrow.svg");
    const projectStar = require("@/assets/images/svg/start13.svg");
    const blankStar = require("@/assets/images/svg/blankStar.svg");
    const audio = require("@/assets/images/svg/Voice_Record.svg");
    const fileLink = require("@/assets/images/svg/Files_links.svg");
    const audioLinkMobile = require("@/assets/images/svg/AudioLink.svg");
    const viewDefaultIcon = require("@/assets/images/svg/list_home_icon.svg");
    const viewDefaultActive = require("@/assets/images/svg/blue_tick.svg");
    const projectList = ref()

    const companyId = inject("$companyId");
    const {debounce, checkPermission ,makeUniqueId,checkApps,sanitizeInput} = useCustomComposable()
    const {getUser} = useGetterFunctions();
    const renameValue = ref('')
    const openDelete = ref({flag:false,data:''})
    const taskNameSearch = ref(true)
    const taskKeySearch = ref(false)
    const taskDescriptionSearch = ref(false)

    // const projects = ref([]);
    const projectData = ref({});
    const showArchived = ref(false);
    const taskSearch = ref("");
    const filterUsers = ref([]);
    const assigneeFilterOptions = ref([]);
    const userSidebar = ref(false);
    const collapsed = ref(true);
    const filterQuery = ref({});
    const currentActive = ref('');
    const embedViews = ref([])
    const Uid = ref('embed'+ makeUniqueId(6));
    // const prevDateVal = ref(false);
    const isRuleData = ref(false)
    const rulePermission = ref(true)

    const selectedEmbedView = ref('');
    const projectView = ref(`projectView${makeUniqueId(6)}`);
    const projectAddView = ref(`projectAddView${makeUniqueId(6)}`);
    const embedViewName = ref('');

    const showTasks = computed(() => checkPermission("task.show_tasks", projectData.value.isGlobalPermission, {gettersVal: getters}))
    const projectDetailPermission = computed(() => checkPermission("project.project_details", projectData.value.isGlobalPermission, {gettersVal: getters}))
    provide("taskCollapsed", collapsed)
    const icons = ref({
        Anything_url:require("@/assets/images/svg/anything.svg") ,
        Anything_html:require("@/assets/images/svg/anything.svg"), 
        Docs : require("@/assets/images/svg/Googledocs.svg") ,
        Sheets : require("@/assets/images/svg/googlesheets.svg"),
        Youtube : require("@/assets/images/svg/Youtube.svg"),
        Figma : require("@/assets/images/svg/figma.svg")
    })
    const groupBy = ref(0);
    const groupByOptions = ref([
        {
            label: "status",
            image: require("@/assets/images/groupbySattus.png"),
            id: 0,
        },
        // {
        //     label: "Assignee",
        //     image: require("@/assets/images/peopleGray.png"),
        //     id: 1,
        // },
        {
            label: "priority",
            image: require("@/assets/images/groupbyFlag.png"),
            id: 2,
        },
        {
            label: "due_date",
            image: require("@/assets/images/calendar_month.png"),
            id: 3
        }
    ])

    const companyOwner = computed(() => getters["settings/companyOwnerDetail"])

    const editProject = ref(false);
    const projectName = ref({
        value: "",
        rules:
        "required | min: 3",
        name: "name",
        error: "",
    });

    const searchTask = ref(false);
    const loadingProjects = ref(false);
    provide("searchedTask", searchTask)
    provide("showArchived", showArchived)
    provide("selectedProject", projectData)

    provide("isSupport", ref(false));

    const companyUserData = computed(()=> { return getters['settings/companyUsers']} )
    const companyUser = ref('')
    const viewsListArray = ref([])

    function resetFilters() {
        if(!showArchivedProjects.value) {
            showArchived.value = false;
        }
        groupBy.value = 0;
        filterUsers.value = [];
        searchTask.value = false;
        filterQuery.value = '';
        collapsed.value = true;
    }
    function calendarDateChange(status, key) {
        if (key === "calendar" && status) {
            defaultMonth()
        }
        // if (status) {
        //     defaultMonth()
        // }
    }
    watch(projectData,(newVal,oldVal) => {
        if(newVal._id != oldVal._id){
            const data = newVal;
            getProjectRule(data);
            selectedEmbedView.value = !(route?.query?.eid) ?  '' : embedViews.value.filter((item) => item.id == route.query.eid)[0];
            resetFilters();
        }
        getChange()
    })
    watch(() => companyUserData ,() => {
        getChange()
    },{deep:true})

    watch(route, (newVal) => {
        if(newVal.query.tab === 'comment') {
            activeTab.value = `Comments`
        }
    })

    watch(() => projectDetailPermission.value, () => {
        getChange()
    })

    watch(activeTab, (newVal, oldVal) => {
        if(newVal !== oldVal) {
            document.getElementById(activeTab.value)?.scrollIntoView();
        }
    })

    watch(
        [() => embedViews.value, () => projectData.value, () => route],
        ([newEmbedView, newProject, newRoute], [, oldProject, ]) => {
            if (newRoute.query.tab === 'EmbedView') {
                if (!newEmbedView.length && isEqual(newProject._id, oldProject._id)) {
                    activeTab.value = 'ProjectListView';
                    router.replace({ query: { tab: 'ProjectListView' } });
                } else if (newEmbedView.length) {
                    if (newEmbedView[0].id === route.query.eid) {
                        selectedEmbedView.value = newEmbedView[0];
                    } else {
                        selectedEmbedView.value = newEmbedView.find(item => item.id === route.query.eid) || newEmbedView[0];
                    }

                    nextTick(() => {
                        loadingProjects.value = false;
                    });
                }
            }
        }
    );

    watch(clientWidth, () => {
        if(clientWidth.value < 765) {
            if(visible.value) {
                visible.value = false;
            }
        }
    })

    function resetProjectName() {
        projectName.value.value = "";
        projectName.value.error = "";
    }

    const openEmbedView = (item) => {
        embedViewName.value = item?.name;
        activeTab.value = 'EmbedView'
        router.replace({query: {tab: 'EmbedView' ,eid:item.id}})
        selectedEmbedView.value = item
    }


    const getChange  = () => {
        companyUser.value = (companyUserData.value.filter((item) => userId.value == item.userId))[0]
        let userTabs = (companyUser.value?.ProjectRequiredComponent) ? ((Object.entries(companyUser.value?.ProjectRequiredComponent)).map((element) => {return {uniqueId:element[0] , ...element[1]}} )).filter((item) => item.projectId === projectData.value._id ) : []
        let Tabs2 = projectData.value.ProjectRequiredComponent?.filter((item) =>  item._id.length > 6 )
        let ids = projectData.value.ProjectRequiredComponent?.map((item) =>  item._id)
        viewsListArray.value = [...(userTabs.filter((element) => element.id.length > 6 && (!ids.includes(element.id)) )) , ...Tabs2].sort((a,b) => !(a.isPin) ? 0 : (a.isPin == b.isPin ? 0 : (((!a.isPin&&b.isPin) ? 1 : -1))))
        embedViews.value = ([...projectData.value.ProjectRequiredComponent.filter((item) => item._id.length == 6) , ...(userTabs.filter((element) => element.id.length == 6)) ].sort((a,b) => (a.name.toLowerCase() < b.name.toLowerCase()) ? -1 : ((b.name.toLowerCase() < a.name.toLowerCase()) ? 1 : 0))).sort((a,b) => !(a.isPin) ? 0 : (a.isPin == b.isPin ? 0 : (((!a.isPin && b.isPin) ? 1 : -1))))
        if(projectDetailPermission.value === null){
            viewsListArray.value = viewsListArray.value.filter((item) => item.keyName !== 'ProjectDetail');
        }
    }

    const editViewName = (element) => {
        const user = getUser(userId.value);
        const userData = {
            id: user.id,
            Employee_Name: user.Employee_Name,
            companyOwnerId: companyOwner.value.userId
        }

        if(renameValue.value.name.trim() == element.name.trim())
        {
            renameValue.value = {name:'',id:''}
            return
        }
        if(!renameValue.value.name.trim())
        {
            $toast.error(t('Toast.View_name_is_required'),{position:'top-right'})
            return 
        }
        if((renameValue.value.name.trim().length) < 3)
        {
            $toast.error(t('Toast.name_should_be_at_least_3_characters_long'),{position:'top-right'})
            return 
        }
        let duplicate = (embedViews.value.filter((item) => item.id !== element.id && item.name.trim() === renameValue.value.name.trim() ))
            if( duplicate.length ){
            $toast.error(t('Toast.View_name_already_exists'),{position:'top-right'})
            return
        }
        if(element.isPrivate)
        {
        editPrivateName({cid:companyId.value , uid: companyUser.value._id, uniqueId: element.id},element,renameValue.value.name.trim())
        }
        else
        {
            editView({cid:companyId.value , pid:projectData.value._id} , element , renameValue.value.name.trim(),'name').then((res)=>{
                commit('projectData/projectLocalUpdate', {itemData: res.data,projectId: projectData.value._id,key:"ProjectView",subKey:"edit",userId: ''});
            }).catch((error)=>{
                console.error(error);
            })
            if(selectedEmbedView.value.id == element.id){
                selectedEmbedView.value.name = renameValue.value.name
            }
        }     
        let historyObj = 
            {
            'message': `<b>${userData.Employee_Name}</b> has changed the  <b> Embed View name </b> as <b> ${renameValue.value.name.trim()} </b>  from <b>${element?.name} </b>`,
            'key' : 'Project_Name',
            }
        apiRequest("post", env.HANDLE_HISTORY, {
            "type": 'project',
            "companyId": companyId.value,
            "projectId": projectData.value._id,
            "taskId": null,
            "object": historyObj,
            "userData": userData
        })
        .catch((error) => {
            console.error("ERROR in update project history: ", error);
        })
        renameValue.value = {name:'',id:''}

    }

    const deleteEmbedView = () => {
        const user = getUser(userId.value);
        const userData = {
            id: user.id,
            Employee_Name: user.Employee_Name,
            companyOwnerId: companyOwner.value.userId
        }
        let historyObj = {
            'message': `<b> ${userData.Employee_Name} </b> has deleted the  <b> Embed View ${openDelete.value.data.name} </b>`,
            'key' : 'Project_Name',
        }

        if(openDelete.value.data.isPrivate) {
            deletePrivateView({ cid: companyId.value, uid: companyUser.value._id, uniqueId: openDelete.value.data.id}).then(() => {
                $toast.success(t('Toast.View_Deleted_Successfully'),{position:'top-right'}) 
            })
            .catch((err) => {
                console.error(err.statusText) 
            })
            openDelete.value.flag = false 
            apiRequest("post", env.HANDLE_HISTORY, {
                "type": 'project',
                "companyId": companyId.value,
                "projectId": projectData.value._id,
                "taskId": null,
                "object": historyObj,
                "userData": userData
            })
            .catch((error) => {
                console.error("ERROR in update project history: ", error);
            })
            return;
        }

        deleteView({ cid: companyId.value, pid: projectData.value._id }, openDelete.value.data).then((res)=>{
            commit('projectData/projectLocalUpdate', {itemData: res.data,projectId: projectData.value._id,key:"ProjectView",subKey:"delete",userId: ''});
        })
        .catch((err) => {
            console.error(err.statusText)
        })
        openDelete.value.flag = false
        apiRequest("post", env.HANDLE_HISTORY, {
            "type": 'project',
            "companyId": companyId.value,
            "projectId": projectData.value._id,
            "taskId": null,
            "object": historyObj,
            "userData": userData
        })
        .catch((error) => {
            console.error("ERROR in update project history: ", error);
        })
        $toast.success(t('Toast.View_Deleted_Successfully'),{position:'top-right'}) 
    }

    const copyToClipboard = (id) => {
        let link = window.location.href.split('?')[0]
        link = link+`?tab=EmbedView&eid=${id}`
        navigator.clipboard.writeText(link)
        $toast.success(t('Toast.Link_copied_to_clipboard_successfully'),{position:'top-right'})
    }

    function updateProjectName() {
        checkAllFields({projectName: projectName.value})
        .then(async (valid) =>{
            const prevName = sanitizeInput(projectData.value.ProjectName);
            const newName = sanitizeInput(projectName.value.value);
            if(valid) {
                editProject.value = false;
                editProject2.value = false;
                try {
                    const updateObj = { ProjectName: projectName.value.value };
                    await apiRequest("put",`/api/v1/${env.PROJECTACTIONS}/${projectData.value._id}`,{updateObject: updateObj});
                    $toast.success(t('Toast.Project_name_updated_successfully'), {position: 'top-right'});
                    const user = getUser(userId.value);
                    const userData = {
                        id: user.id,
                        Employee_Name: user.Employee_Name,
                        companyOwnerId: companyOwner.value.userId
                    }

                     // Call history API
                    const axiosData = {
                        "type": "project",
                        "companyId": companyId.value,
                        "projectId": projectData.value._id,
                        "taskId": null,
                        "object": {
                            "sprintId": null,
                            "key": "Project_Name",
                            "message": `<b>${userData.Employee_Name}</b> has changed the name of <b>${prevName}</b> to <b>${newName}</b>`
                        },
                        "userData": userData
                    };
                    apiRequest("post", env.HANDLE_HISTORY, axiosData).then((result) => {
                        if(result.data.status) {
                            console.info(result.data.statusText)
                        }
                    });
                    let updatedPr = {...projectData.value,ProjectName: projectName.value.value}
                    commit('projectData/projectLocalUpdate', {itemData: updatedPr,key:"ProjectName",subKey:"",userId: userId.value});
                    let notifyObj = {
                        TaskName: newName,
                        previousTaskName: prevName
                    }
                    let notificationObject = {
                        message: EditProjectName(notifyObj),
                        key: "project_name",
                    };
                    
                    apiRequest("post", env.HANDLE_NOTIFICATION, {
                        type: 'project',
                        companyId: companyId.value,
                        projectId: projectData.value._id,
                        object: notificationObject,
                        userData: userData,
                        changeType:'name',
                        changeData: notifyObj
                    })
                    .catch((error) => {
                        console.error("ERROR in update notification", error);
                    })
                    resetProjectName();
                } catch (error) {
                    console.error(error);
                }
            }
        })
        .catch((error) => {
            console.error("ERROR in validation: ", error);
        })
    }

    function toggleSearch() {
        if(taskDescriptionSearch.value === false && taskKeySearch.value === false) {
            taskNameSearch.value = true
        }
    }

    function searchMongoDB() {
        if(!taskSearch.value.trim().length && !filterUsers.value.length && !showArchived.value && !Object.keys(filterQuery.value).length) {
            commit("projectData/mutateSearchTask", {data:[],op: "added"})
            searchTask.value = false;
            return;
        }

        let query_by = {};
        let searchStr = taskSearch.value ? taskSearch.value.toString(): "";
        let andOr = '$or';
        query_by[andOr] = [];
        if(taskNameSearch.value) {
            query_by[andOr].push({'TaskName':{ $regex: searchStr, $options: 'i' }});
        }
        if(taskKeySearch.value) {
            query_by[andOr].push({'TaskKey':{ $regex: searchStr, $options: 'i' }});
        }
        if(taskDescriptionSearch.value) {
            query_by[andOr].push({'rawDescription':{ $regex: searchStr, $options: 'i' }});
        }
        searchTask.value = true;
        const query = [
            {
                $match: {
                    $and: [
                        {
                            $and:[
                                {ProjectID: {objId: {$in : [projectData.value._id]}}},
                                { deletedStatusKey: { $in: [showArchived.value ? 2 : 0] } }
                            ]
                        },
                    ]
                }
            }
        ];

        if (filterQuery.value) {
            query[0].$match.$and.push(filterQuery.value);
        }

        if (searchStr && searchStr.length) {
            query[0].$match.$and.push(query_by);
        }

        if (filterUsers.value && filterUsers.value.length > 0) {
            query[0].$match.$and.push({ AssigneeUserId: { $in: filterUsers.value } });
        }

        if ((showTasks.value === 1)) {
            query[0].$match.$and.push({ AssigneeUserId: { $in: [userId.value] } });
        }

        dispatch("projectData/searchTask",
            {query: query, showArchived: showArchived.value}
        )
        .catch((error) => {
            console.error("ERROR in search tasks: ", error);
        })
    }

    function manageFilterUsers(userId = null) {
        if(userId) {
            if(filterUsers.value.includes(userId)) {
                filterUsers.value = filterUsers.value.filter((x) => x !== userId);
            } else {
                filterUsers.value.push(userId);
            }
        }

        searchMongoDB()
    }

    watch(taskSearch, debounce(() => {
        searchMongoDB()
    },1000))

    watch([projectData, showArchived],() => {
        searchMongoDB()
    })

    const sprints = ref([]);

    function checkSprint(sprintData) {
        let addSprint = false;
        if(!showArchived.value) {
            addSprint = (sprintData?.deletedStatusKey === 0 || sprintData?.deletedStatusKey === undefined) && sprintData._id;
        } else {
            addSprint = (sprintData?.deletedStatusKey === 2) && sprintData._id;
            if(!addSprint && getters["projectData/searchedTasks"]?.length) {
                addSprint = getters["projectData/searchedTasks"].filter((task) => task.sprintId === sprintData.id).length
            }
        }

        return addSprint;
    }

    async function assignProjects(data = []) {
        await filteredProjects(JSON.parse(JSON.stringify(data)), showArchivedProjects.value, filterFavorites.value)

        nextTick(() => {
            loadingProjects.value = false;
        })
    }


    watch(showArchivedProjects, (newVal, oldVal) => {
        if(newVal !== oldVal && projectData.value && Object.keys(projectData.value)?.length) {
            loadingProjects.value = true;
        }
    })

    // GET FILTERED PROJECTS, FOLDERS & SPRINTS
    watch([() => getters["projectData/projects"], showArchivedProjects, route, filterFavorites], ([data]) => {
        localStorage.setItem('favoriteFilter', filterFavorites.value)
        if(data.data && data.data.length) {
            assignProjects(data.data);
        } else if(showArchivedProjects.value) {
            loadingProjects.value = false;
        } 
    },{deep: true})

    function tourHandler(key,isDirectTour=false) {
        try {
            if(!isDirectTour) {
                mainTour.value.handleTour(key);
            } else {
                startProjectTour(key)
            }
        } catch (error) {
            console.error("ER: ", error);
        }
    }
 
    onMounted(() => {
        if(clientWidth.value <= 1300){
            visible.value = true;
            projectList.value.toggleSidebar(true)
        }
        loadingProjects.value = true;
        dispatchProjects()
        .then(() => {
            nextTick(() => {
                if(getters["projectData/projects"] && getters["projectData/projects"]?.data?.length) {
                    if(!route.query?.tab) {
                        if(route.params.id) {
                            let index = projects.value.findIndex((e)=>e._id === route.params.id);
                            if(index!== -1) {
                                let viewFind = projects.value[index].ProjectRequiredComponent?.find((e) => e.setAsDefault) || projects.value[index].ProjectRequiredComponent?.find((e) => e.viewStatus) || projects.value[index].ProjectRequiredComponent[0];
                                router.replace({query: {tab: (viewFind ? viewFind?.keyName :"ProjectListView"),...route.query}});
                            }
                        } else {
                            let viewFind = projects.value[0]?.ProjectRequiredComponent?.find((e) => e.setAsDefault) || projects.value[0]?.ProjectRequiredComponent?.find((e) => e.viewStatus) || projects.value[0]?.ProjectRequiredComponent[0];
                            router.replace({query: {tab: (viewFind ? viewFind?.keyName :"ProjectListView"),...route.query}})
                        }
                    }
                }
                loadingProjects.value = false;
            })
        })
        .catch((error) => {
            nextTick(() => {
                loadingProjects.value = false;
            })
            console.error("ERROR: in set projects: ", error);
        })
        if(getters["projectData/projects"] && getters["projectData/projects"]?.data?.length) {
            assignProjects(getters["projectData/projects"].data);
        }
        calendarRange(new Date('01-jan-1970'),[],'Monthly',true,new Date('31-dec-2100')).then((value)=>{
            rangeObject.value = value
        });
        document.body.addEventListener('click', handleClickOutside);
        companyUserData.value = computed(()=> { return getters['settings/companyUsers']} )
        setTimeout(()=>{
            if(companyUserDetail.value && (companyUserDetail.value.roleType === 1 || companyUserDetail.value.roleType === 2)) {
                if(getUser(userId.value)?.tourStatus?.isProjectAndNavbarTour == undefined || getUser(userId.value)?.tourStatus?.isProjectAndNavbarTour === false || (getUser(userId.value)?.tourStatus == undefined || Object.keys(getUser(userId.value)?.tourStatus).length == 0)) {
                    if(clientWidth.value > 767) {
                        tourHandler('isProjectAndNavbarTour')
                    }
                } else {
                    // Project Views
                    if(companyUserDetail.value && (companyUserDetail.value.roleType === 1 || companyUserDetail.value.roleType === 2)) {
                        if(getUser(userId.value)?.tourStatus?.isProjectViewTour == undefined || getUser(userId.value)?.tourStatus?.isProjectViewTour === false || (getUser(userId.value)?.tourStatus == undefined || Object.keys(getUser(userId.value)?.tourStatus).length == 0)) {
                            if(clientWidth.value > 767) {
                                if(projects.value.length) {
                                    tourHandler('isProjectViewTour');
                                }
                            }
                        }
                    }

                    //Project List Left Views
                    if(companyUserDetail.value && (companyUserDetail.value.roleType === 1 || companyUserDetail.value.roleType === 2)) {
                        if(getUser(userId.value)?.tourStatus?.isProjectLeftViewTour == undefined || getUser(userId.value)?.tourStatus?.isProjectLeftViewTour === false || (getUser(userId.value)?.tourStatus == undefined || Object.keys(getUser(userId.value)?.tourStatus).length == 0)) {
                            if(clientWidth.value > 1300) {
                                tourHandler('isProjectLeftViewTour');
                            }
                        }
                    }
                }
                // if(getUser(userId.value)?.tourStatus?.isTaskTour == undefined || getUser(userId.value)?.tourStatus?.isTaskTour === false || (getUser(userId.value)?.tourStatus == undefined || Object.keys(getUser(userId.value)?.tourStatus).length == 0)) {
                //     secondTour.value.drive()
                // }
            }
        },1500)
    })
    onUnmounted(() => {
        socket.value.emit('getRoomList', socket.value.id, (rooms) => {
            let currentSocketRooms = rooms.find((x)=> x.includes(socket.value.id) && x.includes('project_sprint_'))
            if (currentSocketRooms) {
                socket.value.emit('leaveProjectSprintForTask', currentSocketRooms);    
                let sprintId = currentSocketRooms.split('**')[0].split("_").pop()
                commit("projectData/setGetPaginatedTasksPayload",{data:{projectData,pid:projectData.value._id},op: 'remove'});
                commit("projectData/setGetTableTaskPayload",{data:{sprintId,pid:projectData.value._id},op: 'remove'});
                const events = ['taskInsert', 'taskUpdate', 'taskDelete', 'taskReplace'];
                events.forEach(event => {
                    socket.value.off(event);
                });
            }
        })
        document.body.removeEventListener('click', handleClickOutside);
    });
 
    // UPDATE PROJECT DATA ON UPDATES IN DATABASE
    watch([projects, route], () => {
        if(projects.value && route?.params?.id && projectData.value && Object.keys(projectData.value).length) {
            if(route.params.id !== projectData.value._id){
                searchMongoDB();
            }

            if(projects.value && projects.value.length) {
                let index = projects.value.findIndex((x) => x._id == projectData.value._id);
                if(index !== -1) {
                    projectData.value = projects.value[index] || {}
                }
                else{
                    projectData.value = projects.value[0] || {};
                }
            }
        }
    })

    watch(route, () => {
        if(projects.value && route?.params?.id && projectData.value && Object.keys(projectData.value).length && route.params.id !== projectData.value._id) {
            let index = projects.value.findIndex((x) => x._id == route.params.id)
            if(index !== -1) {
                projectData.value = projects.value[index] || {};
            } else {
                router.replace({name: "Project", params: {cid: route.params?.cid, id: route.params?.id}, query: {...route.query}})
                projectData.value = projects.value[0] || {};
            }
        }
    })

    // UPDATE/FILTER SPRINTS ARRAY FOR LISTING
    watch([projectData, route, () => getters["projectData/searchedTasks"]], () => {
        if (skipWatcher.value) return;
        if(!route.name.toLowerCase().includes("project")) return;
        let tmp = sprints.value;
        if(!projectData.value || !Object.keys(projectData.value).length) return;
        let projectId = route.params?.id ? route.params.id : projectData.value._id
        let project;
        if (projectSearchText.value === '') {
            project = getters["projectData/projects"]?.data?.find((x) => x._id === projectId) || null;
        } else {
            project = getters["projectData/searchedProjects"]?.find((x) => x._id === projectId) || null;
        }
        
        if(!project) return;

        try {
            if(route.name === "Projects" || route.name === "Project") {
                tmp = project?.sprintsObj && Object.values(project?.sprintsObj).length ? Object.values(project.sprintsObj).filter((x) => checkSprint(x)) : [];
                Object.values(project.sprintsfolders || {}).forEach((value) => {
                    try {
                        if(showArchived.value && value?.deletedStatusKey === 2) {
                            tmp.push({
                                name: value.name,
                                id: value.folderId,
                                isExpanded: false,
                                items: [],
                                archivedSprintList: value.sprintsObj || {},
                                deletedStatusKey: 2,
                                isFolder: true
                            })
                        } else if(showArchived.value && !value?.deletedStatusKey){
                            tmp = [
                                ...tmp,
                                ...(Object.values(value?.sprintsObj || {})?.length ? Object.values(value.sprintsObj || {}).filter((x) => checkSprint(x)) : [])
                            ]
                        } else if(!showArchived.value && !value?.deletedStatusKey){
                            tmp = [
                                ...tmp,
                                ...(Object.values(value?.sprintsObj || {})?.length ? Object.values(value?.sprintsObj || {}).filter((x) => checkSprint(x)) : [])
                            ]
                        }
                    } catch (error) {
                        console.error("ERROR: ", error, value);
                    }
                })
            } else if(route.name.includes("ProjectFolder")) {
                if(route.params.sprintId && !project?.sprintsfolders?.[route.params.folderId]?.deletedStatusKey) {
                    const sprintIndex = Object.values(project?.sprintsfolders?.[route.params.folderId]?.sprintsObj || {})?.findIndex((x) => x.id === route.params.sprintId);
                    if(sprintIndex !== -1) {
                        tmp = [Object.values(project.sprintsfolders[route.params.folderId].sprintsObj)[sprintIndex]]
                    } else {
                        tmp = [];
                    }
                } else {
                    if(project.sprintsfolders?.[route.params.folderId]?.deletedStatusKey === 2) {
                        if(showArchived.value) {
                            let val = project.sprintsfolders?.[route.params.folderId]
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
            } else if(route.name.includes("ProjectSprint")){
                const sprintsArray = Object.values(project?.sprintsObj || {});
                const sprintIndex = sprintsArray.findIndex((x) => x.id === route.params.sprintId && (!showArchived.value ? (x?.deletedStatusKey === 0 || x?.deletedStatusKey === undefined) : true));
                if((companyUserDetail.value.roleType === 1 || companyUserDetail.value.roleType === 2) || (sprintIndex !== -1 && (!sprintsArray[sprintIndex]?.private || sprintsArray[sprintIndex]?.AssigneeUserId?.includes(userId.value)))) {
                    tmp = sprintIndex !== -1 ? [sprintsArray[sprintIndex]] : [];
                } else {
                    tmp = [];
                }
            }
        } catch (error) {
            console.error(error,"Error")
        }


        if(companyUserDetail.value.roleType !== 1 && companyUserDetail.value.roleType !== 2) {
            tmp = tmp.filter((x) => {
                return !x?.private || x?.AssigneeUserId?.includes(userId.value)
            })
        }

        tmp = tmp.sort((a, b) => a?.createdAt?.seconds > b?.createdAt?.seconds ? -1 : 1);

        if(searchTask.value) {
            if(getters["projectData/searchedTasks"]?.length) {
                if(showArchived.value) {
                    tmp = tmp?.filter((x) => getters["projectData/searchedTasks"].filter((y) => y.sprintId === x.id || x.isFolder === true || x.deletedStatusKey === 2).length) || [];
                } else {
                    tmp = tmp?.filter((x) => getters["projectData/searchedTasks"].filter((y) => y.sprintId === x.id || x.isFolder === true).length) || [];
                }
            } else {
                tmp = tmp?.filter((x) => x.isFolder || x.deletedStatusKey === 2);
            }
        }

        tmp = tmp.filter((x) => x && x?.deletedStatusKey !== 1)
        tmp = tmp?.filter((x) => (showArchived.value ? (x?.deletedStatusKey === 2 || x.archiveTaskCount) : !x?.deletedStatusKey))

        // CONDITION TO REDIRECT TO THE PROJECT IF REQUESTED SPRINT NOT FOUND
        if(!tmp.length && !showArchived.value) {
            if(route.params?.cid && route.params?.id === project.id && ["ProjectListView", "ProjectKanban", "Calendar", "TableView"].includes(route.params?.tab || "")) {
                let tab = route.query?.tab;
                if(!project?.ProjectRequiredComponent?.find((x) => x.keyName === route.query?.tab)) {
                    let viewFind = project?.ProjectRequiredComponent?.find((e) => e.setAsDefault) || project?.ProjectRequiredComponent?.find((e) => e.viewStatus) || project?.ProjectRequiredComponent[0];
                    tab = viewFind ? viewFind?.keyName :"ProjectListView";
                }
                if(route.params?.id) {
                    router.replace({name: "Project", params: {cid: route.params?.cid, id: route.params?.id}, query: {...route.query, tab}})
                } else {
                    router.replace({name: "Projects", params: {cid: route.params?.cid}, query: {...route.query, tab}})
                }
            }
        }
        if(!isEqual(tmp, sprints.value)) {
            sprints.value = tmp;
        }

        // REOPEN LIST VIEW
        if(project && project?.ProjectRequiredComponent?.length) {
            if((route.query && route.query.tab && (project?.ProjectRequiredComponent.filter((x) => x.keyName === route.query.tab || x.id != route.query.eid).length)) || route.query.tab == 'EmbedView' ) {
                activeTab.value = route.query.tab;
            } else {
                activeTab.value = route.query.tab ? route.query.tab :'ProjectListView';
            }
        } else {
            activeTab.value = "ProjectListView";
        }

        assigneeFilterOptions.value = [];
        let usersArr = [];
        if(project.isPrivateSpace) {
            usersArr = project.AssigneeUserId;
        } else {
            usersArr = users.value.map((x) => x._id);
        }

        usersArr.forEach((x) => {
            if(x !== userId.value) {
                let user = getUser(x);
                if(!user.ghostUser) {
                    assigneeFilterOptions.value.push({
                        value: x,
                        label: user.Employee_Name,
                        image: user.Employee_profileImageURL
                    })
                }
            }
        })
        assigneeFilterOptions.value = assigneeFilterOptions.value.sort((a, b) => a.label?.trim()?.toLowerCase().localeCompare(b.label?.trim()?.toLowerCase()));
    },{deep: true})

    function getView(val) {
        switch(val) {
            case "ProjectListView":
                return ProjectListView;
            case "Comments":
                return Comments;
            case "ActivityLog":
                return ActivityLog;
            case "ProjectDetail":
                if(projectDetailPermission.value == null){
                    return NotFound;
                }else{
                    return ProjectDetail;
                }
            case "EmbedView":
                return EmbedViewItem;
            case "Workload":
                return WorkloadView;
            case "TableView":
                return TableViewComp;
            case "Calendar":
                return ProjectListView;
            case "ProjectKanban":
                return BoardView;
            default:
                return NotFound;
        }
    }

    async function changeAssignee(type, user) {
        if(assigneeInProgress.value[user.id] && assigneeInProgress.value[user.id] === type) return;
        assigneeInProgress.value[user.id] = type;

        const usr = getUser(userId.value);
        const userData = {
            id: usr.id,
            Employee_Name: usr.Employee_Name,
            companyOwnerId: companyOwner.value.userId
        }

        let obj;
        let key;
        if (type === "add") {
            if(projectData.value.AssigneeUserId.includes(user.id)) return;
            obj = { AssigneeUserId: user.id };
            key = '$addToSet';
        } else {
            if(!projectData.value.AssigneeUserId.includes(user.id)) return;
            obj = {
                AssigneeUserId: user.id,
                ...(projectData.value.LeadUserId.includes(user.id) && { LeadUserId: user.id })
            } 
            key = '$pull';
        }
        try {
            await apiRequest("put",`/api/v1/${env.PROJECTACTIONS}/${projectData.value._id}`,{updateObject: obj,key: key})

            commit('projectData/projectLocalUpdate', {
                itemData: {...projectData.value},
                projectId: projectData.value._id,
                key: 'AssigneeChange',
                subKey: key === '$addToSet' ? 'add' : 'remove',
                userId: user.id
            });

            delete assigneeInProgress.value[user.id];

            const msg = `Assignee ${type === "add" ? "added" : "removed"} successfully`;
            $toast.success(msg, {position: "top-right"});

            let historyObj = {
                'message': `<b>${userData.Employee_Name}</b> ${type === 'add' ? 'added' : 'removed'} the <b>Assignee</b> to <b>${user.label}</b>`,
                'key' : 'Assignee_Changed',
            }
            let notifyObj = {
                'projectName' : projectData.value.ProjectName,
                'Employee_Name' : user.label
            }
            let notificationObject = {
                message: type === 'add' ? projectAssignee(notifyObj) : projectAssigneeRemove(notifyObj),
                key: "project_assignee",
            };
            apiRequest("post", env.HANDLE_HISTORY, {
                type: 'project', 
                companyId: companyId.value,
                projectId: projectData.value._id,
                taskId: null,
                object: historyObj,
                userData: userData
            })
            .catch((error) => {
                console.error("ERROR in update history", error);
            })
            apiRequest("post", env.HANDLE_NOTIFICATION, {
                type: 'project',
                companyId: companyId.value,
                projectId: projectData.value._id,
                object: notificationObject,
                userData: userData,
                mentionUserId:[user.id]
            })
            .catch((error) => {
                console.error("ERROR in update notification", error);
            })
        } catch (error) {
            console.error('Error in update project', error);
        }
    }

    function markProjectFavourite() {
        if(!projectData.value.favouriteTasks || !projectData.value.favouriteTasks.find((x) => x.userId === userId.value)) {
            markFavourite({
                cid: companyId.value,
                projectId: projectData.value._id,
                userId: userId.value
            })
            .then((msg) => {
                commit('projectData/projectLocalUpdate', {itemData:  {...projectData.value},projectId:projectData.value._id,key:'MarkAsFavourite',subKey:'add',userId: userId.value});
                $toast.success(msg, {position: "top-right"});
            })
            .catch((error) => {
                console.error("ERROR in mark project fav: ", error);
            })
        } else {
            markFavourite({
                cid: companyId.value,
                projectId: projectData.value._id,
                userId: userId.value,
                data: projectData.value.favouriteTasks.find((x) => x.userId === userId.value)
            })
            .then((msg) => {
                commit('projectData/projectLocalUpdate', {itemData:  {...projectData.value},projectId:projectData.value._id,key:'MarkAsFavourite',subKey:'remove',userId: userId.value});
                $toast.success(msg, {position: "top-right"});
            })
            .catch((error) => {
                console.error("ERROR in mark project fav: ", error);
            })
        }
    }

    //Task Detail
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

    const toggleTaskDetail = async(task) => {
        skipWatcher.value = true;
        const routeObj = {
            cid: companyId.value,
            id: task.ProjectID,
            sprintId: task.sprintId,
        }
        if(task.folderObjId) {
            routeObj.folderId = task.folderObjId;
        }

        if(!isTaskDetail.value) {
            routeObj.taskId = task._id;
            const taskDetail = {...task, sprintName:task?.sprintArray?.name,folderName:task?.sprintArray?.folderName,id: task._id}
            selectedTask.value = taskDetail;
            isTaskDetail.value = true;
            // Force navigation by going to a different route first, then to target
            await router.push({name: task.folderObjId?.length ? "ProjectFolderSprint" : "ProjectSprint", params: routeObj});
            await router.push({name: task.folderObjId?.length ? "ProjectFolderSprintTask" : "ProjectSprintTask", params: routeObj, query: {...route.query, detailTab: "task-detail-tab"}});
        } else {
            isTaskDetail.value = false;
            selectedTask.value = {};
            await router.push({name: task.folderObjId?.length ? "ProjectFolderSprint" : "ProjectSprint", params: routeObj, query: {tab: route.query.tab}});
        }
        await nextTick();
        skipWatcher.value = false;
    }
    provide('toggleTaskDetail', toggleTaskDetail);
    provide('isRouteRequired', true);
    const hanldeProjectTaktypeTour = ref(null);
    const hanldeProjectLastStep = ref(null);
    // const hanldeProjectViewAndOption = ref(null);
    const hanldeBlankProjectTour = () => {
        if(companyUserDetail.value && (companyUserDetail.value.roleType === 1 || companyUserDetail.value.roleType === 2)) {
            if(getUser(userId.value)?.tourStatus?.isProjectTour == undefined || getUser(userId.value)?.tourStatus?.isProjectTour === false || (getUser(userId.value)?.tourStatus == undefined || Object.keys(getUser(userId.value)?.tourStatus).length == 0)) {
                if(clientWidth.value > 767) {
                    tourHandler('isProjectTour1',true);
                }
            }
        }
    }
    hanldeProjectTaktypeTour.value = () => {
        if(companyUserDetail.value && (companyUserDetail.value.roleType === 1 || companyUserDetail.value.roleType === 2)) {
            if(getUser(userId.value)?.tourStatus?.isProjectTour == undefined || getUser(userId.value)?.tourStatus?.isProjectTour === false || (getUser(userId.value)?.tourStatus == undefined || Object.keys(getUser(userId.value)?.tourStatus).length == 0)) {
                if(clientWidth.value > 767) {
                    tourHandler('isProjectTour2',true);
                }
            }
        }
    }
    hanldeProjectLastStep.value = () => {
        if(companyUserDetail.value && (companyUserDetail.value.roleType === 1 || companyUserDetail.value.roleType === 2)) {
            if(getUser(userId.value)?.tourStatus?.isProjectTour == undefined || getUser(userId.value)?.tourStatus?.isProjectTour === false || (getUser(userId.value)?.tourStatus == undefined || Object.keys(getUser(userId.value)?.tourStatus).length == 0)) {
                if(clientWidth.value > 767) {
                    tourHandler('isProjectTour3',true);
                }
            }
        }
    }
    provide('hanldeBlankProjectTour', hanldeBlankProjectTour);
    provide('hanldeProjectTaktypeTour', hanldeProjectTaktypeTour);
    provide('hanldeProjectLastStep', hanldeProjectLastStep);
    // provide('hanldeProjectViewAndOption', hanldeProjectViewAndOption);
    const users = computed(() => getters["users/users"]);
    const teams = computed(() => getters["settings/teams"])
    /**
     * This function is used to manage "Files & Links" and "Audio" sidebar
     */
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
    }
    const billingPer = ref('');
    const projectStartDate = ref({});
    const handleEmitProjectRightSide = (action,value) => {
        if(action === 'billingPeriod'){
            projectData.value.BillingPeriod = value;
            billingPer.value = value;
        }
        if(action === 'startDate'){
            projectStartDate.value = value;
        }
        if(action === 'currency'){
            projectData.value.ProjectCurrency = value;
        }
        if(action === 'projectType'){
            if(value?.updateObject?.ProjectType){
                projectData.value.ProjectType = value?.updateObject?.ProjectType || '';
            }
            if(value?.updateObject?.BillingPeriod){
                projectData.value.BillingPeriod = value?.updateObject?.BillingPeriod || '';
            }
        }
    } 
    /**
     * This function is used to perfom filter based on selected fields
     * @param {String} query 
     */
    const applyFilter = (query) => {
        filterQuery.value = query;
        searchMongoDB()
    }

    /**
     * This function is used to clear all the selected filters
     */
    const clearFilter = () => {
        filterQuery.value = '';
        searchMongoDB()
    }

    function assignAvatarData(data) {
        formData.value.projectName = data.name;
        formData.value.projectId = data.id;
        formData.value.icon= data?.icon || ''

        if(data.icon.type === 'image') {
            formData.value.projectProfileField.previewImage.value = data?.icon?.data || '';
        } else {
            formData.value.projectProfileField.selectedColor.value = data?.icon?.data || '';
        }
    }

    async function saveProjectAvatar() {
        const updateObject = {type: "color", data : ""};
        const prevIcon = formData?.value?.icon || '';
        savingAvatar.value = true;

        const deleteWasabiImage = () => {
            try {
                let axiousObject = storageQueryBuilder('delete',companyId.value,((env.STORAGE_TYPE && env.STORAGE_TYPE === 'server') ? (prevIcon.data + "&thubmkey=projectIcon") : prevIcon.data));
                apiRequest(axiousObject.method, axiousObject.route, axiousObject.data)
                .then((response) => {
                    if(!response.data.status) {
                        console.error("ERROR in delete wasabi image: ", response.data.statusText);
                    }
                })
                .catch((error) => {
                    console.error("ERROR in upload image: ", error);
                })
            } catch (error) {
                console.error("ERROR in upload image: ", error);
            }
        }

        if(formData.value.projectProfileField.previewImage.value !== ""){
            let name = generateFileName(previewImage.value.name,env.STORAGE_TYPE);
            const filePath = `Project/${projectData.value._id}/Settings/ProjectIcon/${name}`
            updateObject.type = "image";

            const apiFormData = new FormData();
            apiFormData.append("companyId", companyId.value);
            apiFormData.append("path", filePath);
            apiFormData.append("key", 'projectIcon');
            apiFormData.append("file", previewImage.value);

            if(prevIcon.type === 'image' && !prevIcon.data.includes('http')) {
                deleteWasabiImage();
            }
            
            updateObject.data = await apiRequestWithoutCompnay("post", storageQueryBuilder('upload').route, apiFormData, "form")
            .then((response) => {
                if(response.data.status) {
                    let imageUrlPath = env.STORAGE_TYPE && env.STORAGE_TYPE==='server' ? response.data.statusText : response.data.statusText[0];
                    return imageUrlPath
                } else {
                    return "";
                }
            })
            .catch((error) => {
                console.error("ERROR in upload image: ", error);
            })
        }
        else {
            if(prevIcon.type === 'image' && !prevIcon.data.includes('http')) {
                deleteWasabiImage();
            }
            
            updateObject.data = formData.value.projectProfileField.selectedColor.value;
        }

        if(!updateObject.data?.length) {
            $toast.error(t(`Toast.something went worng`), {position: "top-right"})
            savingAvatar.value = false;
            return;
        }
        try {
            await apiRequest("put",`/api/v1/${env.PROJECTACTIONS}/${projectData.value._id}`,{updateObject: { projectIcon: {...updateObject} }})
            resetFormData();
            savingAvatar.value = false;
            showColorAvatar.value = false;
            const user = getUser(userId.value);
            const userData = {
                id: user.id,
                Employee_Name: user.Employee_Name,
                companyOwnerId: user.companyOwnerId
            }
            let historyObj = {
                key : "Project_EndDate",
                message : `<b>${userData.Employee_Name}</b> has changed <b> ${updateObject.type === 'color' ? 'color' : 'avatar'} </b> </b>.`
            }
            apiRequest("post", env.HANDLE_HISTORY, {
                "type": 'project',
                "companyId": companyId.value,
                "projectId": projectData.value._id,
                "taskId": null,
                "object": historyObj,
                "userData": userData
            })
            commit('projectData/projectLocalUpdate', {itemData:  {...updateObject},projectId:projectData.value._id,key:'ProjectIcon',subKey:'',userId: ''});
            $toast.success(t(`Toast.Project_avatar_updated_successfully`), {position: "top-right"});
        } catch (error) {
            resetFormData();
            savingAvatar.value = false;
            $toast.error(t(`Toast.something_went_wrong`), {position: "top-right"})
            console.error(`Error while change avatar of project:`,error);
        }
    }
    const handleDescription = (value) => {
        isVisibleProjectDetial.value = value
    };
    const handleViewName = (value) => {
        if(value === 'Project Details'){
            isVisibleProjectDetial.value = true;
        }
    }

    function updateImageValue(ele) {
        previewImage.value = ele[0]
    }

    async function updateProject(value = null) {
        showSpinner.value = true;
        let updateObject = {};
        if(value !== null || archive.value !== 0) {
            updateObject.deletedStatusKey = value !== null ? value : archive.value === 1 ? 2 : 1;
        } else {
            let status = projectData.value.projectStatusData.find((x) => x.type === "close");
            updateObject.status = status.value;
            updateObject.statusType = status.type;
        }
        try {
            await apiRequest("put", `/api/v1/${env.PROJECTACTIONS}/${projectData.value._id}`, {updateObject: { ...updateObject }});
            showSidebar.value = false;
            showSpinner.value = false;
            const ProjectId = JSON.parse(JSON.stringify(projectData.value._id))
            updateChildTasks(value !== null,ProjectId);
            const user = getUser(userId.value);
            const userData = {
                id: user.id,
                Employee_Name: user.Employee_Name,
                companyOwnerId: user.companyOwnerId
            }

            let type = `${value !== null ? 'restored' : archive.value === 0 ? 'closed' : archive.value === 1 ? 'archived' : 'deleted'}`;

            $toast.success(t(`Toast.Project ${type} successfully`), {position: 'top-right'});

            let notificationObject = {
                'message': `<p><strong>${userData.Employee_Name}</strong> has ${type} the <strong>${sanitizeInput(projectData.value.ProjectName)}</strong> Project</p>`,
                'key': 'project_close',
                'projectId': projectData.value._id,
            }
            var historyObj = {
                'message': `<b>${userData.Employee_Name}</b> has ${type} the <b>${sanitizeInput(projectData.value.ProjectName)}</b> Project`,
                'key' : 'Project_Name',
            }
            addHistory({
                "type": 'project',
                "companyId": companyId.value,
                "projectId": projectData.value._id,
                "taskId": null,
                "object": historyObj,
                "userData": userData
            });
            addNotification({
                type:'project',
                "companyId": companyId.value,
                projectId: projectData.value._id,
                object: notificationObject,
                userData
            });
            commit('projectData/projectLocalUpdate', {itemData: {...projectData.value,...updateObject},projectId:projectData.value._id,key:value === null ? 'RemoveProject' : 'AddProject',subKey:'',userId: ''});
        } catch (error) {
            showSidebar.value = false;
            showSpinner.value = false;
            $toast.error(t(`Toast.something_went_wrong`), {position: "top-right"})
            console.error("ERROR in update project: ", error);
        }
    }

    function updateChildTasks(restore = false,ProjectId='') {
        try {
            let dsk = archive.value;
            let taskDeleteStatusKey = 0;
            let deletedStatusKey;
            if(restore) {
                deletedStatusKey = dsk ? 8 : 7;
                taskDeleteStatusKey = 0;
            } else {
                deletedStatusKey = 0
                if(dsk === 1 || dsk === 0) {
                    taskDeleteStatusKey = (dsk === 0 ? 8 : 7)
                } else if(dsk === 2) {
                    taskDeleteStatusKey = 1
                }
            }
            try {
                const object = {
                    firstParameter:{
                        objId: {
                            ProjectID: ProjectId,
                        },
                        deletedStatusKey:deletedStatusKey
                    },
                    secondParameter:{
                        $set: {deletedStatusKey: taskDeleteStatusKey}
                    },
                    key:"updateMany",
                    isConvertFirstParameter:true,
                    isConvertSecondParameter:false
                }
                
                apiRequest("put",env.TASK,object)
                .catch((error) =>{
                    console.error(error)
                })
            } catch (error) {
                console.error(error)
            }
        } catch (error) {
            console.error(`ERROR in update tasks: `, error);
        }
    }

    function openPermissionSidebar () {
        permissionSidebar.value = true;
    }
    const handleView = (view) => {
        activeTab.value = view.keyName;
        if (route.query.tab !== view.keyName) {
            router.push({
                query: {
                ...route.query,
                tab: view.keyName
                },
            })
        }
    }
    function handleUnarchived() {
        showArchived.value = false;
        visible.value = !visible.value;
        showArchivedProjects.value = false;
    }

    function getProjectRule(data) {
        if(data.isGlobalPermission === false) {
            isRuleData.value = true;
            if(getters["settings/projectRawRules"] && getters["settings/projectRawRules"].length > 0){
                if(getters["settings/projectRawRules"].some((x) => x.projectId !== data._id)){
                    dispatch("settings/setProjectRules", {pid: data._id}).then(() => {
                        nextTick(()=>{
                            isRuleData.value = false;
                            rulePermission.value = checkPermission('project.project_list',data.isGlobalPermission,{gettersVal: getters})
                        })
                    }).catch(() => {
                        nextTick(()=>{
                            isRuleData.value = false;
                            rulePermission.value = checkPermission('project.project_list',data.isGlobalPermission,{gettersVal: getters})
                        })
                    })
                }else{
                    nextTick(()=>{
                        isRuleData.value = false;
                        rulePermission.value = checkPermission('project.project_list',data.isGlobalPermission,{gettersVal: getters})
                    })
                }
            }
            else{
                dispatch("settings/setProjectRules", {pid: data._id}).then(() => {
                    nextTick(()=>{
                        isRuleData.value = false;
                        rulePermission.value = checkPermission('project.project_list',data.isGlobalPermission,{gettersVal: getters})
                    })
                }).catch(() => {
                    nextTick(()=>{
                        isRuleData.value = false;
                        rulePermission.value = checkPermission('project.project_list',data.isGlobalPermission,{gettersVal: getters})
                    })
                })
            }
        }
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
    /* height: 50px;  */
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
    /* width: 79px; */
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