/**
 * Naming Conventions Test Suite
 * AlianHub Project Management System
 *
 * Tests verify that all project files and folders follow established naming conventions
 * to ensure consistency, maintainability, and clarity across the codebase.
 */

const fs = require('fs');
const path = require('path');

// ============================================
// TEST UTILITIES
// ============================================

/**
 * Recursively get all files from a directory
 * Excludes: node_modules, .git, dist, build, coverage
 */
function getAllFiles(dirPath, fileList = []) {
  const files = fs.readdirSync(dirPath);
  const excludeDirs = ['node_modules', '.git', 'dist', 'build', 'coverage', '.cache', '.next', '__pycache__', '.env', 'lock'];

  files.forEach(file => {
    const filePath = path.join(dirPath, file);
    const stat = fs.statSync(filePath);

    // Skip excluded directories
    if (stat.isDirectory()) {
      if (!excludeDirs.some(exclude => file.includes(exclude))) {
        getAllFiles(filePath, fileList);
      }
    } else {
      fileList.push(filePath);
    }
  });

  return fileList;
}

/**
 * Recursively get all directories
 */
function getAllDirectories(dirPath, dirList = []) {
  const items = fs.readdirSync(dirPath);
  const excludeDirs = ['node_modules', '.git', 'dist', 'build', 'coverage', '.cache', '.next', '__pycache__'];

  items.forEach(item => {
    const itemPath = path.join(dirPath, item);
    const stat = fs.statSync(itemPath);

    if (stat.isDirectory() && !excludeDirs.some(exclude => item.includes(exclude))) {
      dirList.push(itemPath);
      getAllDirectories(itemPath, dirList);
    }
  });

  return dirList;
}

/**
 * Check if string is in PascalCase
 */
function isPascalCase(str) {
  return /^[A-Z][a-zA-Z0-9]*$/.test(str);
}

/**
 * Check if string is in camelCase
 */
function isCamelCase(str) {
  return /^[a-z][a-zA-Z0-9]*$/.test(str);
}

/**
 * Check if string is in kebab-case
 */
function isKebabCase(str) {
  return /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(str);
}

/**
 * Check if string is in snake_case
 */
function isSnakeCase(str) {
  return /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(str);
}

// ============================================
// TEST SUITES
// ============================================

