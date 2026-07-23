import { describe, it, expect } from "vitest";
import { buildIcs } from "../lib/ics";
import type { Task } from "../lib/types";

function task(over: Partial<Task>): Task {
  return {
    id: over.id ?? "id1",
    title: over.title ?? "Задача",
    priority: 3, estimateMinutes: 60, dueDate: null,
    scheduledDate: null, startTime: null, status: "planned",
    tags: [], notes: "", subtasks: [], createdAt: "2026-07-23T00:00:00Z",
    completedAt: null, ...over,
  };
}

describe("buildIcs — багатоденний експорт", () => {
  it("кожна подія стається на власний день", () => {
    const ics = buildIcs([
      { id: "a", title: "День 1", dateIso: "2026-07-01", startMin: 540, endMin: 600, task: task({ id: "a" }) },
      { id: "b", title: "День 15", dateIso: "2026-07-15", startMin: 840, endMin: 900, task: task({ id: "b" }) },
      { id: "c", title: "День 31", dateIso: "2026-07-31", startMin: 600, endMin: 660, task: task({ id: "c" }) },
    ]);
    const vevents = ics.match(/BEGIN:VEVENT/g) ?? [];
    expect(vevents).toHaveLength(3);
    expect(ics).toContain("DTSTART:20260701T090000");
    expect(ics).toContain("DTSTART:20260715T140000");
    expect(ics).toContain("DTSTART:20260731T100000");
    // Валідна обгортка календаря
    expect(ics.startsWith("BEGIN:VCALENDAR")).toBe(true);
    expect(ics.trim().endsWith("END:VCALENDAR")).toBe(true);
  });

  it("UID унікальний по (задача + день)", () => {
    const ics = buildIcs([
      { id: "x", title: "T", dateIso: "2026-07-01", startMin: 540, endMin: 600, task: task({ id: "x" }) },
      { id: "y", title: "T", dateIso: "2026-07-02", startMin: 540, endMin: 600, task: task({ id: "y" }) },
    ]);
    expect(ics).toContain("UID:x-2026-07-01@ai-day-planner");
    expect(ics).toContain("UID:y-2026-07-02@ai-day-planner");
  });

  it("екранує спецсимволи у SUMMARY", () => {
    const ics = buildIcs([
      { id: "e", title: "Купити хліб, молоко; сир", dateIso: "2026-07-01", startMin: 540, endMin: 600, task: task({ id: "e" }) },
    ]);
    expect(ics).toContain("SUMMARY:Купити хліб\\, молоко\\; сир");
  });
});
