<template>
    <div class="ah-page cv">
        <div class="cv__bar">
            <span class="ah-mono cv__month">{{ monthLabel }}</span>
            <div class="ah-toolbar__spacer"></div>
            <span class="ah-label cv__show">{{ $t('Views.show') }}</span>
            <button
                v-for="filter in filters"
                :key="filter.key"
                type="button"
                class="cv__filter"
                :class="{ 'is-on': filter.model.value }"
                :aria-pressed="filter.model.value"
                @click="filter.model.value = !filter.model.value"
            >{{ filter.label }}</button>
        </div>

        <div class="cv__body">
            <div class="cv__main">
                <div v-if="showSprints && sprintBands.length" class="cv__bands">
                    <span
                        v-for="band in sprintBands"
                        :key="band.id"
                        class="cv__band"
                        :class="{ 'is-current': band.current }"
                        :style="{ left: `${band.left}%`, width: `${band.width}%` }"
                    >{{ band.label }}</span>
                </div>

                <div
                    class="cv__grid"
                    @dragover.prevent="onGridDragOver"
                    @dragleave="onGridDragLeave"
                    @drop.prevent="onGridDrop"
                >
                    <FullCalendar v-if="isDone" class="demo-app-calendar" :options="calendarOptions">
                        <template v-slot:eventContent="arg">
                            <span
                                class="cv__chip"
                                :class="{ 'cv__chip--pto': arg.event.extendedProps.kind === 'pto', 'cv__chip--done': arg.event.extendedProps.isClosed }"
                                :style="chipStyle(arg.event)"
                            >
                                <img v-if="arg.event.extendedProps.kind !== 'pto' && !arg.event.extendedProps.isParent" class="cv__chip-icon" :src="subTask" alt="" />
                                {{ arg.event.title }}
                            </span>
                        </template>
                    </FullCalendar>
                    <SpinnerComp v-else :is-spinner="!isDone" />
                </div>
            </div>

            <aside class="cv__tray ah-scroll">
                <div class="cv__tray-head">
                    <span class="cv__tray-title">{{ $t('Views.unscheduled') }}</span>
                    <span class="ah-mono cv__tray-count">{{ unscheduled.length }}</span>
                </div>
                <p v-if="!unscheduled.length" class="cv__tray-empty ah-small">{{ $t('Views.tray_empty') }}</p>
                <div
                    v-for="task in unscheduled"
                    :key="task._id"
                    class="cv__card"
                    :class="{ 'is-dragging': dragTask && dragTask._id === task._id }"
                    :draggable="canSchedule"
                    @dragstart="onCardDragStart(task, $event)"
                    @dragend="onCardDragEnd"
                    @click="openTaskFromTray(task)"
                >
                    <span class="cv__card-name">{{ task.TaskName || task.TaskKey }}</span>
                    <span class="cv__card-meta ah-small">{{ trayMeta(task) }}</span>
                </div>
                <div v-if="proposal" class="cv__proposal">
                    <span class="cv__spark">✦</span>
                    {{ proposal.what }}
                    <router-link class="cv__proposal-link" :to="{ name: 'AiInbox', params: { cid: companyId } }">{{ $t('Views.review') }}</router-link>
                </div>
            </aside>
        </div>
    </div>
</template>

