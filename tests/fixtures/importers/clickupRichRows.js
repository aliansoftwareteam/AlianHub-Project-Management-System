/* Synthetic rows in the shape of ClickUp's CSV exports, every cell text as the dialog reads them. ClickUp's workspace export
 * carries the Comments, Checklists and Attachments columns and its view export the "<field> (<type>)" columns; one file here
 * holds both so each mapping has a row. Nothing in it came from a ClickUp account. */
const json = JSON.stringify;

const BLANK = {
    'Task ID': '', 'Task Name': '', 'Task Content': '', Status: 'to do', 'Parent ID': '', Assignees: '[]', Tags: '', Priority: '',
    'List Name': 'Roadmap', 'Folder Name': '', 'Space Name': 'Product', Attachments: '', Checklists: '', Comments: '',
    'Budget (currency)': '', 'Stage (drop down)': '', 'Areas (labels)': '', 'Approved (checkbox)': '', 'Contact (email)': '',
    'Phone (phone)': '', 'Spec (url)': '', 'Reviewers (users)': '', 'Score (rating)': '', 'Done so far (manual progress)': '',
    'Site (location)': '', 'Story Points (number)': '', 'Launch Date (date)': '', 'Client (short text)': '', 'Notes (text)': '',
    'Unused (number)': '',
};

const row = (cells) => ({ ...BLANK, ...cells });

module.exports = () => [
    row({
        'Task ID': 'c1',
        'Task Name': 'Plan the launch',
        'Task Content': 'Agree the date and the room',
        Assignees: '[max@member.test, lee@private.test, ghost@nowhere.test, Pat Example]',
        Tags: '[launch, urgent]',
        Attachments: json([
            { title: 'brief.pdf', url: 'https://files.clickup.test/t1/brief.pdf' },
            { title: '', url: 'https://files.clickup.test/t1/shot.png' },
            { title: 'script', url: 'javascript:alert(1)' },
        ]),
        Checklists: json({ 'Before launch': ['Book the room', 'Send invites'] }),
        Comments: json([
            { text: 'Room is booked', by: 'Pat Example', date: '2026-01-06T10:30:00.000Z' },
            { text: 'Kick-off is on Monday', by: 'max@member.test', date: '2026-01-05T09:00:00.000Z' },
        ]),
        'Budget (currency)': '$1,200.50',
        'Stage (drop down)': 'Discovery',
        'Areas (labels)': '[Web, Mobile]',
        'Approved (checkbox)': 'true',
        'Contact (email)': 'pat@client.test',
        'Phone (phone)': '+1 201 555 0123',
        'Spec (url)': 'https://example.test/spec',
        'Reviewers (users)': '[max@member.test, ghost@nowhere.test]',
        'Score (rating)': '4',
        'Done so far (manual progress)': '60',
        'Site (location)': '12 High Street',
        'Story Points (number)': '5',
        'Launch Date (date)': '1769904000000',
        'Client (short text)': 'Acme',
        'Notes (text)': 'Long notes about the launch',
    }),
    row({
        'Task ID': 'c2',
        'Task Name': 'Write the invite',
        'Parent ID': 'c1',
        Tags: '[launch]',
        Checklists: json([{ name: 'Copy', items: [{ name: 'Draft', resolved: true }, { name: 'Review', resolved: false }] }]),
        Comments: json([{ text: 'Draft is in the doc', by: { username: 'Max Member', email: 'MAX@member.test' }, date: 1767700800000 }]),
        'Budget (currency)': 'lots',
        'Stage (drop down)': 'Delivery',
        'Areas (labels)': '[Web]',
        'Approved (checkbox)': 'maybe',
        'Contact (email)': 'nobody',
        'Spec (url)': 'not a link',
        'Score (rating)': '12',
        'Done so far (manual progress)': 'half',
        'Story Points (number)': '3',
    }),
    row({
        'Task ID': 'c3',
        'Task Name': 'Proofread',
        'Parent ID': 'c2',
        Attachments: json([{ title: 'invite.docx', url: 'https://files.clickup.test/t3/invite.docx' }]),
        Comments: json([{ text: 'Two typos fixed', by: 'ghost@nowhere.test' }, { text: 'Ready to send' }]),
        'Stage (drop down)': 'Discovery',
        'Score (rating)': '7',
    }),
    row({
        'Task ID': 'c4',
        'Task Name': 'Archive the notes',
        'List Name': 'Wrap up',
        Tags: '[Launch, archive]',
        'Stage (drop down)': 'Closed',
        'Client (short text)': 'Globex',
    }),
];