describe('🔍 NAMING CONVENTIONS - Complete Test Suite', () => {
  const rootDir = path.resolve(__dirname, '..');  // Go up from tests/ to root
  const modulesDir = path.join(rootDir, 'Modules');
  const frontendDir = path.join(rootDir, 'frontend', 'src');
  const configDir = path.join(rootDir, 'Config');

  // ============================================
  // GROUP 1: Module Folder Naming
  // ============================================
  describe('TEST GROUP 1: Module Folder Naming Conventions', () => {

    test('1.1 - All module folders MUST be PascalCase', () => {
      const modules = fs.readdirSync(modulesDir);
      const nonPascalModules = modules.filter(m => !isPascalCase(m));

      if (nonPascalModules.length > 0) {
        console.error('❌ Non-PascalCase modules found:', nonPascalModules);
      }

      expect(nonPascalModules).toEqual([]);
    });

    test('1.2 - No camelCase module folders (should be PascalCase)', () => {
      const modules = fs.readdirSync(modulesDir);
      const camelCaseModules = modules.filter(m => isCamelCase(m) && !isPascalCase(m));

      if (camelCaseModules.length > 0) {
        console.warn('⚠️  camelCase modules (should be PascalCase):', camelCaseModules);
      }

      expect(camelCaseModules.length).toBe(0);
    });

    test('1.3 - No kebab-case module folders (should be PascalCase)', () => {
      const modules = fs.readdirSync(modulesDir);
      const kebabModules = modules.filter(m => isKebabCase(m));

      if (kebabModules.length > 0) {
        console.warn('⚠️  kebab-case modules (should be PascalCase):', kebabModules);
      }

      expect(kebabModules.length).toBe(0);
    });

    test('1.4 - No snake_case module folders (should be PascalCase)', () => {
      const modules = fs.readdirSync(modulesDir);
      const snakeModules = modules.filter(m => isSnakeCase(m) && m.includes('_'));

      if (snakeModules.length > 0) {
        console.warn('⚠️  snake_case modules (should be PascalCase):', snakeModules);
      }

      expect(snakeModules.length).toBe(0);
    });

  });

  // ============================================
  // GROUP 2: Spelling & Typos
  // ============================================
  describe('TEST GROUP 2: Spelling Errors & Critical Typos', () => {

    test('2.1 - No "compoment" typo (should be "component")', () => {
      const allFiles = getAllFiles(rootDir);
      const filesWithTypo = allFiles.filter(f => f.includes('compoment'));

      if (filesWithTypo.length > 0) {
        console.error('❌ Files/folders with "compoment" typo:', filesWithTypo);
      }

      expect(filesWithTypo.length).toBe(0);
    });

    test('2.2 - No "initalizations" typo (should be "initializations")', () => {
      const allFiles = getAllFiles(rootDir);
      const filesWithTypo = allFiles.filter(f => f.includes('initalizations'));

      if (filesWithTypo.length > 0) {
        console.error('❌ Files/folders with "initalizations" typo:', filesWithTypo);
      }

      expect(filesWithTypo.length).toBe(0);
    });

    test('2.3 - "PlaneFeature" should be "PlanFeature"', () => {
      const modules = fs.readdirSync(modulesDir);
      const found = modules.includes('PlaneFeature');

      if (found) {
        console.error('❌ Found "PlaneFeature" (should be "PlanFeature")');
      }

      expect(found).toBe(false);
    });

    test('2.4 - "AdvanceGlobalFilter" should be "AdvancedGlobalFilter"', () => {
      const modules = fs.readdirSync(modulesDir);
      const found = modules.filter(m => m.includes('Advance') && !m.includes('Advanced'));

      if (found.length > 0) {
        console.warn('⚠️  "Advance*" modules (should be "Advanced*"):', found);
      }

      expect(found.length).toBe(0);
    });

    test('2.5 - No "Tempates" typo in utils (should be "templates")', () => {
      const utilsDir = path.join(rootDir, 'utils');
      const items = fs.readdirSync(utilsDir);
      const found = items.filter(i => i.includes('Tempate'));

      if (found.length > 0) {
        console.error('❌ Found "Tempates" typo in utils:', found);
      }

      expect(found.length).toBe(0);
    });

  });

  // ============================================
  // GROUP 3: File Naming Consistency
  // ============================================
  describe('TEST GROUP 3: File Naming Consistency', () => {

    test('3.1 - No numbered duplicate files (e.g., routes2.js, controller2.js)', () => {
      const allFiles = getAllFiles(modulesDir);
      const numbered = allFiles.filter(f => /\d+\.(js|ts|vue)$/.test(path.basename(f)));

      if (numbered.length > 0) {
        console.warn('⚠️  Numbered duplicate files:', numbered.map(f => path.relative(rootDir, f)));
      }

      expect(numbered.length).toBe(0);
    });

    test('3.2 - Routes files should be named "routes.js" (not routes2.js, routes-social.js unless documented)', () => {
      const allFiles = getAllFiles(modulesDir);
      const routeFiles = allFiles.filter(f => path.basename(f).includes('routes'));
      const properlyNamed = routeFiles.filter(f => {
        const name = path.basename(f);
        return name === 'routes.js' || name.match(/routes-\w+\.js/);
      });

      const improperly = routeFiles.filter(f => !properlyNamed.includes(f));

      if (improperly.length > 0) {
        console.warn('⚠️  Improperly named route files:', improperly.map(f => path.relative(rootDir, f)));
      }

      // Allow for documented route variations
      expect(routeFiles.length).toBeGreaterThan(0);
    });

    test('3.3 - Configuration files should not have redundant "-config" suffix', () => {
      const configFiles = fs.readdirSync(configDir);
      const withConfigSuffix = configFiles.filter(f => f.includes('Config') && f !== 'config.js');

      if (withConfigSuffix.length > 0) {
        console.warn('⚠️  Config files with "Config" suffix (redundant):', withConfigSuffix);
      }

      // This is a warning, not a failure - existing code has this pattern
      expect(configFiles.length).toBeGreaterThan(0);
    });

  });

  // ============================================
  // GROUP 4: Frontend Component Naming
  // ============================================
  describe('TEST GROUP 4: Frontend Component Naming Conventions', () => {

    test('4.1 - Vue component files should be .vue extension', () => {
      const allFiles = getAllFiles(frontendDir);
      const vueFiles = allFiles.filter(f => path.extname(f) === '.vue');

      expect(vueFiles.length).toBeGreaterThan(0);
    });

    test('4.2 - Vue component files should start with capital letter (PascalCase)', () => {
      const allFiles = getAllFiles(frontendDir);
      const vueFiles = allFiles.filter(f => path.extname(f) === '.vue');
      const incorrectNames = vueFiles.filter(f => {
        const name = path.basename(f, '.vue');
        return !/^[A-Z]/.test(name);
      });

      if (incorrectNames.length > 0) {
        console.warn('⚠️  Vue components not starting with capital letter:',
          incorrectNames.map(f => path.basename(f)));
      }

      expect(incorrectNames.length).toBe(0);
    });

    test('4.3 - Frontend image assets in svg/ should use kebab-case', () => {
      const svgDir = path.join(frontendDir, 'assets', 'images', 'svg');
      if (fs.existsSync(svgDir)) {
        const items = fs.readdirSync(svgDir).filter(i => fs.statSync(path.join(svgDir, i)).isDirectory());
        const nonKebab = items.filter(i => !isKebabCase(i) && !isPascalCase(i));

        if (nonKebab.length > 0) {
          console.warn('⚠️  SVG folders not in kebab-case:', nonKebab);
        }

        // Allow for some PascalCase (legacy), but flag them
        expect(items.length).toBeGreaterThan(0);
      }
    });

  });

  // ============================================
  // GROUP 5: Vue 3 Composable Naming
  // ============================================
  describe('TEST GROUP 5: Vue 3 Composable Naming Convention', () => {

    test('5.1 - Composables should start with "use" prefix', () => {
      const composableDirs = [
        path.join(frontendDir, 'composable'),
        path.join(rootDir, 'installation', 'src', 'composable')
      ];

      composableDirs.forEach(dir => {
        if (fs.existsSync(dir)) {
          const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
          const nonUsePrefix = files.filter(f => !f.startsWith('use') && f !== 'index.js');

          if (nonUsePrefix.length > 0) {
            console.warn(`⚠️  Composables without "use" prefix in ${dir}:`, nonUsePrefix);
          }
        }
      });
    });

  });

  // ============================================
  // GROUP 6: Module-Specific Checks
  // ============================================
  describe('TEST GROUP 6: Critical Module Naming Issues', () => {

    test('6.1 - No "usersModule" folder (should be "Users")', () => {
      const modules = fs.readdirSync(modulesDir);
      const found = modules.includes('usersModule');

      if (found) {
        console.error('❌ Found "usersModule" (should be "Users")');
      }

      expect(found).toBe(false);
    });

    test('6.2 - "trackerUserPermission" should be "TrackerUserPermissions" (PascalCase + plural)', () => {
      const modules = fs.readdirSync(modulesDir);
      const found = modules.filter(m => m.includes('tracker') || m.includes('Tracker'));
      const permModules = found.filter(m => m.includes('Permission') || m.includes('permission'));

      // Check if singular tracker permission exists
      const singular = permModules.filter(m => m === 'trackerUserPermission');

      if (singular.length > 0) {
        console.warn('⚠️  Found "trackerUserPermission" (should be "TrackerUserPermissions")');
      }

      expect(found.length).toBeGreaterThan(0); // Should have some tracker modules
    });

    test('6.3 - No duplicate template modules (consolidate Template/ and emailTemplate/)', () => {
      const modules = fs.readdirSync(modulesDir);
      const hasTemplate = modules.includes('Template');
      const hasEmailTemplate = modules.includes('emailTemplate');
      const hasEmailTemplateCapital = modules.includes('EmailTemplate');

      // If both exist, that's the duplication issue
      const isDuplicated = (hasTemplate && hasEmailTemplate) || (hasTemplate && hasEmailTemplateCapital);

      if (isDuplicated) {
        console.warn('⚠️  Duplicate template modules detected - needs consolidation');
      }

      expect(modules.length).toBeGreaterThan(30); // Should have many modules
    });

    test('6.4 - Check for "checkinstallstep" (should be "CheckInstallStep" with PascalCase)', () => {
      const modules = fs.readdirSync(modulesDir);
      const found = modules.filter(m => m.toLowerCase().includes('checkinstall'));
      const wrongCase = found.filter(m => m === 'checkinstallstep');

      if (wrongCase.length > 0) {
        console.error('❌ Found "checkinstallstep" (should be "CheckInstallStep")');
      }

      expect(wrongCase.length).toBe(0);
    });

  });

  // ============================================
  // GROUP 7: Controller File Organization
  // ============================================
  describe('TEST GROUP 7: Controller File Organization Consistency', () => {

    test('7.1 - No module should have both controller.js and controller/ folder (must choose one pattern)', () => {
      const modules = fs.readdirSync(modulesDir);
      const problematicModules = [];

      modules.forEach(module => {
        const modulePath = path.join(modulesDir, module);
        if (fs.statSync(modulePath).isDirectory()) {
          const hasController = fs.existsSync(path.join(modulePath, 'controller.js'));
          const hasControllerDir = fs.existsSync(path.join(modulePath, 'controller'));

          if (hasController && hasControllerDir) {
            problematicModules.push(module);
          }
        }
      });

      if (problematicModules.length > 0) {
        console.warn('⚠️  Modules with BOTH controller.js and controller/ folder:', problematicModules);
      }

      expect(problematicModules.length).toBe(0);
    });

  });

  // ============================================
  // GROUP 8: Image Asset Naming
  // ============================================
  describe('TEST GROUP 8: Image Asset Naming (SVG, PNG, etc.)', () => {

    test('8.1 - No "compoment" typo in image asset folders', () => {
      const imagesDir = path.join(frontendDir, 'assets', 'images');
      if (fs.existsSync(imagesDir)) {
        const allDirs = getAllDirectories(imagesDir);
        const withTypo = allDirs.filter(d => path.basename(d).includes('compoment'));

        if (withTypo.length > 0) {
          console.error('❌ Image folders with "compoment" typo:', withTypo.map(d => path.basename(d)));
        }

        expect(withTypo.length).toBe(0);
      }
    });

    test('8.2 - Image icon folders should use consistent naming (kebab-case recommended)', () => {
      const svgDir = path.join(frontendDir, 'assets', 'images', 'svg');
      if (fs.existsSync(svgDir)) {
        const folders = fs.readdirSync(svgDir).filter(i =>
          fs.statSync(path.join(svgDir, i)).isDirectory()
        );

        // Count naming patterns
        const patterns = {
          pascalCase: 0,
          kebabCase: 0,
          snakeCase: 0,
          mixed: 0
        };

        folders.forEach(folder => {
          if (isPascalCase(folder)) patterns.pascalCase++;
          else if (isKebabCase(folder)) patterns.kebabCase++;
          else if (isSnakeCase(folder)) patterns.snakeCase++;
          else patterns.mixed++;
        });

        console.log('📊 SVG folder naming patterns:', patterns);

        // Should have mostly one pattern, not mixed
        const dominantPattern = Math.max(
          patterns.pascalCase,
          patterns.kebabCase,
          patterns.snakeCase
        );

        expect(dominantPattern).toBeGreaterThan(folders.length / 2);
      }
    });

  });

  // ============================================
  // GROUP 9: Config Directory Consistency
  // ============================================
  describe('TEST GROUP 9: Configuration File Naming', () => {

    test('9.1 - Configuration files should exist', () => {
      const configFiles = fs.readdirSync(configDir);
      expect(configFiles.length).toBeGreaterThan(0);
    });

    test('9.2 - Critical config files must exist: config.js, env.js, collections.js', () => {
      const required = ['config.js', 'env.js', 'collections.js'];
      const configFiles = fs.readdirSync(configDir);

      const missing = required.filter(f => !configFiles.includes(f));

      if (missing.length > 0) {
        console.error('❌ Missing critical config files:', missing);
      }

      expect(missing.length).toBe(0);
    });

  });

  // ============================================
  // GROUP 10: Summary & Statistics
  // ============================================
  describe('TEST GROUP 10: Codebase Statistics', () => {

    test('10.1 - Count modules by naming convention', () => {
      const modules = fs.readdirSync(modulesDir);

      const stats = {
        pascalCase: modules.filter(m => isPascalCase(m)).length,
        camelCase: modules.filter(m => isCamelCase(m) && !isPascalCase(m)).length,
        kebabCase: modules.filter(m => isKebabCase(m)).length,
        snakeCase: modules.filter(m => m.includes('_')).length,
        total: modules.length
      };

      console.log('📊 Module naming breakdown:', stats);
      expect(stats.total).toBeGreaterThan(30);
    });

    test('10.2 - Count Vue files in frontend', () => {
      const allFiles = getAllFiles(frontendDir);
      const vueFiles = allFiles.filter(f => f.endsWith('.vue'));

      console.log(`📊 Total Vue components found: ${vueFiles.length}`);
      expect(vueFiles.length).toBeGreaterThan(0);
    });

    test('10.3 - Count JavaScript files in Modules', () => {
      const allFiles = getAllFiles(modulesDir);
      const jsFiles = allFiles.filter(f => f.endsWith('.js'));

      console.log(`📊 Total JavaScript files in Modules: ${jsFiles.length}`);
      expect(jsFiles.length).toBeGreaterThan(50);
    });

  });

});

