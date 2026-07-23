// Локальний експорт плану у файл .ics (iCalendar). БЕЗ мережі й OAuth —
// надійний «фінальний акорд» для демо: користувач вивантажує план у будь-який
// календар (Google/Apple/Outlook) одним тапом. Підтримує як один день
// (Сьогодні), так і цілий місяць (Календар) — кожна подія несе власну дату.

import type { Task } from "./types";

interface IcsSlot {
  startMin: number;
  endMin: number;
  overflow: boolean;
  task: Task;
}

interface IcsEvent {
  id: string;
  title: string;
  dateIso: string; // "YYYY-MM-DD" — на який день ця подія
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

export function buildIcs(events: IcsEvent[]): string {
  const dtstamp = stamp(events[0]?.dateIso ?? "1970-01-01", 0);
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
      // UID унікальний по (задача + день) — задача живе на одному дні,
      // але дата в UID страхує від колізій між днями у місячному експорті.
      `UID:${e.id}-${e.dateIso}@ai-day-planner`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${stamp(e.dateIso, e.startMin)}`,
      `DTEND:${stamp(e.dateIso, e.endMin)}`,
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

// Запланований (не-overflow) слот → подія на вказаний день.
function eventsFromSlots(slots: IcsSlot[], dateIso: string): IcsEvent[] {
  return slots
    .filter((s) => !s.overflow && s.startMin >= 0)
    .map((s) => ({
      id: s.task.id,
      title: s.task.title,
      dateIso,
      startMin: s.startMin,
      endMin: s.endMin,
      task: s.task,
    }));
}

function triggerDownload(ics: string, filename: string): void {
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Експорт плану ОДНОГО дня (вкладка «Сьогодні»).
export function downloadIcs(slots: IcsSlot[], dateIso: string): number {
  const events = eventsFromSlots(slots, dateIso);
  if (events.length === 0) return 0;
  triggerDownload(buildIcs(events), `plan-${dateIso}.ics`);
  return events.length;
}

// Експорт плану цілого МІСЯЦЯ (вкладка «Календар»): по слоту на кожен день.
// monthLabel — для назви файлу, напр. "2026-07".
export function downloadMonthIcs(
  days: Array<{ dateIso: string; slots: IcsSlot[] }>,
  monthLabel: string
): number {
  const events = days.flatMap((d) => eventsFromSlots(d.slots, d.dateIso));
  if (events.length === 0) return 0;
  triggerDownload(buildIcs(events), `plan-${monthLabel}.ics`);
  return events.length;
}
