// Робота з календарними датами — ЄДИНЕ джерело правди.
// Свідомо використовуємо ЛОКАЛЬНІ компоненти дати (getFullYear/Month/Date),
// а не toISOString(): iso від UTC зсуває день у поясах на кшталт UTC+2/+3
// у нічні години й розсинхронізовує сховище задач із сіткою календаря.

// Date → "YYYY-MM-DD" за локальним календарем (без UTC-зсуву).
export function isoLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Сьогодні за локальним календарем.
export function todayStr(): string {
  return isoLocal(new Date());
}

// Завтра за локальним календарем.
export function tomorrowStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return isoLocal(d);
}

// Перевіряє, що рядок — валідна дата у форматі YYYY-MM-DD (і реально існує:
// відкидає 2026-13-40 тощо). Повертає нормалізований рядок або null.
export function coerceDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  // Round-trip відсіює неіснуючі дати (напр. 2026-02-30 → 2026-03-02 ≠ вхід).
  return isoLocal(d) === s ? s : null;
}
