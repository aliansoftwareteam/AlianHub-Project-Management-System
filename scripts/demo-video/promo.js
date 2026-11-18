const { projectNamed, taskNamed, fileFieldProposal, playPullRequest } = require('./stage');

const BRIEF = 'Website relaunch for a client: design, build, launch in 6 weeks';
const AI = '(example)';

/* The 60-second promo. Each scene ends at its mark on the clock, so the cut lands on time however fast the app answers. */
async function promo(d, world) {
    const { page } = d;
    const dialog = page.getByRole('dialog').filter({ hasText: 'Create project with AI' });

    d.begin();
    d.mark('hook');
    await d.caption('Your team and your AI, running the work together');
    await d.moveTo(560, 420, 700);
    await d.point(page.getByText('Today & Overdue', { exact: true }).first(), 700);
    await d.hold(500);
    await d.point(page.getByText('Client sign-off on homepage design').first(), 800);
    await d.until(4.4);

    d.mark('brief');
    await d.caption('Describe the project in plain words', AI);
    await d.click(page.locator('.ah-app').getByText('Projects', { exact: true }).first(), { pause: 80, duration: 380 });
    await d.settle(250, 2500);
    await d.click(page.getByRole('button', { name: 'Create with AI' }), { pause: 150, duration: 400 });
    await d.click(dialog.locator('textarea').first(), { pause: 40, duration: 350 });
    await d.type(BRIEF);
    await d.click(dialog.locator('.source-select button.dropdown-trigger'), { pause: 120, duration: 300 });
    await d.click(page.locator('.source-select__option', { hasText: 'Other' }), { pause: 80, duration: 250 });
    await d.click(dialog.getByRole('button', { name: /^Continue/ }), { pause: 100, duration: 400 });
    const moved = dialog.getByText(/Analyzing your brief|Is the content moving over/).first();
    if (!await moved.waitFor({ state: 'visible', timeout: 800 }).then(() => true, () => false)) {
        await d.click(dialog.getByRole('button', { name: /^Continue/ }), { pause: 100, duration: 200 });
    }
    for (const last of [false, false, true]) {
        const next = dialog.getByRole('button', { name: last ? /^Continue/ : /^Next/ });
        await next.waitFor({ state: 'visible', timeout: 20000 });
        await d.hold(300);
        await d.click(next, { pause: 80, duration: 300 });
    }

    d.mark('plan');
    await d.caption('AI drafts the whole plan. You pick what stays', AI);
    await d.click(dialog.getByRole('button', { name: 'Approve brief' }), { pause: 150, duration: 500 });
    await d.click(dialog.getByRole('button', { name: 'Generate plan' }), { pause: 150, duration: 400 });
    await dialog.getByText('Untick anything you do not want').waitFor({ state: 'visible', timeout: 30000 });
    await d.hold(900);
    await d.scroll(dialog.getByText('New lists').first(), 380, { steps: 18, pause: 40 });
    await d.hold(700);
    await d.scroll(null, 420, { steps: 18, pause: 40 });
    await d.hold(500);
    const view = dialog.getByRole('checkbox', { name: /Due this week/ }).first();
    await d.click(view, { pause: 600, duration: 600 });
    await d.scroll(null, 260, { steps: 12, pause: 40 });
    await d.until(26.8);

    d.mark('build');
    await d.caption('Every AI change waits for your OK, and can be undone', AI);
    await d.click(dialog.getByRole('button', { name: /Create everything/ }), { pause: 200, duration: 600 });
    await dialog.getByText('All done!').waitFor({ state: 'visible', timeout: 30000 });
    await d.hold(1200);
    const made = await projectNamed(world.companyId, 'Website relaunch');
    world.relaunch = made;
    await fileFieldProposal(world, {
        project: made, what: 'Add a Budget field', why: 'The client wants spend tracked per page, and this project has no money field yet.', fields: [{ name: 'Budget', type: 'money' }],
    });
    await d.click(dialog.getByRole('button', { name: /Open project/ }), { pause: 200, duration: 500 });
    await d.go('/ai/inbox');
    await d.click(page.getByText('Add a Budget field').first(), { pause: 900, duration: 600 });
    await d.toasts(true);
    await d.click(page.getByRole('button', { name: 'Approve', exact: true }), { pause: 700, duration: 600 });
    await d.click(page.getByText('Open it', { exact: true }), { pause: 300, duration: 600 });
    await d.settle(400, 4000);
    await d.toasts(false);
    await d.until(37.6);

    d.mark('pull-request');
    await d.caption('Pull requests link to tasks by themselves');
    const task = await taskNamed(world.companyId, made._id, 'Build pricing page');
    await d.go(`/project/${made._id}/s/${task.sprintId}/${task._id}?tab=ProjectListView`);
    await d.hold(400);
    await playPullRequest(world, { project: made, task, number: 42, merged: false });
    await d.reload();
    await d.point(page.getByText(/PR #42/).first(), 600);
    await d.hold(1000);
    await playPullRequest(world, { project: made, task, number: 42, merged: true });
    await d.reload();
    await d.point(page.getByText(/was merged/).first(), 600);
    await d.hold(500);
    await d.point(page.getByText('In Review').first(), 500);
    await d.until(49.6);

    d.mark('tour');
    await d.caption('One workspace for every team');
    const build = world.lists[2];
    await d.go(`/project/${world.project._id}/s/${build._id}?tab=ProjectKanban`, { limitMs: 800 });
    await d.moveTo(700, 380, 450);
    await d.until(Math.max(51.6, d.t() + 0.5));
    await d.go(`/project/${world.project._id}/s/${build._id}?tab=GanttView`, { limitMs: 800 });
    await d.moveTo(980, 260, 450);
    await d.until(Math.max(53.4, d.t() + 0.5));
    await d.go('/timesheet/user', { limitMs: 800 });
    await d.moveTo(760, 140, 450);
    await d.until(Math.max(55.2, d.t() + 0.5));
    await d.go('/ai/team-packs', { limitMs: 800 });
    await d.moveTo(520, 520, 450);
    await d.until(Math.max(56.8, d.t() + 0.5));

    d.mark('end');
    await d.caption('');
    await d.card({ logo: true, title: 'AlianHub', sub: 'Open source · Self-hosted · demo.alianhub.com' });
    d.cues.push({ start: d.t(), end: null, text: 'AlianHub', sub: 'Open source · Self-hosted · demo.alianhub.com' });
    await d.until(Math.max(60, d.t() + 3));
}

module.exports = { scene: promo, POSTER_AT: 20.5 };
