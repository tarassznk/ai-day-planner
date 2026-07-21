"use client";

import { useCallback, useEffect, useState } from "react";
import type { ParsedTask, Task } from "./types";

const STORAGE_KEY = "ai-day-planner:tasks:v1";

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function tomorrowStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function newId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `t_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

function load(): Task[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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
        status: scheduledDate ? "planned" : "inbox",
        tags: p.tags,
        notes: "",
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

  // Перенести невиконані задачі з сьогодні (і раніше) на завтра.
  const carryOverToTomorrow = useCallback(() => {
    const today = todayStr();
    const tmr = tomorrowStr();
    let moved = 0;
    setTasks((prev) =>
      prev.map((t) => {
        if (
          t.status === "planned" &&
          t.scheduledDate &&
          t.scheduledDate <= today
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
