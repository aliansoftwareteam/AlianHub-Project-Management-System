const CALLOUT_TONES = ['info', 'warn', 'ok', 'danger'];
const STATUS_TYPES = ['open', 'close', 'all'];
const TASK_LIST_LIMIT = 30;

const svg = (paths) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
const ICONS = {
    task: svg('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12.5 2.5 2.5 5-5"/>'),
    taskList: svg('<path d="M9 6h12M9 12h12M9 18h12"/><path d="m3 6 1 1 2-2M3 12l1 1 2-2M3 18l1 1 2-2"/>'),
    callout: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16v.5"/>'),
    image: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="m21 16-5-5-8 8"/>'),
    delimiter: svg('<path d="M4 12h16"/>'),
    quote: svg('<path d="M7 7h4v4H7zM13 7h4v4h-4z"/><path d="M11 11c0 3-1 4-4 5M17 11c0 3-1 4-4 5"/>'),
    open: svg('<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>'),
    check: svg('<path d="m5 12.5 4.5 4.5L19 8"/>'),
};

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
};

const escape = (value) => String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Editor.js handles keys at the redactor level; a tool's own inputs must own theirs.
const isolateKeys = (node) => {
    node.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && node.tagName === 'INPUT') event.preventDefault();
        event.stopPropagation();
    });
};

const avatarHtml = (ctx, userId) => {
    const user = userId ? ctx.userOf(userId) : null;
    if (!user) return '';
    const image = user.image ? `<img src="${escape(user.image)}" alt="">` : escape(user.initials);
    return `<span class="ah-avatar ah-avatar--sm" title="${escape(user.name)}">${image}</span>`;
};

const statusChipHtml = (ctx, task) => {
    const status = ctx.statusOf(task);
    if (!status || !status.name) return '';
    const style = status.bgColor && status.textColor ? ` style="background:${escape(status.bgColor)};color:${escape(status.textColor)}"` : '';
    const cls = status.bgColor ? 'ah-chip' : (status.type === 'close' ? 'ah-chip ah-chip--ok' : 'ah-chip');
    return `<span class="${cls} pb-task__status"${style}>${escape(status.name)}</span>`;
};

const isDone = (ctx, task) => {
    const status = ctx.statusOf(task);
    return Boolean(status && status.type === 'close');
};

const taskRowHtml = (ctx, task) => `
    <span class="pb-task__check${isDone(ctx, task) ? ' is-done' : ''}">${ICONS.check}</span>
    <span class="ah-chip ah-chip--mono pb-task__key">${escape(task.TaskKey)}</span>
    <button type="button" class="pb-task__open${isDone(ctx, task) ? ' is-done' : ''}" title="${escape(ctx.t('Docs.open_task'))}">${escape(task.TaskName)}</button>
    ${statusChipHtml(ctx, task)}
    ${avatarHtml(ctx, (task.AssigneeUserId || [])[0])}`;

const projectSelect = (ctx, selected) => {
    const select = el('select', 'ah-input pb-select');
    const blank = el('option', '', ctx.t('Docs.task_pick_project'));
    blank.value = '';
    select.appendChild(blank);
    ctx.projects().forEach((project) => {
        const option = el('option', '', project.ProjectName);
        option.value = String(project._id);
        if (String(project._id) === String(selected || '')) option.selected = true;
        select.appendChild(option);
    });
    isolateKeys(select);
    return select;
};

function makeCallout(ctx) {
    return class Callout {
        static get toolbox() { return { title: ctx.t('Docs.block_callout'), icon: ICONS.callout }; }
        static get isReadOnlySupported() { return true; }
        static get enableLineBreaks() { return true; }
        static get sanitize() { return { text: { b: true, i: true, a: { href: true }, br: true, code: true, mark: true } }; }

        constructor({ data, readOnly }) {
            this.readOnly = readOnly;
            this.data = { text: (data && data.text) || '', tone: CALLOUT_TONES.includes(data && data.tone) ? data.tone : 'warn' };
        }

        render() {
            this.wrapper = el('div', `pb-callout pb-callout--${this.data.tone}`);
            const icon = el('span', 'pb-callout__icon');
            icon.innerHTML = ICONS.callout;
            this.text = el('div', 'pb-callout__text');
            this.text.contentEditable = String(!this.readOnly);
            this.text.innerHTML = this.data.text;
            this.text.dataset.placeholder = ctx.t('Docs.callout_placeholder');
            this.wrapper.append(icon, this.text);
            if (!this.readOnly) {
                const tones = el('div', 'pb-callout__tones');
                CALLOUT_TONES.forEach((tone) => {
                    const swatch = el('button', `pb-callout__tone pb-callout__tone--${tone}`);
                    swatch.type = 'button';
                    swatch.title = tone;
                    swatch.addEventListener('click', () => {
                        this.data.tone = tone;
                        this.wrapper.className = `pb-callout pb-callout--${tone}`;
                    });
                    tones.appendChild(swatch);
                });
                this.wrapper.appendChild(tones);
            }
            return this.wrapper;
        }

        save() { return { text: this.text.innerHTML, tone: this.data.tone }; }
    };
}

