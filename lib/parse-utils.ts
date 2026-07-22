// Спільні хелпери для серверних AI-роутів (parse, replan).
// Не довіряємо формату від моделі наосліп — усе нормалізуємо/валідуємо.

// Максимальна довжина вводу, яку приймаємо від клієнта. Захист від абʼюзу
// публічного ендпоінта: без цього хтось може слати мегабайти тексту й палити
// токени на нашому ключі. ~4000 символів вистачає навіть на довгий brain dump.
export const MAX_INPUT_CHARS = 4000;

// Нормалізуємо час до "HH:MM" (24 год). Невалідне → null.
export function coerceTime(t: unknown): string | null {
  if (typeof t !== "string") return null;
  const m = t.trim().match(/^(\d{1,2}):?(\d{2})?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}
