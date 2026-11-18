/* A stylesheet that is not scoped reaches every page. When it places a class (position: fixed or absolute) and a
   component elsewhere gives its root that same class, the component leaves its place in the page: the project's
   limits card took the search palette's `.pal` and covered the whole view at phone width. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { liftedClasses, rootClasses, findCollisions } = require('./global-class-collisions');

describe('no component root is placed by a global rule of another part of the app', () => {
    it('in frontend/src/views and frontend/src/components', () => {
        const lines = Object.entries(findCollisions()).flatMap(([file, found]) => found.map((hit) => `${file}: ${hit}`));
        if (lines.length) {
            throw new Error(`${lines.length} component root(s) carry a class a global stylesheet positions:\n  ${lines.join('\n  ')}\nGive the component a class prefix of its own.`);
        }
    });
});

describe('the scanner', () => {
    it('reads the classes a sheet places through a selector that is one class and nothing else', () => {
        const css = [
            '.palette { position: absolute; top: 12vh; }',
            '/* .ghost { position: fixed; top: 0; } */',
            '@media (max-width: 767px) { .sheet { position: fixed; inset: 0; } }',
            '.a, .b.c, div.d { top: 0; position: fixed }',
            '.card .menu { position: absolute; top: 0; }',
            '.nested { .inner { position: absolute; top: 0; } }',
            '.stays { position: relative; top: 0; }',
            '.text::after { content: "} .quoted { position: fixed; top: 0; }"; }',
        ].join('\n');
        expect(liftedClasses(css).sort()).toEqual(['a', 'palette', 'sheet']);
    });

    it('leaves out a rule that only sets the position: that is a utility, put on an element on purpose', () => {
        expect(liftedClasses('.position-fi { position: fixed; }\n.position-ab {\n  position: absolute !important;\n}')).toEqual([]);
    });

    it('reads the classes written on the first element a component renders', () => {
        expect(rootClasses('<template>\n    <section class="pal wide" :class="{ on: a > b }" data-test="x"><p class="inner"></p></section>\n</template>')).toEqual(['pal', 'wide']);
        expect(rootClasses('<template><Teleport to="body"><Transition name="fade"><div v-if="open" class="layer"></div></Transition></Teleport></template>')).toEqual(['layer']);
        expect(rootClasses('<template><!-- <div class="old"> --><div :class="kind"></div></template>')).toEqual([]);
        expect(rootClasses('<script setup>const a = 1;</script>')).toEqual([]);
    });

    describe('over a source tree', () => {
        let src;
        const write = (file, text) => {
            fs.mkdirSync(path.dirname(path.join(src, file)), { recursive: true });
            fs.writeFileSync(path.join(src, file), text);
        };

        beforeEach(() => { src = fs.mkdtempSync(path.join(os.tmpdir(), 'class-collisions-')); });
        afterEach(() => fs.rmSync(src, { recursive: true, force: true }));

        it('names the component, the class and the sheet', () => {
            write('components/Search/style.css', '.pal { position: absolute; top: 12vh; }');
            write('components/Search/Palette.vue', '<template><div class="pal"></div></template>\n<script>import "@/components/Search/style.css";</script>');
            write('views/Projects/LimitsCard.vue', '<template><section class="pal"></section></template>\n<style scoped>.pal { display: flex; }</style>');
            expect(findCollisions(src)).toEqual({ 'views/Projects/LimitsCard.vue': ['pal <- components/Search/style.css'] });
        });

        it('also reads a <style> block without scoped, and a sheet pulled into a scoped block with @import', () => {
            write('components/Toast.vue', '<template><div class="toast"></div></template>\n<style>.note { position: fixed; bottom: 0; }</style>');
            write('components/Drawer/drawer.css', '.drawer { position: fixed; right: 0; }');
            write('components/Drawer/Drawer.vue', '<template><aside class="drawer"></aside></template>\n<style scoped>@import "./drawer.css";</style>');
            write('views/Notes.vue', '<template><div class="note"></div></template>');
            write('views/Settings/Drawer.vue', '<template><div class="drawer"></div></template>');
            expect(findCollisions(src)).toEqual({
                'views/Notes.vue': ['note <- components/Toast.vue'],
                'views/Settings/Drawer.vue': ['drawer <- components/Drawer/drawer.css'],
            });
        });

        it('lets a component use the sheet of its own folder, of a folder above it, or one it loads', () => {
            write('views/Ai/style.css', '.aw-backdrop { position: fixed; inset: 0; }');
            write('views/Ai/AskPanel.vue', '<template><div class="aw-backdrop"></div></template>');
            write('views/Ai/Runs/RunPanel.vue', '<template><div class="aw-backdrop"></div></template>');
            write('components/Picker.vue', '<template><div class="aw-backdrop"></div></template>\n<style>@import "../views/Ai/style.css";</style>');
            expect(findCollisions(src)).toEqual({});
        });

        it('leaves a sheet scoped through <style scoped src> alone', () => {
            write('components/Cal/style.css', '.cal { position: absolute; top: 0; }');
            write('components/Cal/Cal.vue', '<template><div class="cal"></div></template>\n<style scoped src="./style.css"></style>');
            write('views/Planner.vue', '<template><div class="cal"></div></template>');
            expect(findCollisions(src)).toEqual({});
        });
    });
});
