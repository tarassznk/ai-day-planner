// Головний контракт продукту: як виглядає одна задача.
// Цю схему повертає AI-парсер і на неї спирається весь інтерфейс.

// Пріоритетність: 1 = висока, 2 = середня, 3 = низька, 4 = без пріоритету.
export type Priority = 1 | 2 | 3 | 4;

export type TaskStatus = "inbox" | "planned" | "done";

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
}

export interface Task {
  id: string;
  title: string;
  priority: Priority;
  // Оцінка часу у хвилинах (для «реалістичності плану»). null = невідомо.
  estimateMinutes: number | null;
  // Дедлайн у форматі YYYY-MM-DD або null.
  dueDate: string | null;
  // На який день заплановано (YYYY-MM-DD). null = ще в Inbox, не заплановано.
  scheduledDate: string | null;
  // Фіксований час початку "HH:MM" (зустрічі, дзвінки). null = гнучка задача,
  // яку планувальник сам розкладає за принципом енергії.
  startTime: string | null;
  status: TaskStatus;
  // Розумні теги від AI (напр. "робота", "дім", "здоровʼя").
  tags: string[];
  notes: string;
  subtasks: Subtask[];
  createdAt: string; // ISO
  completedAt: string | null; // ISO
}

// Те, що повертає AI на етапі парсингу brain dump.
// Далі клієнт добудовує це до повноцінного Task.
export interface ParsedTask {
  title: string;
  priority: Priority;
  estimateMinutes: number | null;
  dueDate: string | null;
  // Явний час "HH:MM", якщо згадано ("о 15:00", "дзвінок о 3"). null = немає.
  startTime: string | null;
  tags: string[];
  // AI пропонує зробити цю задачу сьогодні.
  scheduleToday: boolean;
}

// Кольори пріоритетів живуть у CSS-токенах (--p1..--p4) і застосовуються
// через класи .meta-chip.p1/.p2/.p3 — тут лише текстові підписи.
export const PRIORITY_META: Record<
  Priority,
  { label: string; short: string }
> = {
  1: { label: "Висока пріоритетність", short: "Висока" },
  2: { label: "Середня пріоритетність", short: "Середня" },
  3: { label: "Низька пріоритетність", short: "Низька" },
  4: { label: "Без пріоритету", short: "—" },
};

// Скільки продуктивних хвилин у робочому дні — для перевірки реалістичності.
export const WORKDAY_MINUTES = 8 * 60;
