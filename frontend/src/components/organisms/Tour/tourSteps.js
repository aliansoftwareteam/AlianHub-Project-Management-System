/* CommonJS on purpose: webpack consumes it in the app and root Jest checks every selector against source.
   Each step lists selectors in preference order; a missing anchor degrades to a centred card.
   Copy lives at AuthV2.tour_<screen>_<key>_title|body|next. */
const STEPS = {
    shell: [
        { key: 'rail', els: ['.ah-rail'], side: 'right', align: 'start' },
        { key: 'work', els: ['.hc-mywork', '.ah-app__view'], side: 'left', align: 'start' },
        { key: 'more', els: ['.ah-rail__item--btn', '.ah-rail__foot'], side: 'right', align: 'end' },
        { key: 'timer', els: ['.hc-mywork', '.ah-rail__foot'], side: 'left', align: 'end' }
    ],
    project: [
        { key: 'header', els: ['.ph2__bar'], side: 'bottom', align: 'start' },
        { key: 'views', els: ['.ph2__views'], side: 'bottom', align: 'start' },
        { key: 'new', els: ['.nip', '.ph2__actions'], side: 'bottom', align: 'end' },
        { key: 'search', els: ['#projectviewfiltersearch_driver', '.pft'], side: 'bottom', align: 'start' },
        { key: 'more', els: ['#more_features', '.pft'], side: 'bottom', align: 'end' }
    ],
    board: [
        { key: 'columns', els: ['.kanban-column', '.kanban-board'], side: 'right', align: 'start' },
        { key: 'add', els: ['.add-task-icon', '.kanban-column'], side: 'bottom', align: 'start' },
        { key: 'wip', els: ['.task-count', '.kanban-column'], side: 'bottom', align: 'start' },
        { key: 'cards', els: ['.kanban-card-wrapper', '.kanban-board'], side: 'right', align: 'start' }
    ],
    list: [
        { key: 'columns', els: ['.lv2__cols', '#list_scroll'], side: 'bottom', align: 'start' },
        { key: 'group', els: ['#group_by', '.pft'], side: 'bottom', align: 'end' },
        { key: 'subtasks', els: ['.current__dropdown', '.pft'], side: 'bottom', align: 'end' },
        { key: 'bulk', els: ['.lv2__cols', '#list_scroll'], side: 'bottom', align: 'start' }
    ]
};

const SCREENS = Object.keys(STEPS);
const doneKey = (screen) => (screen === 'shell' ? 'isShellTour' : `isTour_${screen}`);

function screenFor(route) {
    if (route && route.meta && route.meta.tour) return route.meta.tour;
    const name = String((route && route.name) || '');
    if (name === 'Home') return 'shell';
    if (name.startsWith('Project') && name !== 'Projects') {
        const tab = String((route && route.query && route.query.tab) || '');
        if (tab === 'ProjectKanban') return 'board';
        if (tab === 'ProjectListView') return 'list';
        return 'project';
    }
    return '';
}

module.exports = { STEPS, SCREENS, screenFor, doneKey };