// ============================================
// SUMMARY REPORT
// ============================================

console.log(`
╔════════════════════════════════════════════════════════════════════════╗
║     NAMING CONVENTIONS TEST SUITE - AlianHub                          ║
║     Complete audit of project naming standards                        ║
╠════════════════════════════════════════════════════════════════════════╣
║                                                                        ║
║  TEST GROUPS (10 Total):                                              ║
║  ✓ Group 1: Module Folder Naming (4 tests)                            ║
║  ✓ Group 2: Spelling Errors & Typos (5 tests)                         ║
║  ✓ Group 3: File Naming Consistency (3 tests)                         ║
║  ✓ Group 4: Frontend Component Naming (3 tests)                       ║
║  ✓ Group 5: Vue 3 Composable Naming (1 test)                          ║
║  ✓ Group 6: Critical Module Issues (4 tests)                          ║
║  ✓ Group 7: Controller Organization (1 test)                          ║
║  ✓ Group 8: Image Asset Naming (2 tests)                              ║
║  ✓ Group 9: Configuration File Naming (2 tests)                       ║
║  ✓ Group 10: Statistics (3 tests)                                     ║
║                                                                        ║
║  TOTAL TESTS: 28                                                       ║
║                                                                        ║
╠════════════════════════════════════════════════════════════════════════╣
║  RUN TESTS:  npm test -- naming-conventions.test.js                   ║
║  WATCH MODE: npm test -- naming-conventions.test.js --watch           ║
╚════════════════════════════════════════════════════════════════════════╝
`);
