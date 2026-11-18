const IMPROVE_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/><path d="M19 15l.8 1.9 1.9.8-1.9.8L19 20.4l-.8-1.9-1.9-.8 1.9-.8z"/></svg>';
const TASKS_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l1.5 1.5L8 5"/><path d="M4 12l1.5 1.5L8 11"/><path d="M4 18l1.5 1.5L8 17"/><path d="M11 6h9M11 12h9M11 18h9"/></svg>';

/* Editor.js reads an inline tool's title and shortcut from static getters, so each editor gets
 * its own classes carrying the translated labels. */
function inlineTool({ kind, title, icon, shortcut, onPick }) {
    return class AiSelectionTool {
        static get isInline() { return true; }

        static get title() { return title; }

        static get shortcut() { return shortcut; }

        constructor({ api }) {
            this.api = api;
        }

        render() {
            const button = document.createElement("button");
            button.type = "button";
            button.classList.add(this.api.styles.inlineToolButton);
            button.innerHTML = icon;
            button.title = title;
            button.setAttribute("aria-label", title);
            return button;
        }

        surround(range) {
            const text = range ? range.toString().trim() : "";
            if (!text) return;
            onPick({ kind, text, range: range.cloneRange(), blockIndex: this.api.blocks.getCurrentBlockIndex() });
            this.api.inlineToolbar.close();
        }

        checkState() {
            return false;
        }
    };
}

/* "Improve with AI" always; "Turn into tasks" only where the editor knows a project to create in. */
export function createSelectionTools({ t, onPick, canSplit = false }) {
    const tools = {
        aiImprove: { class: inlineTool({ kind: "improve", title: t("AiSelection.improve"), icon: IMPROVE_ICON, shortcut: "CMD+SHIFT+Y", onPick }) }
    };
    if (canSplit) {
        tools.aiTasks = { class: inlineTool({ kind: "tasks", title: t("AiSelection.turn_into_tasks"), icon: TASKS_ICON, shortcut: "CMD+SHIFT+U", onPick }) };
    }
    return tools;
}
