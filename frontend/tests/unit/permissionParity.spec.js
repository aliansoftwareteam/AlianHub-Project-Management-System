import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import fixture from '../../../tests/fixtures/permissionParity.json';
import { mutateArrangedRules, mutateArrangeProjectRules } from '@/store/Settings/mutations';

vi.mock('@/store/index', () => ({ default: { getters: {} } }));
vi.mock('@/services', () => ({ apiRequest: vi.fn() }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => key } } }));
vi.mock('@/utils/storageQueryBuild', () => ({ storageQueryBuilder: vi.fn() }));
vi.mock('@/composable/commonFunction', () => ({ isBundledPriorityImage: vi.fn() }));

// checkPermission logs every refusal it reaches through a missing rule.
vi.spyOn(console, 'error').mockImplementation(() => {});

const { useCustomComposable } = await import('@/composable');
const { checkPermission } = useCustomComposable();

const COMPANY_WIDE_PREFIX = 'settings.';

const gettersFor = (testCase) => {
    const clone = (rows) => JSON.parse(JSON.stringify(rows));
    const company = {};
    mutateArrangedRules(company, clone(testCase.companyRules));
    const project = { projectRules: [] };
    mutateArrangeProjectRules(project, { op: 'added', data: clone(testCase.projectRules) });
    return {
        'settings/companyUserDetail': testCase.role === null ? {} : { roleType: testCase.role },
        'settings/rules': company.rules,
        'settings/projectRules': project.projectRules,
    };
};

/* The web app passes project.isGlobalPermission wherever a project is open, and never passes it for a settings key. */
const webValue = (testCase) => {
    const options = { gettersVal: gettersFor(testCase) };
    if (!testCase.project || testCase.key.startsWith(COMPANY_WIDE_PREFIX)) return checkPermission(testCase.key, undefined, options);
    return checkPermission(testCase.key, testCase.project.isGlobalPermission, options);
};

describe('checkPermission over the shared permission fixture', () => {
    const agreed = fixture.cases.filter((testCase) => !testCase.knownDifference);
    const knownDifferences = fixture.cases.filter((testCase) => testCase.knownDifference);

    it.each(agreed.map((testCase) => [testCase.name, testCase]))('%s', (_, testCase) => {
        expect(webValue(testCase)).toBe(testCase.expected);
    });

    it.each(knownDifferences.map((testCase) => [testCase.name, testCase]))('known difference: %s', (_, testCase) => {
        expect(webValue(testCase)).toBe(testCase.knownDifference.web);
    });
});

describe('the call-site convention the parity harness relies on', () => {
    const sources = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return sources(full);
        return /\.(vue|js)$/.test(entry.name) ? [full] : [];
    });

    it('no settings key is checked against a project\'s own rules', () => {
        const projectScopedSettingsCheck = /checkPermission\(\s*['"`]settings\.[^'"`]+['"`]\s*,\s*(?!true\b|undefined\b)[^)\s]/;
        const offenders = sources(path.resolve(__dirname, '../../src'))
            .filter((file) => projectScopedSettingsCheck.test(fs.readFileSync(file, 'utf8')))
            .map((file) => path.relative(path.resolve(__dirname, '../..'), file));
        expect(offenders).toEqual([]);
    });
});
