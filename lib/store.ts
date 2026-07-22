"use client";

import { useCallback, useEffect, useState } from "react";
import type { ParsedTask, Task } from "./types";
import { todayStr, tomorrowStr } from "./date";

// Реекспорт — щоб наявні імпорти `from "@/lib/store"` не ламались.
export { todayStr, tomorrowStr };

const STORAGE_KEY = "ai-day-planner:tasks:v1";
const SETTINGS_KEY = "ai-day-planner:settings:v1";

// Налаштування робочого дня (години планування).
export interface Settings {
  dayStart: string; // "HH:MM"
  dayEnd: string;
}
const DEFAULT_SETTINGS: Settings = { dayStart: "09:00", dayEnd: "18:00" };

function newId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `t_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

// Бекфіл полів, доданих пізніше (startTime, subtasks) — щоб старі задачі
// з localStorage не ламали новий UI.
function normalize(t: Partial<Task>): Task {
  return {
    ...(t as Task),
    startTime: t.startTime ?? null,
    subtasks: Array.isArray(t.subtasks) ? t.subtasks : [],
    tags: Array.isArray(t.tags) ? t.tags : [],
    notes: typeof t.notes === "string" ? t.notes : "",
  };
}

function load(): Task[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(normalize) : [];
  } catch {
    return [];
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        setSettings({
          dayStart:
            typeof parsed?.dayStart === "string"
              ? parsed.dayStart
              : DEFAULT_SETTINGS.dayStart,
          dayEnd:
            typeof parsed?.dayEnd === "string"
              ? parsed.dayEnd
              : DEFAULT_SETTINGS.dayEnd,
        });
      }
    } catch {
      /* лишаємо дефолти */
    }
    setLoaded(true);
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch {
        /* сховище недоступне */
      }
      return next;
    });
  }, []);

  return { settings, loaded, update };
}

export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setTasks(load());
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    } catch {
      /* сховище недоступне — тихо ігноруємо */
    }
  }, [tasks, loaded]);

  const addParsed = useCallback((parsed: ParsedTask[]) => {
    const now = new Date().toISOString();
    const today = todayStr();
    const created: Task[] = parsed.map((p) => {
      // Логіка планування: "сьогодні" → сьогодні; є дедлайн → на день дедлайну
      // (як у Todoist); інакше — у Вхідні як недатований беклог.
      const scheduledDate = p.scheduleToday ? today : p.dueDate ?? null;
      return {
        id: newId(),
        title: p.title,
        priority: p.priority,
        estimateMinutes: p.estimateMinutes,
        dueDate: p.dueDate,
        scheduledDate,
        startTime: p.startTime ?? null,
        status: scheduledDate ? "planned" : "inbox",
        tags: p.tags,
        notes: "",
        subtasks: [],
        createdAt: now,
        completedAt: null,
      };
    });
    setTasks((prev) => [...created, ...prev]);
    return created;
  }, []);

  const toggleDone = useCallback((id: string) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        const done = t.status !== "done";
        return {
          ...t,
          status: done ? "done" : t.scheduledDate ? "planned" : "inbox",
          completedAt: done ? new Date().toISOString() : null,
        };
      })
    );
  }, []);

  const scheduleToday = useCallback((id: string) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === id
          ? { ...t, scheduledDate: todayStr(), status: "planned" }
          : t
      )
    );
  }, []);

  const moveToInbox = useCallback((id: string) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, scheduledDate: null, status: "inbox" } : t
      )
    );
  }, []);

  // Перенести задачу на конкретний день (для тижневого розкладу).
  const moveToDate = useCallback((id: string, date: string) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === id
          ? {
              ...t,
              scheduledDate: date,
              status: t.status === "done" ? "done" : "planned",
            }
          : t
      )
    );
  }, []);

  const updateTask = useCallback((id: string, patch: Partial<Task>) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const removeTask = useCallback((id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Прибрати кілька задач за id (для undo після AI-парсингу).
  const removeMany = useCallback((ids: string[]) => {
    const set = new Set(ids);
    setTasks((prev) => prev.filter((t) => !set.has(t.id)));
  }, []);

  // Повернути видалену задачу (для undo). Не дублюємо, якщо вже є.
  const restoreTask = useCallback((task: Task) => {
    setTasks((prev) =>
      prev.some((t) => t.id === task.id) ? prev : [task, ...prev]
    );
  }, []);

  // Перенести ПРОСТРОЧЕНІ задачі (заплановані на минулі дні) на завтра.
  // Сьогоднішні не чіпаємо — для них є ручні дії «→ Завтра» на кожній задачі.
  const carryOverToTomorrow = useCallback(() => {
    const today = todayStr();
    const tmr = tomorrowStr();
    let moved = 0;
    setTasks((prev) =>
      prev.map((t) => {
        if (
          t.status === "planned" &&
          t.scheduledDate &&
          t.scheduledDate < today
        ) {
          moved++;
          return { ...t, scheduledDate: tmr };
        }
        return t;
      })
    );
    return moved;
  }, []);

  return {
    tasks,
    loaded,
    addParsed,
    toggleDone,
    scheduleToday,
    moveToInbox,
    moveToDate,
    updateTask,
    removeTask,
    removeMany,
    restoreTask,
    carryOverToTomorrow,
  };
}
