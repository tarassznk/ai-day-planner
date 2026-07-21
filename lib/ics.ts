// Локальний експорт плану дня у файл .ics (iCalendar). БЕЗ мережі й OAuth —
// надійний «фінальний акорд» для демо: користувач вивантажує план у будь-який
// календар (Google/Apple/Outlook) одним тапом.

import type { Task } from "./types";

interface IcsEvent {
  id: string;
  title: string;
  startMin: number;
  endMin: number;
  task: Task;
}

function esc(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

// "2026-07-21" + хвилини від опівночі → "20260721T090000".
function stamp(dateIso: string, min: number): string {
  const d = dateIso.replace(/-/g, "");
  const h = String(Math.floor(min / 60)).padStart(2, "0");
  const m = String(min % 60).padStart(2, "0");
  return `${d}T${h}${m}00`;
}

export function buildIcs(events: IcsEvent[], dateIso: string): string {
  const dtstamp = stamp(dateIso, 0);
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AI Day Planner//UK//",
    "CALSCALE:GREGORIAN",
  ];
  for (const e of events) {
    const subs = e.task.subtasks;
    const descParts: string[] = [];
    if (e.task.notes) descParts.push(e.task.notes);
    if (subs.length > 0) {
      descParts.push(
        subs.map((s) => `${s.done ? "[x]" : "[ ]"} ${s.title}`).join("\n")
      );
    }
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.id}@ai-day-planner`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${stamp(dateIso, e.startMin)}`,
      `DTEND:${stamp(dateIso, e.endMin)}`,
      `SUMMARY:${esc(e.title)}`
    );
    if (descParts.length > 0) {
      lines.push(`DESCRIPTION:${esc(descParts.join("\n\n"))}`);
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

// Зібрати .ics із запланованих (не-overflow) слотів і завантажити файл.
export function downloadIcs(
  slots: Array<{ startMin: number; endMin: number; overflow: boolean; task: Task }>,
  dateIso: string
): number {
  const events: IcsEvent[] = slots
    .filter((s) => !s.overflow && s.startMin >= 0)
    .map((s) => ({
      id: s.task.id,
      title: s.task.title,
      startMin: s.startMin,
      endMin: s.endMin,
      task: s.task,
    }));
  if (events.length === 0) return 0;

  const ics = buildIcs(events, dateIso);
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `plan-${dateIso}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return events.length;
}
