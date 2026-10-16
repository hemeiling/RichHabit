import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Drag auto-scroll, read from the source: there is exactly one auto-scroll
 * module; every surface that starts a native drag starts it and every end
 * funnel stops it; the sidebar is marked so a drag crossing it scrolls the
 * page instead of the navigation; and the module itself keeps the properties
 * the feature's safety rests on (capture-phase coordinates, its own stop on
 * dragend/drop, reduced-motion ceiling, innermost-container walk).
 */

const ROOT = path.resolve(__dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");

const MODULE = "src/lib/dragAutoScroll.ts";
// Every file that renders a draggable card or row, with its drag-state owner
// (the file whose start/end funnel must call the module).
const OWNERS = [
  "src/components/Priorities.tsx",
  "src/components/screens/RichHabits.tsx",
  "src/components/together/useListDrag.ts",
];

describe("the one auto-scroll module", () => {
  const src = read(MODULE);

  it("is the only file that watches drag coordinates globally (no second system)", () => {
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
    const others = walk(path.join(ROOT, "src"))
      .filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith("dragAutoScroll.ts"))
      .filter((f) => /addEventListener\("drag(over|end)"/.test(fs.readFileSync(f, "utf8")));
    expect(others).toEqual([]);
  });

  it("reads pointer coordinates on the window in the capture phase, so a card's stopPropagation cannot starve it", () => {
    expect(src).toContain('window.addEventListener("dragover", onDragOver, true)');
  });

  it("stops itself on dragend and drop, so an unmounting surface cannot leave it running", () => {
    expect(src).toContain('window.addEventListener("dragend", onDragFinished, true)');
    expect(src).toContain('window.addEventListener("drop", onDragFinished, true)');
    expect(src).toContain("cancelAnimationFrame(raf)");
  });

  it("removes every listener it added", () => {
    for (const m of src.matchAll(/window\.addEventListener\("(\w+)", (\w+), true\)/g)) {
      expect(src, m[1]).toContain(`window.removeEventListener("${m[1]}", ${m[2]}, true)`);
    }
  });

  it("ramps from gentle to fast (squared pull) and honours reduced motion with a lower ceiling", () => {
    expect(src).toMatch(/maxStep \* t \* t/);
    expect(src).toContain("prefers-reduced-motion: reduce");
    expect(src).toMatch(/const REDUCED_STEP = (\d+)/);
    const max = Number(src.match(/const MAX_STEP = (\d+)/)![1]);
    const reduced = Number(src.match(/const REDUCED_STEP = (\d+)/)![1]);
    expect(reduced).toBeLessThan(max);
  });

  it("walks from the innermost scrollable under the pointer outward, skipping marked elements, ending at the page", () => {
    expect(src).toContain("document.elementFromPoint(x, y)");
    expect(src).toContain("el.parentElement");
    expect(src).toContain('data-drag-autoscroll") === "skip"');
    expect(src).toContain("document.scrollingElement");
  });
});

describe("every drag surface uses it", () => {
  for (const f of OWNERS) {
    it(`${f} starts on dragstart and stops in its end funnel`, () => {
      const src = read(f);
      expect(src).toContain('from "@/lib/dragAutoScroll"');
      expect(src).toContain("startDragAutoScroll()");
      expect(src).toContain("stopDragAutoScroll()");
    });
  }

  it("no draggable surface exists outside the known owners (a new one must adopt the module)", () => {
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
    const draggy = walk(path.join(ROOT, "src"))
      .filter((f) => /\.tsx$/.test(f))
      .filter((f) => /(^|\s)draggable([\s>=]|$)/m.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(ROOT, f).split(path.sep).join("/")).sort();
    // TaskCard and Backlog render the attribute but funnel start/end through
    // useListDrag, which is an OWNER above.
    expect(draggy).toEqual([
      "src/components/Priorities.tsx",
      "src/components/screens/RichHabits.tsx",
      "src/components/together/Backlog.tsx",
      "src/components/together/TaskCard.tsx",
    ]);
  });

  it("the sidebar is marked skip, so crossing it scrolls the page, not the navigation", () => {
    expect(read("src/components/Sidebar.tsx")).toContain('data-drag-autoscroll="skip"');
  });
});