function makeDelimiter(ctx) {
    return class Delimiter {
        static get toolbox() { return { title: ctx.t('Docs.block_delimiter'), icon: ICONS.delimiter }; }
        static get isReadOnlySupported() { return true; }
        static get contentless() { return true; }
        render() { return el('div', 'pb-delimiter'); }
        save() { return {}; }
    };
}

function makeQuote(ctx) {
    return class Quote {
        static get toolbox() { return { title: ctx.t('Docs.block_quote'), icon: ICONS.quote }; }
        static get isReadOnlySupported() { return true; }
        static get enableLineBreaks() { return true; }
        static get sanitize() { return { text: { b: true, i: true, a: { href: true }, br: true } }; }

        constructor({ data, readOnly }) {
            this.readOnly = readOnly;
            this.data = { text: (data && data.text) || '' };
        }

        render() {
            this.text = el('blockquote', 'pb-quote');
            this.text.contentEditable = String(!this.readOnly);
            this.text.innerHTML = this.data.text;
            this.text.dataset.placeholder = ctx.t('Docs.quote_placeholder');
            return this.text;
        }

        save() { return { text: this.text.innerHTML }; }
    };
}

function makeImage(ctx) {
    return class ImageByUrl {
        static get toolbox() { return { title: ctx.t('Docs.block_image'), icon: ICONS.image }; }
        static get isReadOnlySupported() { return true; }

        constructor({ data, readOnly }) {
            this.readOnly = readOnly;
            this.data = { url: (data && data.url) || '', caption: (data && data.caption) || '' };
        }

        render() {
            this.wrapper = el('figure', 'pb-image');
            if (this.data.url) this.renderImage(); else this.renderForm();
            return this.wrapper;
        }

        renderForm() {
            this.wrapper.innerHTML = '';
            if (this.readOnly) return;
            const form = el('div', 'pb-image__form');
            const input = el('input', 'ah-input');
            input.type = 'url';
            input.placeholder = ctx.t('Docs.image_url');
            isolateKeys(input);
            const commit = () => {
                const url = input.value.trim();
                if (!/^https?:\/\//i.test(url)) return;
                this.data.url = url;
                this.renderImage();
            };
            input.addEventListener('keydown', (event) => { if (event.key === 'Enter') commit(); });
            input.addEventListener('blur', commit);
            form.append(el('span', 'ah-label', ctx.t('Docs.block_image_hint')), input);
            this.wrapper.appendChild(form);
            setTimeout(() => input.focus(), 0);
        }

        renderImage() {
            this.wrapper.innerHTML = '';
            const img = el('img');
            img.src = this.data.url;
            img.alt = this.data.caption;
            this.caption = el('figcaption', 'pb-image__caption');
            this.caption.contentEditable = String(!this.readOnly);
            this.caption.textContent = this.data.caption;
            this.caption.dataset.placeholder = ctx.t('Docs.image_caption');
            this.wrapper.append(img, this.caption);
        }

        save() {
            return { url: this.data.url, caption: this.caption ? this.caption.textContent.trim() : this.data.caption };
        }
    };
}

function makeTask(ctx) {
    return class TaskBlock {
        static get toolbox() { return { title: ctx.t('Docs.block_task'), icon: ICONS.task }; }
        static get isReadOnlySupported() { return true; }

        constructor({ data, readOnly }) {
            this.readOnly = readOnly;
            this.data = { taskId: (data && data.taskId) || '', taskKey: (data && data.taskKey) || '', title: (data && data.title) || '' };
        }

        render() {
            this.wrapper = el('div', 'pb-task');
            if (this.data.taskId) this.renderTask();
            else if (!this.readOnly) this.renderPicker();
            return this.wrapper;
        }

        renderPicker() {
            this.wrapper.innerHTML = '';
            const box = el('div', 'pb-picker');
            const head = el('div', 'pb-picker__head');
            const select = projectSelect(ctx, ctx.defaultProjectId);
            head.append(el('span', 'ah-label', ctx.t('Docs.block_task')), select);
            const input = el('input', 'ah-input');
            input.type = 'text';
            input.placeholder = ctx.t('Docs.task_search');
            isolateKeys(input);
            const results = el('div', 'pb-picker__results');
            let timer = null;
            const search = () => {
                clearTimeout(timer);
                timer = setTimeout(() => this.search(input.value, select.value, results), 250);
            };
            input.addEventListener('input', search);
            select.addEventListener('change', search);
            box.append(head, input, results);
            this.wrapper.appendChild(box);
            setTimeout(() => input.focus(), 0);
        }

        async search(query, projectId, results) {
            results.innerHTML = '';
            if (!query.trim()) return;
            const list = await ctx.searchTasks(query, projectId);
            if (!list.length) {
                results.appendChild(el('div', 'pb-picker__empty', ctx.t('Docs.task_no_results')));
                return;
            }
            list.forEach((task) => {
                const row = el('button', 'pb-picker__row');
                row.type = 'button';
                row.innerHTML = `<span class="ah-chip ah-chip--mono">${escape(task.TaskKey)}</span><span class="pb-picker__name">${escape(task.TaskName)}</span>`;
                row.addEventListener('click', () => {
                    this.data = { taskId: String(task._id), taskKey: task.TaskKey || '', title: task.TaskName || '' };
                    this.renderTask(task);
                });
                results.appendChild(row);
            });
        }

        async renderTask(preloaded) {
            this.wrapper.innerHTML = '';
            const row = el('div', 'pb-task__row');
            row.innerHTML = `<span class="ah-chip ah-chip--mono pb-task__key">${escape(this.data.taskKey)}</span>`
                + `<span class="pb-task__open">${escape(this.data.title)}</span>`
                + `<span class="ah-small pb-task__meta">${escape(ctx.t('Docs.task_loading'))}</span>`;
            this.wrapper.appendChild(row);
            const task = preloaded || await ctx.fetchTask(this.data.taskId);
            if (!task) {
                row.classList.add('is-missing');
                row.querySelector('.pb-task__meta').textContent = ctx.t('Docs.task_missing');
                return;
            }
            this.data.taskKey = task.TaskKey || this.data.taskKey;
            this.data.title = task.TaskName || this.data.title;
            row.innerHTML = taskRowHtml(ctx, task);
            row.querySelector('.pb-task__open').addEventListener('click', () => ctx.openTask(task));
        }

        save() { return { ...this.data }; }
    };
}

function makeTaskList(ctx) {
    return class TaskListBlock {
        static get toolbox() { return { title: ctx.t('Docs.block_task_list'), icon: ICONS.taskList }; }
        static get isReadOnlySupported() { return true; }

        constructor({ data, readOnly }) {
            this.readOnly = readOnly;
            this.data = {
                projectId: (data && data.projectId) || '',
                projectName: (data && data.projectName) || '',
                statusType: STATUS_TYPES.includes(data && data.statusType) ? data.statusType : 'open',
            };
        }

        render() {
            this.wrapper = el('div', 'pb-tasklist');
            if (this.data.projectId) this.renderList();
            else if (!this.readOnly) this.renderPicker();
            return this.wrapper;
        }

        renderPicker() {
            this.wrapper.innerHTML = '';
            const box = el('div', 'pb-picker');
            const head = el('div', 'pb-picker__head');
            const select = projectSelect(ctx, ctx.defaultProjectId);
            head.append(el('span', 'ah-label', ctx.t('Docs.block_task_list')), select);
            box.append(head, el('div', 'ah-small', ctx.t('Docs.block_task_list_hint')));
            select.addEventListener('change', () => {
                if (!select.value) return;
                this.data.projectId = select.value;
                this.data.projectName = select.options[select.selectedIndex].text;
                this.renderList();
            });
            this.wrapper.appendChild(box);
        }

        statusSelect() {
            const select = el('select', 'pb-tasklist__filter');
            STATUS_TYPES.forEach((type) => {
                const option = el('option', '', ctx.t(`Docs.task_list_status_${type}`));
                option.value = type;
                option.selected = type === this.data.statusType;
                select.appendChild(option);
            });
            isolateKeys(select);
            select.addEventListener('change', () => {
                this.data.statusType = select.value;
                this.renderList();
            });
            return select;
        }

        async renderList() {
            this.wrapper.innerHTML = '';
            const head = el('div', 'pb-tasklist__head');
            head.append(el('span', 'ah-label', ctx.t('Docs.block_task_list')));
            const project = el('span', 'pb-tasklist__project', this.data.projectName);
            const count = el('span', 'ah-label pb-tasklist__count');
            head.append(project, count);
            if (this.readOnly) {
                head.appendChild(el('span', 'ah-chip', ctx.t(`Docs.task_list_status_${this.data.statusType}`)));
            } else {
                head.appendChild(this.statusSelect());
            }
            const rows = el('div', 'pb-tasklist__rows');
            rows.appendChild(el('div', 'ah-small', ctx.t('Docs.task_loading')));
            this.wrapper.append(head, rows);

            const tasks = await ctx.fetchTasks(this.data.projectId, this.data.statusType);
            rows.innerHTML = '';
            count.textContent = ctx.t('Docs.task_list_count', { n: tasks.length });
            if (!tasks.length) {
                rows.appendChild(el('div', 'ah-small pb-tasklist__empty', ctx.t('Docs.task_list_empty')));
                return;
            }
            tasks.forEach((task) => {
                const row = el('div', 'pb-task__row');
                row.innerHTML = taskRowHtml(ctx, task);
                row.querySelector('.pb-task__open').addEventListener('click', () => ctx.openTask(task));
                rows.appendChild(row);
            });
        }

        save() { return { ...this.data }; }
    };
}

export function createBlockTools(ctx) {
    return {
        callout: { class: makeCallout(ctx) },
        quote: { class: makeQuote(ctx) },
        delimiter: { class: makeDelimiter(ctx) },
        image: { class: makeImage(ctx) },
        task: { class: makeTask(ctx) },
        taskList: { class: makeTaskList(ctx) },
    };
}

export { TASK_LIST_LIMIT, STATUS_TYPES };
