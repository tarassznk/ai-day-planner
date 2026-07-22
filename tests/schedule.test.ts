import { describe, it, expect } from "vitest";
import { buildTimeline, toMin, fmtTime } from "../lib/schedule";
import type { Task } from "../lib/types";

function task(over: Partial<Task>): Task {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    title: over.title ?? "task",
    priority: over.priority ?? 3,
    estimateMinutes: over.estimateMinutes ?? null,
    dueDate: null,
    scheduledDate: "2026-07-22",
    startTime: over.startTime ?? null,
    status: over.status ?? "planned",
    tags: [],
    notes: "",
    subtasks: [],
    createdAt: "2026-07-22T00:00:00.000Z",
    completedAt: null,
    ...over,
  };
}

describe("toMin / fmtTime", () => {
  it("конвертує туди й назад", () => {
    expect(toMin("09:00")).toBe(540);
    expect(toMin("13:30")).toBe(810);
    expect(fmtTime(540)).toBe("09:00");
    expect(fmtTime(810)).toBe("13:30");
  });
});

describe("buildTimeline", () => {
  it("кладе гнучку задачу на початок робочого дня", () => {
    const tl = buildTimeline([task({ estimateMinutes: 30, priority: 1 })]);
    const slot = tl.slots.find((s) => !s.overflow)!;
    expect(slot.startMin).toBe(540); // 09:00
    expect(slot.endMin).toBe(570); // 09:30
    expect(tl.overflow).toHaveLength(0);
  });

  it("ставить фіксовану задачу на її час і позначає fixed", () => {
    const tl = buildTimeline([
      task({ startTime: "15:00", estimateMinutes: 60, title: "дзвінок" }),
    ]);
    const fixed = tl.slots.find((s) => s.fixed)!;
    expect(fixed.startMin).toBe(900); // 15:00
    expect(fixed.endMin).toBe(960); // 16:00
  });

  it("не планує на обід (13:00–14:00)", () => {
    // Дві задачі по 4 години: 09–13 і 14–18, обід між ними.
    const tl = buildTimeline([
      task({ estimateMinutes: 240, priority: 1, title: "A" }),
      task({ estimateMinutes: 240, priority: 1, title: "B" }),
    ]);
    const busy = [810, 840]; // 13:30, 14:00 — жодна задача не має покрити обід
    for (const s of tl.slots.filter((x) => !x.overflow)) {
      for (const m of busy) {
        const overlapsLunch = s.startMin < 840 && s.endMin > 780;
        // жоден слот не має перетинати 13:00–14:00
        expect(overlapsLunch && s.startMin < m && s.endMin > m).toBe(false);
      }
    }
  });

  it("виносить зайве в overflow при перевантаженні", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      task({ estimateMinutes: 60, priority: 2, title: `t${i}` })
    );
    const tl = buildTimeline(many);
    expect(tl.overflow.length).toBeGreaterThan(0);
    expect(tl.overflowMinutes).toBeGreaterThan(0);
  });

  it("ігнорує виконані задачі", () => {
    const tl = buildTimeline([
      task({ estimateMinutes: 30, status: "done" }),
    ]);
    expect(tl.slots).toHaveLength(0);
    expect(tl.plannedMinutes).toBe(0);
  });

  it("враховує зайняті інтервали з перепланування", () => {
    const tl = buildTimeline(
      [task({ estimateMinutes: 60, priority: 1 })],
      [{ start: "09:00", end: "11:00", label: "зустріч" }]
    );
    const slot = tl.slots.find((s) => !s.overflow)!;
    // Задача не може стати раніше 11:00 (09–11 зайнято).
    expect(slot.startMin).toBeGreaterThanOrEqual(660);
    expect(tl.busy).toHaveLength(1);
  });
});
