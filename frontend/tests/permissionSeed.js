import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/* utils/data.js requires half the backend, so the catalogue's literal declarations are evaluated
   straight from the source: the block from `let rules = [` up to the first branch on `type`. */
export const seed = (() => {
    const source = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../utils/data.js'), 'utf8');
    const from = source.indexOf('let rules = [', source.indexOf('exports.importCompanyRules'));
    const declarations = source.slice(from, source.indexOf("if(type === 'project')", from));
    const names = [...declarations.matchAll(/^\s*let\s+(\w+)\s*=/gm)].map((match) => match[1]);
    return new Function(`${declarations}\nreturn { ${names.join(', ')} };`)();
})();

export const SEEDED_KEYS = Object.values(seed).filter(Array.isArray).flat().map((rule) => rule.key);

// The parentId each forEach in importCompanyRules gives its array.
export const CHILDREN_OF = { project: 'subProjectRules', task: 'taskRules', settings: 'settingRules', sheet_settings: 'sheet_settings', artificial_intelligence: 'aiRules', chat: 'chat_settings' };

export const seededBody = () => seed.rules.flatMap((parent) => [
    { ...parent, _id: parent.key, roles: [] },
    ...seed[CHILDREN_OF[parent.key]].map((rule, index) => ({ ...seed.obj, ...rule, _id: rule.key, parentId: parent.key, priorityIndex: index, roles: [] }))
]);
