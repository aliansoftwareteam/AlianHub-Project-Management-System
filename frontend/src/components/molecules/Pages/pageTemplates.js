const header = (text, level = 2) => ({ type: 'header', data: { text, level } });
const paragraph = (text) => ({ type: 'paragraph', data: { text } });
const bullets = (items) => ({ type: 'list', data: { style: 'unordered', items: items.map((content) => ({ content, items: [] })) } });
const checklist = (items) => ({ type: 'checklist', data: { items: items.map((text) => ({ text, checked: false })) } });
const callout = (text, tone = 'warn') => ({ type: 'callout', data: { text, tone } });

export default [
    {
        key: 'spec',
        label: 'Docs.template_spec',
        hint: 'Docs.template_spec_hint',
        icon: 'file',
        blocks: [
            paragraph('What changes for the person using it, in one paragraph.'),
            header('Acceptance criteria'),
            checklist(['', '', '']),
            header('Open questions'),
            callout('<b>Open decision.</b> What is still undecided, and who decides.'),
            header('Out of scope'),
            bullets(['']),
        ],
    },
    {
        key: 'retro',
        label: 'Docs.template_retro',
        hint: 'Docs.template_retro_hint',
        icon: 'checkSquare',
        blocks: [
            header('Went well'),
            bullets(['']),
            header("Didn't"),
            bullets(['']),
            header('Try next'),
            checklist(['']),
        ],
    },
    {
        key: 'runbook',
        label: 'Docs.template_runbook',
        hint: 'Docs.template_runbook_hint',
        icon: 'book',
        wiki: true,
        blocks: [
            header('When to use this'),
            paragraph(''),
            header('Steps'),
            { type: 'list', data: { style: 'ordered', items: [{ content: '', items: [] }] } },
            header('Rollback'),
            paragraph(''),
            header('Contacts'),
            bullets(['']),
        ],
    },
    {
        key: 'meeting',
        label: 'Docs.template_meeting',
        hint: 'Docs.template_meeting_hint',
        icon: 'calendar',
        blocks: [
            paragraph('<b>Attendees</b> — '),
            header('Decisions'),
            bullets(['']),
            header('Actions'),
            checklist(['']),
        ],
    },
    {
        key: 'release',
        label: 'Docs.template_release',
        hint: 'Docs.template_release_hint',
        icon: 'play',
        blocks: [
            header('What shipped'),
            bullets(['']),
            header('What changed'),
            bullets(['']),
            header('What to watch'),
            callout('Anything that needs eyes in the first 48 hours.', 'info'),
        ],
    },
];
