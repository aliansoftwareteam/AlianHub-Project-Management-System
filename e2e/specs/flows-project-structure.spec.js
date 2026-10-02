const { test, expect, asRole } = require('../support/test');
const { createFolder, createList, createProject, listFolders, listSprints, uniqueSuffix } = require('../support/fixtures');
const { skipFirstRun } = require('../support/pages');

const idOf = (doc) => String(doc._id || doc.id);
const nameOf = (doc) => doc.name || doc.folderName;

async function newProject(loginAs, label) {
    const owner = await loginAs('owner');
    const suffix = uniqueSuffix();
    const project = await createProject(owner.api, { name: `${label} ${suffix}`, assigneeIds: [owner.uid], createdBy: owner.uid });
    return { owner, project, suffix };
}

async function chooseNew(page, item) {
    await page.getByRole('button', { name: '+ New', exact: true }).click();
    await page.getByRole('menuitem', { name: item, exact: true }).click();
}

test.describe('lists and folders in a project', () => {
    test.use(asRole('owner'));
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    test('New list, New folder and New subfolder each create what they name', async ({ page, state, loginAs }) => {
        const { owner, project, suffix } = await newProject(loginAs, 'Structure');
        const listName = `Made list ${suffix}`;
        const folderName = `Made folder ${suffix}`;
        const subfolderName = `Made subfolder ${suffix}`;

        await page.goto(`/#/${state.companyId}/project/${project._id}`);
        await chooseNew(page, 'New list');
        await page.getByPlaceholder(/^Enter (sprint|list) name$/).fill(listName);
        await page.getByPlaceholder(/^Enter (sprint|list) name$/).press('Enter');
        await expect.poll(async () => (await listSprints(owner.api, project._id)).map(nameOf)).toContain(listName);

        await chooseNew(page, 'New folder');
        await page.getByPlaceholder(/^Enter (directory|folder) name$/).fill(folderName);
        await page.getByPlaceholder(/^Enter (directory|folder) name$/).press('Enter');
        let folder;
        await expect.poll(async () => {
            folder = (await listFolders(owner.api, project._id)).find((doc) => nameOf(doc) === folderName);
            return Boolean(folder);
        }).toBe(true);

        await page.goto(`/#/${state.companyId}/project/${project._id}/f/${idOf(folder)}`);
        await chooseNew(page, 'New subfolder');
        await page.getByPlaceholder(/^Enter (directory|folder) name$/).fill(subfolderName);
        await page.getByPlaceholder(/^Enter (directory|folder) name$/).press('Enter');
        await expect.poll(async () => {
            const sub = (await listFolders(owner.api, project._id)).find((doc) => nameOf(doc) === subfolderName);
            return sub ? String(sub.parentFolderId) : '';
        }).toBe(idOf(folder));
    });

    test('Move to folder in a list\'s own menu puts the list in that folder', async ({ page, state, loginAs }) => {
        const { owner, project, suffix } = await newProject(loginAs, 'Move list');
        const folder = await createFolder(owner.api, { project, name: `Home folder ${suffix}`, user: owner });
        const list = await createList(owner.api, { project, name: `Wandering list ${suffix}`, user: owner });

        await page.goto(`/#/${state.companyId}/project/${project._id}/s/${list._id}`);
        await page.getByRole('button', { name: `Actions for ${list.name}` }).first().click();
        await page.getByRole('menu', { name: `Actions for ${list.name}` }).getByRole('menuitem', { name: 'Move to folder…', exact: true }).click();
        await page.getByRole('dialog').getByRole('button', { name: folder.name, exact: true }).click();

        await expect.poll(async () => {
            const moved = (await listSprints(owner.api, project._id)).find((doc) => idOf(doc) === list._id);
            return moved && moved.folderId ? String(moved.folderId) : '';
        }).toBe(folder._id);
    });
});

test.describe('duplicating a project', () => {
    test.use(asRole('owner'));
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    test('Duplicate project in the row menu makes a copy and opens it', async ({ page, state, loginAs }) => {
        const { project, suffix } = await newProject(loginAs, 'Original');
        const copyName = `Duplicated ${suffix}`;

        await page.goto(`/#/${state.companyId}/project`);
        const row = page.getByRole('button').filter({ hasText: project.ProjectName }).filter({ has: page.getByRole('button', { name: 'Project actions' }) });
        await row.getByRole('button', { name: 'Project actions' }).click();
        await page.getByRole('button', { name: 'Duplicate project', exact: true }).click();

        const dialog = page.getByRole('dialog', { name: 'Duplicate project' });
        await dialog.getByRole('textbox', { name: 'Name of the copy' }).fill(copyName);
        await dialog.getByRole('button', { name: 'Duplicate', exact: true }).click();

        await expect(page).toHaveURL(new RegExp(`/project/(?!${project._id})[0-9a-f]{24}`));
        await page.goto(`/#/${state.companyId}/project`);
        await expect(page.getByRole('button', { name: new RegExp(`^${copyName}`) })).toBeVisible();
        await expect(page.getByRole('button', { name: new RegExp(`^${project.ProjectName}`) })).toBeVisible();
    });
});