<script setup>
    // PACKAGES
    import { computed, ref, inject, watch, onMounted, watchEffect, onBeforeUnmount } from 'vue';
    import { useStore } from 'vuex';
    import FullCalendar from '@fullcalendar/vue3';
    import dayGridPlugin from '@fullcalendar/daygrid';
    import timeGridPlugin from '@fullcalendar/timegrid';
    import interactionPlugin from '@fullcalendar/interaction';
    import subTask from '@/assets/images/subtask1.png';
    import SpinnerComp from '@/components/atom/SpinnerComp/SpinnerComp.vue';
    import taskClass from "@/utils/TaskOperations";
    import { taskDueDateAdd, taskDueDateChange, taskStartAndDueDateChange, taskStartAndDueDateAdd } from '@/utils/NotificationTemplate';
    import { useGetterFunctions, useMoment, useCustomComposable } from '@/composable';
    import { openTask } from '@/components/organisms/TaskDetailOverlay/useTaskOverlay';
    import * as env from '@/config/env';
    import { useToast } from 'vue-toast-notification';
    import { apiRequest } from '../../../services';
    import { useI18n } from "vue-i18n";

    defineOptions({ name: "CalendarViewComponent" });

    const { t } = useI18n();
    const $toast = useToast();
    const { getters } = useStore();
    const companyOwner = computed(() => {
        return getters["settings/companyOwnerDetail"];
    });
    const toggleTaskDetail = inject("toggleTaskDetail");
    const { changeDateFormate } = useMoment();
    const { getUser } = useGetterFunctions();
    const { checkPermission } = useCustomComposable();
    let debounceTimeout;
    const emits = defineEmits(["openTaskModel"]);
    const companyId = inject('$companyId');
    const dateFormat = inject('$dateFormat');
    const searchedTask = inject('searchedTask');
    const taskDetailOpenObject = ref({});
    const isDone = ref(true);
    const isOpenModel = ref(false);
    const props = defineProps({
        sprint: Object,
        projectData: {
            type: Object,
        },
        calendarDate: {
            type: [String,Number]
        },
        newTaskData: {
            type: Object
        },
        taskSearch: {
            type: String
        }
    })
    const sData = ref(props.sprint);
    const projectData = ref(props.projectData);

    const showDue = ref(true);
    const showPto = ref(true);
    const showSprints = ref(true);
    const filters = computed(() => [
        { key: 'due', label: t('Views.filter_due'), model: showDue },
        { key: 'pto', label: t('Views.filter_pto'), model: showPto },
        { key: 'sprints', label: t('Views.filter_sprints'), model: showSprints },
    ]);

    const unscheduled = ref([]);
    const ptoEntries = ref([]);
    const proposal = ref(null);
    const visibleRange = ref({ start: null, end: null });
    const dragTask = ref(null);

    const canSchedule = computed(() => checkPermission('task.task_due_date', projectData.value?.isGlobalPermission) === true);

    const monthLabel = computed(() => {
        const anchor = visibleRange.value.start
            ? new Date(visibleRange.value.start.getTime() + 14 * 86400000)
            : new Date(props.calendarDate || Date.now());
        return anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }).toUpperCase();
    });

    const formatDate = (date) =>  {
        var d = new Date(date),
            month = '' + (d.getMonth() + 1),
            day = '' + d.getDate(),
            year = d.getFullYear();

        if (month.length < 2)
            month = '0' + month;
        if (day.length < 2)
            day = '0' + day;

        return [year, month, day].join('-');
    }

    const dayLabel = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

    const chipStyle = (event) => {
        if (event.extendedProps.kind === 'pto') return {};
        return {
            background: event.backgroundColor || 'var(--surface-2)',
            borderLeft: `3px solid ${event.extendedProps.borderLeftColor || 'var(--brand)'}`,
        };
    };

    const trayMeta = (task) => {
        const owner = task.Task_Leader ? getUser(task.Task_Leader)?.Employee_Name : '';
        const estimate = Number(task.taskFinalEstimate || task.totalTaskEstMin || 0);
        const hours = estimate ? `${Math.round((estimate / 60) * 10) / 10}h` : '';
        return [owner, hours].filter(Boolean).join(' · ');
    };

    const handleEventClick = (clickInfo) => {
        if (clickInfo.event.extendedProps.kind === 'pto') return;
        taskDetailOpenObject.value = {};
        taskDetailOpenObject.value.CompanyId = companyId.value;
        taskDetailOpenObject.value.ProjectID = clickInfo.event.extendedProps.projectId;
        taskDetailOpenObject.value.sprintId = clickInfo.event.extendedProps.sprintId;
        taskDetailOpenObject.value.id = clickInfo.event.id;
        const {sprintArray, sprintId, folderObjId} = clickInfo.event.extendedProps;
        toggleTaskDetail({
            ProjectID: clickInfo.event.extendedProps.projectId,
            sprintArray: {...sprintArray, id: sprintId, folderId: folderObjId || ""},
            sprintId,
            _id: clickInfo.event.id
        })
    }

    const openTaskFromTray = (task) => {
        openTask({
            companyId: companyId.value,
            projectId: task.ProjectID || projectData.value?._id,
            sprintId: task.sprintId || props.sprint?.id,
            folderId: task.folderObjId || task.sprintArray?.folderId || '',
            taskId: task._id,
        });
    };

    const currentEvents = ref([]);
    const handleEvents = (events) => {
        currentEvents.value = events
    }

    const handleEventsSelect = (events) => {
        isOpenModel.value = true;
        const endDate = events.end;
        emits('openTaskModel', {
            modalStartDate: events.start,
            modalEndDate: new Date(endDate.setDate(endDate.getDate() - 1))
        });
    };

    const handleEventsChange = (events) => {
        let isUpdate = false;
        if (events.event.startStr !== events.oldEvent.startStr) {
            isUpdate = true;
        }
        if (events.event.endStr !== events.oldEvent.endStr) {
            if (isUpdate) {
                isUpdate = true;
                updateDueDate(events, false);
                return;
            }
            updateDueDate(events, true);
            isUpdate = false;
        }
    }

    const sprintsOfProject = computed(() => {
        const project = projectData.value || {};
        const out = [];
        const push = (obj) => Object.values(obj || {}).forEach((s) => { if (s && s.deletedStatusKey !== 1) out.push(s); });
        push(project.sprintsObj);
        Object.values(project.sprintsfolders || {}).forEach((folder) => push(folder && folder.sprintsObj));
        if (props.sprint) out.push(props.sprint);
        const seen = new Set();
        return out.filter((s) => {
            const id = String(s.id || s._id || '');
            if (!id || seen.has(id)) return false;
            seen.add(id);
            return true;
        });
    });

    // A month-wide strip, so a sprint that runs past the grid still reads as one
    // block. Only sprints that actually carry both dates are drawn.
    const sprintBands = computed(() => {
        const { start, end } = visibleRange.value;
        if (!start || !end) return [];
        const span = end.getTime() - start.getTime();
        if (span <= 0) return [];
        return sprintsOfProject.value
            .filter((s) => s.startDate && s.endDate)
            .map((s) => {
                const from = new Date(s.startDate).getTime();
                const to = new Date(s.endDate).getTime();
                const left = ((Math.max(from, start.getTime()) - start.getTime()) / span) * 100;
                const width = ((Math.min(to, end.getTime()) - Math.max(from, start.getTime())) / span) * 100;
                return {
                    id: String(s.id || s._id),
                    current: String(s.id || s._id) === String(props.sprint?.id || props.sprint?._id),
                    label: `${(s.name || t('Views.sprint_fallback')).toUpperCase()} · ${dayLabel(formatDate(from))}–${dayLabel(formatDate(to))}`,
                    left,
                    width,
                };
            })
            .filter((band) => band.width > 0 && band.left < 100);
    });

    const sprintRanges = computed(() => sprintsOfProject.value
        .filter((s) => s.startDate && s.endDate)
        .map((s) => ({ from: formatDate(new Date(s.startDate)), to: formatDate(new Date(s.endDate)) })));

    const ptoByDay = computed(() => {
        const map = {};
        if (!showPto.value) return map;
        ptoEntries.value.forEach((entry) => {
            const from = new Date(entry.startDate);
            const to = new Date(entry.endDate);
            for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
                const key = formatDate(d);
                (map[key] = map[key] || []).push(entry.userName || t('Views.teammate'));
            }
        });
        return map;
    });

    const escapeHtml = (value) => String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    const dayCellContent = (arg) => {
        const iso = formatDate(arg.date);
        const names = ptoByDay.value[iso] || [];
        const pto = names.map((name) => `<span class="cv__pto">${escapeHtml(name)} · ${t('Views.pto')}</span>`).join('');
        const number = `<span class="cv__daynum">${arg.dayNumberText}${arg.isToday ? ` · ${t('Views.today')}` : ''}</span>`;
        return { html: `${number}${pto}` };
    };

    const dayCellClassNames = (arg) => {
        if (!showSprints.value) return [];
        const iso = formatDate(arg.date);
        return sprintRanges.value.some((r) => r.from <= iso && iso <= r.to) ? ['cv-in-sprint'] : [];
    };

    const calendarOptions = ref({
        plugins: [
            dayGridPlugin,
            timeGridPlugin,
            interactionPlugin // needed for dateClick
        ],
        headerToolbar: false,
        initialView: 'dayGridMonth',
        firstDay: 1,
        height: '100%',
        fixedWeekCount: false,
        initialDate: formatDate(new Date().getTime()),
        events: [], // alternatively, use the `events` setting to fetch from a feed
        editable: (checkPermission('task.task_due_date',projectData.value?.isGlobalPermission) == true && checkPermission('task.task_start_date',projectData.value?.isGlobalPermission) == true) ? true : false,
        selectable: (checkPermission('task.task_due_date',projectData.value?.isGlobalPermission) == true && checkPermission('task.task_start_date',projectData.value?.isGlobalPermission) == true) ? true : false,
        selectMirror: true,
        dayMaxEvents: 3,
        weekends: true,
        dayCellContent,
        dayCellClassNames,
        moreLinkContent: (arg) => t('Views.more_count', { n: arg.num }),
        datesSet: (arg) => {
            visibleRange.value = { start: arg.start, end: arg.end };
            loadPto(arg.start, arg.end);
        },
        eventClick: handleEventClick,
        eventsSet: handleEvents,
        eventChange: handleEventsChange,
        select: handleEventsSelect
    });

    // FullCalendar reads these callbacks once per render, so a new closure is what
    // makes freshly loaded PTO or a filter change reach the cells.
    watch([ptoByDay, () => showSprints.value, () => sprintRanges.value], () => {
        calendarOptions.value.dayCellContent = (arg) => dayCellContent(arg);
        calendarOptions.value.dayCellClassNames = (arg) => dayCellClassNames(arg);
    });

    watch(showDue, (on) => {
        calendarOptions.value.eventDisplay = on ? 'auto' : 'none';
    });

    watch([() => props.calendarDate], (data) => {
        isDone.value = false;
        if (data && data.length) {
            const selectedDate = data[0];
            calendarOptions.value.initialDate = formatDate(selectedDate)
            setTimeout(() => {
                isDone.value = true;
            })
        } else {
            setTimeout(() => {
                isDone.value = true;
            })
        }
    })

    watch([() => props.newTaskData], (data) => {
        taskSubmit(JSON.parse(JSON.stringify(data[0])));
    });

    const filteredTasksGetter = computed(() => {
        if(getters['projectData/searchedTasks']?.length && sData.value.id) {
                return getters['projectData/searchedTasks'].filter((x) => x.sprintId === sData.value.id);
        } else {
            return [];
        }
    });

    const eventFromTask = (data, project) => {
        const status = project.taskStatusData?.length ? project.taskStatusData.find((x) => x.key === data.statusKey) : null;
        return {
            allDay: true,
            id: data._id,
            title: data.TaskName,
            start: formatDate(data.startDate),
            end: formatDate(new Date(data.DueDate).getTime() + 86400000),
            backgroundColor: status ? status.bgColor : 'var(--surface-2)',
            borderColor: status ? status.bgColor : 'var(--hairline)',
            textColor: 'black',
            borderLeftColor: status ? status.textColor : 'var(--brand)',
            isParent: data.isParentTask ? data.isParentTask : false,
            isClosed: status ? status.type === 'close' : false,
            dueDateDeadLine: data?.dueDateDeadLine ? data.dueDateDeadLine : [],
            projectId: data?.ProjectID ? data.ProjectID : "",
            sprintId: data?.sprintId ? data.sprintId : "",
            taskLeader: data?.Task_Leader ? data.Task_Leader : "",
            sprintArray: data?.sprintArray ? data.sprintArray : {},
            isStartDate: data.isStartDate,
            kind: 'task',
        };
    };

    const withFallbackDates = (task) => {
        if (!task.DueDate || task.DueDate === 0) {
            task.isStartDate = true;
            task.DueDate = task.startDate;
        }
        if (!task.startDate || task.startDate === 0) {
            task.isStartDate = false;
            task.startDate = task.DueDate;
        }
        return task;
    };

    const manageSearchData = (mdata) => {
        if(searchedTask.value) {
            const project = JSON.parse(JSON.stringify(projectData.value));
            let allTasks = [];
            mdata.forEach((task) => {
                allTasks = [...allTasks, task]
                if(task.subtaskArray?.length) {
                    allTasks = [...allTasks, ...task.subtaskArray]
                }
            })
            unscheduled.value = allTasks.filter((x) => (!x?.startDate || x.startDate === 0) && (!x?.DueDate || x.DueDate === 0));
            allTasks = allTasks.filter((x) => !((!x?.startDate || x.startDate === 0) && (!x?.DueDate || x.DueDate === 0)));
            calendarOptions.value.events = JSON.parse(JSON.stringify(
                allTasks.map((task) => eventFromTask(withFallbackDates(task), project))
            ));
        }
    }

    watch(filteredTasksGetter, (mdata) => {
        manageSearchData(mdata)
    });

    watchEffect(() => {
        const {data: taskData, pid, sprintId} = JSON.parse(JSON.stringify(getters['projectData/mongoUpdatedTask']));
        if(pid === projectData.value._id && sprintId === props.sprint.id) {
            const project = JSON.parse(JSON.stringify(projectData.value));
            const calendarData = calendarOptions.value.events;
            const index = calendarData.findIndex((x) => x.id === taskData._id);
            if (index !== -1) {
                calendarData[index] = eventFromTask(withFallbackDates(taskData), project);
                return;
            }
            if ((!taskData.startDate || taskData?.startDate === 0) && (!taskData.DueDate || taskData?.DueDate === 0)) {
                return;
            }
            calendarData.push(eventFromTask(withFallbackDates(taskData), project));
            calendarOptions.value.events = calendarData;
            unscheduled.value = unscheduled.value.filter((x) => x._id !== taskData._id);
        }
    })

    watch(props.sprint, (newVal) => {
        sData.value = newVal;
    })
    watch(searchedTask, (data) => {
        if (data) {
            calendarOptions.value.selectable = false;
        } else {
            calendarOptions.value.selectable = true;
            getTaskData();
        }
    })

    const taskSubmit = (data) => {
        const project = JSON.parse(JSON.stringify(projectData.value));
        data.statusKey = data?.statusKey ? data.statusKey : 1;
        calendarOptions.value.events = [
            ...JSON.parse(JSON.stringify(calendarOptions.value)).events,
            { ...eventFromTask(data, project), isStartDate: true },
        ];
        isOpenModel.value = false;
    }

    function getUserData(id) {
        const user = getUser(id);
        return {
            id: user.id,
            Employee_Name: user.Employee_Name,
            companyOwnerId: companyOwner.value.userId,
        };
    }

    const finalProjectData = () => ({
        _id: projectData.value._id,
        CompanyId: projectData.value.CompanyId,
        lastTaskId: projectData.value.lastTaskId,
        ProjectName: projectData.value.ProjectName,
        ProjectCode: projectData.value.ProjectCode
    });

    const updateDueDate = (event, key) => {
        try {
            const extendedProps = event.event.extendedProps;
            const endDate = event.event.end;
            const id = event.event.id;
            const projectId = event.event.extendedProps.projectId;
            const sprintId = event.event.extendedProps.sprintId;
            const taskName = event.event.title;
            const taskLeader = event.event.extendedProps.taskLeader;
            const sprintArray = event.event.extendedProps.sprintArray;
            const userData = getUserData(taskLeader);
            let newdueDateDeadLine = [];
            if(extendedProps.dueDateDeadLine.length > 0) {
                extendedProps.dueDateDeadLine.forEach((date) => {
                    const dateConvert = date;
                    newdueDateDeadLine.push({ date: new Date(dateConvert.date) })
                })
                newdueDateDeadLine.push({ date: new Date(endDate.setDate(endDate.getDate() - 1))});
            } else {
                newdueDateDeadLine.push({ date: new Date(endDate.setDate(endDate.getDate() - 1))});
            }

            const updateobj = {
                DueDate: new Date(endDate),
                dueDateDeadLine: newdueDateDeadLine
            }
            const typesenseObj = {
                DueDate: new Date(endDate).getTime()/1000,
                dueDateDeadLine: newdueDateDeadLine.map((x) => JSON.stringify(x))
            }
            let notificationObj = {
                key: "task_due_date",
                projectId: projectId,
                taskId: id,
                sprintId: sprintId
            }
            let obj = {
                'ProjectName': projectData.value.ProjectName,
                'TaskName': taskName,
            }
            if(extendedProps.dueDateDeadLine.length > 0 ) {
                const lastRecord = extendedProps.dueDateDeadLine[extendedProps.dueDateDeadLine.length - 1];
                const dateConvert = lastRecord;
                obj.previousDate = changeDateFormate(new Date(dateConvert.date))
                obj.changedDate = changeDateFormate(endDate.setDate(endDate.getDate() - 1))
                notificationObj.message = taskDueDateChange(obj);
                if (!key) {
                    notificationObj.message = taskStartAndDueDateChange(obj)
                }
            } else  {
                obj.lastDate = changeDateFormate(endDate.setDate(endDate.getDate() - 1))
                notificationObj.message = taskDueDateAdd(obj);
                if (!key) {
                    notificationObj.message = taskStartAndDueDateAdd(obj);
                }
            }
            let updateObj = {
                commonDateFormatString: dateFormat.value,
                firebaseObj: updateobj,
                typesenseObj: typesenseObj,
                project: finalProjectData(),
                task: {
                    sprintId: sprintId,
                    _id: id,
                    sprintArray: sprintArray
                },
                obj: notificationObj,
                userData
            }
            if (!key) {
                updateObj.isUpdateTask = false;
            }
            if (!key) {
                let newFirebaseObj = {
                    ...updateObj.firebaseObj,
                    startDate: event.event.start
                }
                const startAndDueDateObj = {
                    action: "updateStartDateAndDueDate",
                    commonDateFormatString: dateFormat.value,
                    userData: updateObj.userData,
                    notificationObj: updateObj.obj,
                    firebaseObj: newFirebaseObj,
                    task: updateObj.task,
                    project: updateObj.project
                }
                apiRequest("patch", env.V2_TASKS, startAndDueDateObj)
                .then(() => {
                    $toast.success(t('Toast.Start_and_Due_date_updated_successfully'),{position: 'top-right'});
                })
                .catch((error) => {
                    $toast.error(t('Toast.Start_and_Due_date_not_updated'),{position: 'top-right'});
                    console.error(error);
                });
                return;
            }
            taskClass.updateDueDate(updateObj).then(() => {
                $toast.success(t('Toast.Due_date_updated_successfully'),{position: 'top-right'});
            }).catch((error) => {
                console.error("ERROR in updateDueDate: ", error);
                $toast.error(t('Toast.Due_date_not_updated'),{position: 'top-right'});
            })
        } catch (error) {
            console.error("ERROR in updateDueDate: ", error);
            $toast.error(t('Toast.Due_date_not_updated'),{position: 'top-right'});
        }
    }

    /* ------------------------- unscheduled tray → a due date ------------------------ */
    let hoveredCell = null;

    const clearHover = () => {
        if (!hoveredCell) return;
        hoveredCell.classList.remove('cv-drop');
        const hint = hoveredCell.querySelector('.cv-drop-hint');
        if (hint) hint.remove();
        hoveredCell = null;
    };

    const cellFrom = (event) => (event.target && event.target.closest ? event.target.closest('.fc-daygrid-day') : null);

    const onCardDragStart = (task, event) => {
        if (!canSchedule.value) return;
        dragTask.value = task;
        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', String(task._id));
        }
    };
    const onCardDragEnd = () => {
        dragTask.value = null;
        clearHover();
    };
    const onGridDragOver = (event) => {
        if (!dragTask.value) return;
        const cell = cellFrom(event);
        if (!cell || cell === hoveredCell) return;
        clearHover();
        hoveredCell = cell;
        cell.classList.add('cv-drop');
        const hint = document.createElement('div');
        hint.className = 'cv-drop-hint';
        hint.textContent = t('Views.drop_here', { date: dayLabel(cell.dataset.date) });
        (cell.querySelector('.fc-daygrid-day-events') || cell).prepend(hint);
    };
    const onGridDragLeave = (event) => {
        if (!hoveredCell || cellFrom(event) === hoveredCell) return;
        clearHover();
    };
    const onGridDrop = (event) => {
        const cell = cellFrom(event);
        const task = dragTask.value;
        clearHover();
        dragTask.value = null;
        if (!cell || !task || !cell.dataset.date) return;
        scheduleTask(task, cell.dataset.date);
    };

    const scheduleTask = (task, iso) => {
        const due = new Date(`${iso}T23:59:59`);
        const history = (Array.isArray(task.dueDateDeadLine) ? task.dueDateDeadLine : [])
            .map((entry) => ({ date: new Date(entry.date || entry) }))
            .filter((entry) => !Number.isNaN(entry.date.getTime()));
        history.push({ date: due });
        const notificationObj = {
            key: "task_due_date",
            projectId: task.ProjectID || projectData.value._id,
            taskId: task._id,
            sprintId: task.sprintId || props.sprint?.id,
            message: taskDueDateAdd({
                ProjectName: projectData.value.ProjectName,
                TaskName: task.TaskName,
                lastDate: changeDateFormate(due),
            }),
        };
        taskClass.updateDueDate({
            commonDateFormatString: dateFormat.value,
            firebaseObj: { DueDate: due, dueDateDeadLine: history },
            typesenseObj: { DueDate: due.getTime() / 1000, dueDateDeadLine: history.map((x) => JSON.stringify(x)) },
            project: finalProjectData(),
            task: {
                sprintId: task.sprintId || props.sprint?.id,
                _id: task._id,
                sprintArray: task.sprintArray || props.sprint || {},
            },
            obj: notificationObj,
            userData: getUserData(task.Task_Leader),
        }).then(() => {
            unscheduled.value = unscheduled.value.filter((x) => x._id !== task._id);
            const project = JSON.parse(JSON.stringify(projectData.value));
            calendarOptions.value.events = [
                ...calendarOptions.value.events,
                eventFromTask(withFallbackDates({ ...task, DueDate: due.getTime(), startDate: task.startDate || due.getTime() }), project),
            ];
            $toast.success(t('Toast.Due_date_updated_successfully'), { position: 'top-right' });
        }).catch((error) => {
            console.error("ERROR in scheduleTask: ", error);
            $toast.error(t('Toast.Due_date_not_updated'), { position: 'top-right' });
        });
    };

    const loadPto = (start, end) => {
        if (!start || !end) return;
        apiRequest('get', `${env.PTO}?status=approved&from=${formatDate(start)}&to=${formatDate(end)}&pageSize=50`)
            .then((res) => {
                ptoEntries.value = res?.data?.status ? (res.data.data || []) : [];
            })
            .catch(() => { ptoEntries.value = []; });
    };

    const loadProposal = () => {
        apiRequest('get', `${env.AGENT_PROPOSALS}?status=pending`)
            .then((res) => {
                const rows = res?.data?.status ? (res.data.data || []) : [];
                const pid = String(projectData.value?._id || '');
                proposal.value = rows.find((p) => String(p.projectId || '') === pid) || null;
            })
            .catch(() => { proposal.value = null; });
    };

    const getTaskData = (isTabRevisit = false) => {
        if (props.calendarDate) {
            calendarOptions.value.initialDate = formatDate(props.calendarDate)
            isDone.value = false;
        }
        try {
            const project = JSON.parse(JSON.stringify(projectData.value));
            const findQuery = [
                {
                    "$match": {
                        objId:{
                            ProjectID:project._id,
                            sprintId: props.sprint._id
                        },
                        deletedStatusKey: 0,
                        ...(isTabRevisit && { updatedAt: { $gte: new Date(sessionStorage.getItem('tableaveTime') - 60000) } })
                    }
                }
            ];
            apiRequest('post',`${env.TASK}/find`,{findQuery: findQuery}).then((data) => {
                if (data.status === 200 && data.data.length) {
                    let taskData = [...data.data];
                    // A task with neither date is the tray's content, not a dropped row.
                    unscheduled.value = taskData.filter((x) => (!x.DueDate || x.DueDate === 0) && (!x.startDate || x.startDate === 0));
                    taskData = taskData
                        .filter((x) => !((!x.DueDate || x.DueDate === 0) && (!x.startDate || x.startDate === 0)))
                        .map((x) => withFallbackDates(x));

                    const finalArray = taskData.map((task) => {
                        task.statusKey = task?.statusKey ? task.statusKey : 1;
                        return eventFromTask(task, project);
                    });

                    if (isTabRevisit) {
                        JSON.parse(JSON.stringify(finalArray)).forEach((ele)=>{
                            let index = calendarOptions.value.events.findIndex((x)=> x.id == ele.id);
                            if (index != -1) {
                               calendarOptions.value.events[index] = ele
                            } else {
                                calendarOptions.value.events.push(ele);
                            }
                        })
                    } else {
                        calendarOptions.value.events = finalArray
                    }
                    isDone.value = true;
                } else {
                    isDone.value = true;
                }
            }).catch((error) => {
                isDone.value = true;
                console.error('error', error)
            });
        } catch (error) {
            isDone.value = true;
            console.error(error);
        }
    };

   const visibilityHandler = async () => {
        clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(async () => {
            if (!document.hidden) {
                getTaskData(true);
            }
        }, 1000);
    };

    onMounted(() => {
        if (!searchedTask.value) {
            getTaskData();
        } else {
            if(getters['projectData/searchedTasks']?.length && props.sprint.id) {
                manageSearchData(getters['projectData/searchedTasks'].filter((x) => x.sprintId === props.sprint.id));
            } else {
                manageSearchData([]);
            }
        }
        loadProposal();

        // Add the event listener
        document.addEventListener('visibilitychange', visibilityHandler);
    });

    onBeforeUnmount(() => {
        clearTimeout(debounceTimeout);
        clearHover();
        document.removeEventListener('visibilitychange', visibilityHandler);
    });
</script>

<style scoped src="./style.css"></style>
<style src="../../../components/organisms/SprinstList/style.css"></style>
