const { fileFieldProposal } = require('./stage');

const CHAPTER_CARD_MS = 3000;
/* Viewers need longer than a person clicking does to read each screen. */
const READING = 1.8;
const hold = (ms) => new Promise((resolve) => setTimeout(resolve, ms * READING));

/* The how-to video: one chapter per everyday job, each opened by a title card. */
async function howTo(d, world) {
    const { page } = d;
    const hbr = world.project._id;
    const [, , build, launch] = world.lists;

    const chapter = async (number, title, sub) => {
        d.mark(`chapter-${number}`);
        await d.caption('');
        await d.card({ kicker: `Chapter ${number}`, title, sub });
        d.cues.push({ start: d.t(), end: null, text: `Chapter ${number}: ${title}`, sub: '' });
        await new Promise((resolve) => setTimeout(resolve, CHAPTER_CARD_MS));
        d.endCue();
        await d.card({});
        await hold(400);
    };

    d.begin();
    d.mark('intro');
    await d.card({ logo: true, title: 'How to use AlianHub', sub: 'A short tour of a made-up studio workspace, Northwind Studio' });
    d.cues.push({ start: 0, end: null, text: 'How to use AlianHub', sub: '' });
    await hold(3200);
    d.endCue();
    await d.card({});
    await d.caption('Home shows what is due today, your agenda and a standup written from your activity');
    await d.point(page.getByText('Today & Overdue', { exact: true }).first(), 800);
    await hold(1200);
    await d.point(page.getByText('Client sign-off on homepage design').first(), 800);
    await hold(1500);
    await d.point(page.getByText('Your standup').first(), 800);
    await hold(2000);

    await chapter(1, 'Create a project', 'Start blank, from a template, or from a description');
    await d.caption('Open Projects, then New project');
    await d.click(page.locator('.ah-app').getByText('Projects', { exact: true }).first());
    await d.settle(400, 3000);
    await d.click(page.getByRole('button', { name: 'New project' }));
    await hold(1200);
    await d.caption('Pick Blank, give it a name, and create it');
    await d.click(page.getByRole('dialog').getByRole('button', { name: /^Blank/ }).first());
    await d.click(page.getByPlaceholder('Enter Project Name'));
    await d.type('Brand refresh');
    await hold(700);
    await d.click(page.getByRole('button', { name: 'Create project' }));
    await d.settle(500, 6000);
    await d.caption('The project opens with a first list, ready for tasks');
    await hold(2600);

    await chapter(2, 'Add, assign and prioritise tasks', 'Everything happens in the list itself');
    await d.caption('In a list, add a task where it belongs');
    await d.go(`/project/${hbr}/s/${launch._id}?tab=ProjectListView`);
    await hold(800);
    await d.click(page.locator('button.lv2__add').first());
    await d.type('Book the launch-day photographer');
    await d.caption('Pick who does it');
    await d.click(page.locator('button.assignee__add-btn').first());
    await hold(600);
    await d.click(page.getByRole('option').filter({ hasText: 'Kenji Tanaka' }).first(), { pause: 500 });
    await page.keyboard.press('Escape');
    await d.caption('Set how urgent it is, then save');
    await d.click(page.locator('img.priority__image').first(), { pause: 600 });
    await d.click(page.getByText('High', { exact: true }).last(), { pause: 500 });
    await d.click(page.locator('button.save__btn-primary').first());
    await hold(800);
    await page.keyboard.press('Escape');
    await d.point(page.getByText('Book the launch-day photographer').first(), 700);
    await d.caption('It lands in the list with its owner, due dates and status alongside the rest');
    await hold(2600);

    await chapter(3, 'Board and Gantt', 'The same tasks, seen the way you need');
    await d.caption('Board: drag cards between statuses');
    await d.go(`/project/${hbr}/s/${build._id}?tab=ProjectKanban`);
    await d.moveTo(560, 300, 800);
    await hold(800);
    await d.point(page.getByText('Build pricing page').first(), 900);
    await hold(2200);
    await d.caption('Gantt: every task on a timeline, with the critical path one click away');
    await d.go(`/project/${hbr}/s/${build._id}?tab=GanttView`);
    await d.moveTo(900, 250, 900);
    await hold(1000);
    await d.point(page.getByRole('button', { name: 'Critical path' }).first(), 900);
    await hold(2400);

    await chapter(4, 'Comment and @mention', 'Talk about the work where the work is');
    const pricing = world.tasks.find((task) => task.name === 'Build pricing page');
    await d.caption('Open a task to see its whole conversation');
    await d.go(`/project/${hbr}/s/${pricing.sprintId}/${pricing._id}?tab=ProjectListView`);
    await hold(1500);
    await d.scroll(page.getByText('ACTIVITY').first(), 700);
    await hold(1500);
    await d.caption('Type @ and a name to bring someone in. They get notified', '', { top: true });
    const box = page.getByPlaceholder('Type here').last();
    await d.click(box);
    await d.type('Looks great! @Dieg');
    await hold(900);
    await d.click(page.getByText('Diego Alvarez', { exact: true }).last(), { pause: 300 });
    await d.type('can you check the plan table on mobile before Friday?');
    await hold(500);
    await d.click(box.locator('xpath=ancestor::*[3]').locator('button').last());
    await hold(2600);

    await chapter(5, 'Log time and submit your week', 'Timesheets fill in as you go');
    await d.caption('Log time against a task from your timesheet');
    await d.go('/timesheet/user');
    await hold(1200);
    await d.click(page.getByRole('button', { name: 'Log time' }));
    await d.click(page.getByText('Pick a task').first());
    await d.type('launch week');
    await hold(600);
    await d.click(page.getByText('Plan launch week with the client').last());
    await d.click(page.getByRole('button', { name: '+1h' }));
    await d.click(page.getByRole('button', { name: '+30m' }));
    await d.click(page.getByPlaceholder('What did you work on?'));
    await d.type('Launch week agenda with the client');
    await d.click(page.getByRole('button', { name: /^Log 1:30/ }));
    await hold(1200);
    await d.click(page.getByRole('button', { name: 'Close' }).last());
    await d.caption('At the end of the week, submit it for approval');
    await hold(1200);
    await d.click(page.getByRole('button', { name: 'Submit week' }));
    await hold(2800);

    await chapter(6, 'Connect your AI', 'Claude or ChatGPT, working inside your workspace');
    await d.caption('Paste one address into Claude or ChatGPT. It sees and changes only what you can');
    await d.go('/ai/connect');
    await d.point(page.getByText('Claude', { exact: true }).first(), 900);
    await hold(1500);
    await d.point(page.getByText('ChatGPT', { exact: true }).first(), 900);
    await hold(1500);
    await d.point(page.getByText('What your AI can do here').first(), 900);
    await hold(2500);

    await chapter(7, 'Approve an AI proposal', 'Nothing an AI asks for happens until you say so');
    await fileFieldProposal(world, {
        project: world.project, what: 'Add a Client contact field', why: 'Three tasks this week mention who signs off at Harbor & Co.; a field keeps it in one place.', fields: [{ name: 'Client contact', type: 'text' }],
    });
    await d.caption('Your AI\'s requests wait in the AI Inbox', '(example)');
    await d.go('/ai/inbox');
    await d.click(page.getByText('Add a Client contact field').first(), { pause: 1800 });
    await d.caption('Read what changes and why, then approve. Undo is one click away', '(example)');
    await d.toasts(true);
    await d.click(page.getByRole('button', { name: 'Approve', exact: true }), { pause: 1500 });
    await d.point(page.getByText('Undo', { exact: true }).first(), 700);
    await hold(1200);
    await d.click(page.getByText('Open it', { exact: true }), { pause: 300 });
    await d.settle(400, 4000);
    await d.toasts(false);
    await hold(1800);

    await chapter(8, 'Dashboards', 'The numbers that matter, at a glance');
    await d.caption('Build a dashboard from cards: status, due soon, capacity, pulse');
    await d.go(`/dashboards/${world.dashboardId}`);
    await d.moveTo(420, 300, 900);
    await hold(1500);
    await d.moveTo(1050, 300, 900);
    await hold(1500);
    await d.moveTo(700, 650, 900);
    await hold(2000);

    d.mark('end');
    await d.caption('');
    await d.card({ logo: true, title: 'AlianHub', sub: 'Open source · Self-hosted · demo.alianhub.com' });
    d.cues.push({ start: d.t(), end: null, text: 'AlianHub', sub: 'Open source · Self-hosted · demo.alianhub.com' });
    await hold(3500);
}

module.exports = { scene: howTo, POSTER_AT: 1.5 };
