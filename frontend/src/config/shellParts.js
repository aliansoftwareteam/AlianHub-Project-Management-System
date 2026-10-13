import { lazyShellPart } from '@/config/lazyShell';

export const SHELL_PART_LOADERS = {
    CommandPalette: () => import(/* webpackChunkName: "command-palette" */ '@/components/molecules/AdvanceSearch/CommandPalette.vue'),
    QuickCreateTask: () => import(/* webpackChunkName: "quick-create" */ '@/components/organisms/QuickCreateTask/QuickCreateTask.vue'),
    TaskTemplateDialogHost: () => import(/* webpackChunkName: "task-templates" */ '@/components/molecules/TaskTemplates/TaskTemplateDialogHost.vue'),
    AiFieldFillDialog: () => import(/* webpackChunkName: "ai-field-fill" */ '@/components/molecules/AiFieldFill/AiFieldFillDialog.vue'),
    NotepadPanel: () => import(/* webpackChunkName: "shell-panels" */ '@/components/molecules/Notepad/NotepadPanel.vue'),
    ClipsPanel: () => import(/* webpackChunkName: "shell-panels" */ '@/components/molecules/Clips/ClipsPanel.vue'),
    ClipRecorder: () => import(/* webpackChunkName: "shell-panels" */ '@/components/molecules/ClipRecorder/ClipRecorder.vue'),
    TalkToTextPopover: () => import(/* webpackChunkName: "shell-panels" */ '@/components/molecules/TalkToText/TalkToTextPopover.vue')
};

export const { CommandPalette, QuickCreateTask, TaskTemplateDialogHost, AiFieldFillDialog, NotepadPanel, ClipsPanel, ClipRecorder, TalkToTextPopover } = Object.fromEntries(
    Object.entries(SHELL_PART_LOADERS).map(([name, load]) => [name, lazyShellPart(load)])
);
