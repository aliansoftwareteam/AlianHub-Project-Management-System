# Test Cases — VIEW-05 Map view (AHE-3746)

A first-class **project view** (keyName `MapView`): pin tasks onto a world map to see
where work happens. Dependency-free and **fully offline** — a custom SVG equirectangular
world canvas (no Leaflet, no external map tiles), honoring AlianHub's self-hosted /
data-residency / Offline-Mode identity. Task placements are personal and saved to the
browser (localStorage), like the Whiteboard view's card positions.

**Why no Leaflet/OSM tiles:** fetching map tiles from a third party on every render would
add a runtime network + CSP dependency that none of the other views have and that
contradicts the product's offline/self-hosted posture (AHE-3763 Offline Mode). The SVG
canvas plots real lat/lng via an equirectangular projection with zero external calls.

**Registration:** MapView.vue · Projects.vue (`getView` + 3 layout conditions) ·
commonFunction `projectComponentsIcons` · ViewsDropdown `images` · en.js `ViewList.MapView` +
`ViewList["Map View"]` + `ViewListdescription.map_view` · utils/data.js seed (keyName `MapView`, sortIndex 16).
Existing companies need the catalog DB record added (user-maintained process).

## Projection
- `project(lat,lng)` → `x = (lng+180)/360 · W`, `y = (90-lat)/180 · H` (W=1000, H=500, 2:1).
- `unproject(x,y)` inverts it. Click → unproject → clamp to [-90,90]/[-180,180].

## Manual / integration test cases

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| M1 | View appears | add catalog record → "+ View" | "Map" listed; label + description resolve (no raw `ViewList.*`) |
| M2 | Canvas renders | open Map | ocean background, 30° graticule, bold equator + prime meridian, edge degree labels (N/S/E/W) |
| M3 | Place a task | click **Place** on a tray task → click the map | a colored pin drops at the clicked point; task leaves the tray; selected-card shows its lat/lng |
| M4 | Cancel placing | click Place → "cancel" in the banner | placing mode ends, no pin added |
| M5 | Pin color = status | tasks in to-do / in-progress / done | grey / amber / green pins |
| M6 | Select pin | click a placed pin | side card shows name, key, coords, **Remove from map**; pin outlined |
| M7 | Remove | open a pin → Remove from map | pin gone; task back in the "To place" tray |
| M8 | Persistence | place a few, reload | placements restored (localStorage `map:{pid}:{sid}`) |
| M9 | Clear all | click **Clear all** | all pins removed; all tasks back in tray |
| M10 | Per-sprint | switch sprint | placements scoped per project+sprint key; no bleed across sprints |
| M11 | Empty | sprint with no tasks | "No tasks in this sprint yet." |
| M12 | Live sync | task added/closed elsewhere | tray/pin set + pin colors recompute from the store |

## Guards / non-regression
- **Zero backend** — no schema change, no endpoint, no socket, no new collection. Placements live in localStorage only (per-browser, per user/device), documented as the known v1 limitation; a shared server-side `location` field is the natural enhancement.
- Reuses the GanttView data harness (`pickTasks` + `ensureTasksLoaded` via `groupBy`); deleted tasks excluded (`deletedStatusKey ∈ {0,2,undefined,null}`); done = status type `close`.
- No external network at runtime (no tiles, no geocoding) — works fully offline.
- Additive: new view + registration + seed only; no existing view or core path touched.
