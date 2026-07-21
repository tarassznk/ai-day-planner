// Клієнтський планувальник дня «за принципом енергії».
// Детермінований, БЕЗ виклику AI — отже, надійний наживо: важкі та
// пріоритетні задачі йдуть на ранок, дрібні — пізніше; фіксовані за часом
// (зустрічі, дзвінки) стоять на своїх годинах, гнучкі заповнюють проміжки.

import type { Task } from "./types";

// Типові межі робочого дня та обід (можна перевизначити в налаштуваннях).
export const DAY_START = 9 * 60; // 09:00
export const DAY_END = 18 * 60; // 18:00
export const LUNCH_START = 13 * 60; // 13:00
export const LUNCH_MIN = 60;
const DEFAULT_EST = 30; // якщо AI не оцінив час

// Налаштування робочого дня (хвилини від опівночі).
export interface WorkdayOptions {
  dayStart?: number;
  dayEnd?: number;
}

export interface Slot {
  task: Task;
  startMin: number; // хвилини від опівночі; -1 = не вміщується у день
  endMin: number;
  fixed: boolean; // задача з явним часом (зустріч/дзвінок)
  overflow: boolean; // не влізла в робочий день — кандидат на перенос
}

export interface BusyBlock {
  start: string; // "HH:MM"
  end: string;
  label: string;
}

export interface BusyRender {
  startMin: number;
  endMin: number;
  label: string;
}

export interface Timeline {
  slots: Slot[]; // хронологічно; overflow-задачі в кінці
  overflow: Slot[]; // окремо — що не вміщується
  busy: BusyRender[]; // зайняті інтервали з «перепланувати з обмеженнями»
  plannedMinutes: number; // сумарний час усіх задач
  overflowMinutes: number; // скільки хвилин не влізло
}

export function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function fmtTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function estOf(t: Task): number {
  return t.estimateMinutes && t.estimateMinutes > 0
    ? t.estimateMinutes
    : DEFAULT_EST;
}

// Енергетичне сортування: спершу вищий пріоритет, потім довші задачі —
// щоб важке потрапляло на ранок, поки є сили.
function byEnergy(a: Task, b: Task): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  return estOf(b) - estOf(a);
}

export function buildTimeline(
  tasks: Task[],
  busyBlocks: BusyBlock[] = [],
  opts: WorkdayOptions = {}
): Timeline {
  const dayStart = opts.dayStart ?? DAY_START;
  const dayEnd = Math.max((opts.dayEnd ?? DAY_END), dayStart + 30);
  const active = tasks.filter((t) => t.status !== "done");

  const fixed: Slot[] = active
    .filter((t) => t.startTime)
    .map((t) => {
      const startMin = toMin(t.startTime as string);
      return {
        task: t,
        startMin,
        endMin: startMin + estOf(t),
        fixed: true,
        overflow: false,
      };
    })
    .sort((a, b) => a.startMin - b.startMin);

  const flexible = active.filter((t) => !t.startTime).sort(byEnergy);

  // Зовнішні зайняті інтервали (з «перепланувати з обмеженнями»), обрізані до дня.
  const busy: BusyRender[] = busyBlocks
    .map((b) => ({
      startMin: Math.max(toMin(b.start), dayStart),
      endMin: Math.min(toMin(b.end), dayEnd),
      label: b.label,
    }))
    .filter((b) => b.endMin > b.startMin)
    .sort((a, b) => a.startMin - b.startMin);

  // Зайняті інтервали в межах дня: фіксовані задачі + обід + обмеження.
  // Обрізаємо до [dayStart, dayEnd] і зливаємо перекриття.
  const rawBlocked: Array<[number, number]> = fixed
    .map((s): [number, number] => [
      Math.max(s.startMin, dayStart),
      Math.min(s.endMin, dayEnd),
    ])
    .filter(([s, e]) => e > s);
  // Обід — лише якщо потрапляє в робочий день.
  const lunchStart = Math.max(LUNCH_START, dayStart);
  const lunchEnd = Math.min(LUNCH_START + LUNCH_MIN, dayEnd);
  if (lunchEnd > lunchStart) rawBlocked.push([lunchStart, lunchEnd]);
  for (const b of busy) rawBlocked.push([b.startMin, b.endMin]);
  rawBlocked.sort((a, b) => a[0] - b[0]);

  const merged: Array<[number, number]> = [];
  for (const b of rawBlocked) {
    const last = merged[merged.length - 1];
    if (last && b[0] <= last[1]) last[1] = Math.max(last[1], b[1]);
    else merged.push([b[0], b[1]]);
  }

  // Вільні проміжки дня між зайнятими інтервалами.
  const gaps: Array<[number, number]> = [];
  let cur = dayStart;
  for (const [s, e] of merged) {
    const cs = Math.max(s, dayStart);
    if (cs > cur) gaps.push([cur, cs]);
    cur = Math.max(cur, e);
  }
  if (cur < dayEnd) gaps.push([cur, dayEnd]);

  // First-fit: у порядку енергії кладемо задачу в НАЙРАНІШИЙ проміжок, що
  // її вміщує (проміжок звужується). Так заповнюються «вікна» між зустрічами,
  // а не вимиваються дрібні задачі в overflow.
  const placed: Slot[] = [];
  let overflowMinutes = 0;
  for (const t of flexible) {
    const dur = estOf(t);
    const gi = gaps.findIndex(([s, e]) => e - s >= dur);
    if (gi === -1) {
      placed.push({ task: t, startMin: -1, endMin: -1, fixed: false, overflow: true });
      overflowMinutes += dur;
    } else {
      const [s, e] = gaps[gi];
      placed.push({
        task: t,
        startMin: s,
        endMin: s + dur,
        fixed: false,
        overflow: false,
      });
      gaps[gi] = [s + dur, e];
    }
  }

  const scheduled = [...fixed, ...placed.filter((s) => !s.overflow)].sort(
    (a, b) => a.startMin - b.startMin
  );
  const overflow = placed.filter((s) => s.overflow);
  const plannedMinutes = active.reduce((sum, t) => sum + estOf(t), 0);

  return {
    slots: [...scheduled, ...overflow],
    overflow,
    busy,
    plannedMinutes,
    overflowMinutes,
  };
}
