"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTasks, todayStr } from "@/lib/store";
import { useSpeech } from "@/lib/useSpeech";
import {
  PRIORITY_META,
  WORKDAY_MINUTES,
  type Task,
  type Priority,
} from "@/lib/types";

type Tab = "today" | "week" | "inbox";

interface WeekDay {
  iso: string;
  label: string; // Сьогодні / Завтра / Понеділок…
  dateLabel: string; // 21 лип.
}

function buildWeek(): WeekDay[] {
  const base = new Date();
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const wd = d.toLocaleDateString("uk-UA", { weekday: "long" });
    const label = i === 0 ? "Сьогодні" : i === 1 ? "Завтра" : cap(wd);
    const dateLabel = d.toLocaleDateString("uk-UA", {
      day: "numeric",
      month: "short",
    });
    return { iso, label, dateLabel };
  });
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---- дрібні хелпери ----
function fmtDate(iso: string): string {
  const today = todayStr();
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const tmr = d.toISOString().slice(0, 10);
  if (iso === today) return "сьогодні";
  if (iso === tmr) return "завтра";
  if (iso < today) return "прострочено";
  return new Date(iso + "T00:00:00").toLocaleDateString("uk-UA", {
    day: "numeric",
    month: "short",
  });
}

function fmtMinutes(m: number): string {
  if (m < 60) return `${m} хв`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} год ${rest} хв` : `${h} год`;
}

function sortTasks(list: Task[]): Task[] {
  return [...list].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

// ---- іконки ----
const Check = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
    <path
      d="M5 13l4 4L19 7"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
const Mic = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
    <rect x="9" y="3" width="6" height="12" rx="3" fill="currentColor" />
    <path
      d="M5 11a7 7 0 0014 0M12 18v3"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      fill="none"
    />
  </svg>
);
const Plus = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
    <path
      d="M12 5v14M5 12h14"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
    />
  </svg>
);
const Close = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <path
      d="M6 6l12 12M18 6L6 18"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);
const Trash = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <path
      d="M6 7h12M9 7V5h6v2m-8 0l1 13h8l1-13"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// Яка рядок-задача зараз "відкрита" свайпом — щоб відкритою була лише одна.
const SwipeCtx = createContext<{
  openId: string | null;
  setOpenId: (id: string | null) => void;
}>({ openId: null, setOpenId: () => {} });

// Свайп ліворуч відкриває кнопку «Видалити». Тап по ній видаляє (з undo у тості).
// touch-action: pan-y віддає вертикальний скрол браузеру, а горизонталь — нам.
function SwipeToDelete({
  id,
  onDelete,
  children,
}: {
  id: string;
  onDelete: () => void;
  children: React.ReactNode;
}) {
  const { openId, setOpenId } = useContext(SwipeCtx);
  const open = openId === id;
  const OPEN_W = 96;
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const horiz = useRef(false);
  const dxRef = useRef(0);

  const translate = dragging ? dx : open ? -OPEN_W : 0;

  function onTouchStart(e: React.TouchEvent) {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    horiz.current = false;
    dxRef.current = open ? -OPEN_W : 0;
    setDragging(true);
    setDx(dxRef.current);
  }
  function onTouchMove(e: React.TouchEvent) {
    const ddx = e.touches[0].clientX - startX.current;
    const ddy = e.touches[0].clientY - startY.current;
    if (!horiz.current) {
      if (Math.abs(ddx) > Math.abs(ddy) && Math.abs(ddx) > 6) {
        horiz.current = true;
      } else {
        return;
      }
    }
    const base = open ? -OPEN_W : 0;
    let next = base + ddx;
    if (next > 0) next = 0;
    if (next < -OPEN_W - 24) next = -OPEN_W - 24;
    dxRef.current = next;
    setDx(next);
  }
  function onTouchEnd() {
    setDragging(false);
    if (horiz.current) {
      setOpenId(dxRef.current <= -OPEN_W / 2 ? id : null);
    } else if (open) {
      setOpenId(null); // тап по відкритому рядку — закрити
    }
  }

  return (
    <div className="swipe-wrap">
      <button
        className="swipe-delete"
        type="button"
        aria-label="Видалити задачу"
        onClick={() => {
          setOpenId(null);
          onDelete();
        }}
      >
        <Trash />
        Видалити
      </button>
      <div
        className="swipe-card"
        style={{
          transform: `translateX(${translate}px)`,
          transition: dragging ? "none" : "transform .18s ease",
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {children}
      </div>
    </div>
  );
}

export default function Home() {
  const {
    tasks,
    loaded,
    addParsed,
    toggleDone,
    scheduleToday,
    moveToInbox,
    moveToDate,
    removeTask,
    removeMany,
    restoreTask,
    carryOverToTomorrow,
  } = useTasks();

  const [tab, setTab] = useState<Tab>("today");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [openSwipeId, setOpenSwipeId] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    action?: { label: string; fn: () => void };
  } | null>(null);

  // Тост сам зникає за 5 c.
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(id);
  }, [toast]);

  const speech = useSpeech((chunk) => {
    setDraft((prev) => (prev ? `${prev} ${chunk}` : chunk));
  });

  const today = todayStr();

  const todayActive = useMemo(
    () =>
      sortTasks(
        tasks.filter(
          (t) =>
            t.status === "planned" && t.scheduledDate && t.scheduledDate <= today
        )
      ),
    [tasks, today]
  );
  const todayDone = useMemo(
    () => tasks.filter((t) => t.status === "done" && t.scheduledDate === today),
    [tasks, today]
  );
  const inbox = useMemo(
    () => sortTasks(tasks.filter((t) => t.status === "inbox")),
    [tasks]
  );

  const week = useMemo(() => buildWeek(), []);
  const tasksByDay = useMemo(() => {
    const map: Record<string, Task[]> = {};
    for (const d of week) map[d.iso] = [];
    for (const t of tasks) {
      if (t.scheduledDate && map[t.scheduledDate]) {
        map[t.scheduledDate].push(t);
      }
    }
    for (const iso of Object.keys(map)) map[iso] = sortTasks(map[iso]);
    return map;
  }, [tasks, week]);

  // Реалістичність плану
  const plannedMinutes = todayActive.reduce(
    (sum, t) => sum + (t.estimateMinutes ?? 0),
    0
  );
  const overloaded = plannedMinutes > WORKDAY_MINUTES;

  // Нагадування про невиконані пріоритетні (P1)
  const unfinishedP1 = todayActive.filter((t) => t.priority === 1);

  // Прострочені (заплановані на минулі дні)
  const overdue = todayActive.filter(
    (t) => t.scheduledDate && t.scheduledDate < today
  );

  function closeCapture() {
    if (speech.listening) speech.stop();
    setCaptureOpen(false);
    setError(null);
  }

  function handleRemove(id: string) {
    const task = tasks.find((t) => t.id === id);
    setOpenSwipeId(null);
    removeTask(id);
    if (task) {
      setToast({
        message: "Задачу видалено",
        action: { label: "Скасувати", fn: () => restoreTask(task) },
      });
    }
  }

  async function handleParse() {
    const text = draft.trim();
    if (!text || loading) return;
    if (speech.listening) speech.stop();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Помилка сервера");
      const parsed = data.tasks ?? [];
      if (parsed.length === 0) {
        setError("Не вдалося виділити задачі. Спробуй сформулювати конкретніше.");
        return;
      }
      const created = addParsed(parsed);
      const n = created.length;
      const ids = created.map((c) => c.id);
      type P = { scheduleToday: boolean; dueDate: string | null };
      const landedToday = (parsed as P[]).filter(
        (p) => p.scheduleToday || p.dueDate === today
      ).length;
      const hasFuture = (parsed as P[]).some(
        (p) => !p.scheduleToday && p.dueDate && p.dueDate > today
      );
      setDraft("");
      setCaptureOpen(false);
      setToast({
        message:
          `Додано ${n} ${plural(n, "задачу", "задачі", "задач")}` +
          (landedToday ? ` · ${landedToday} на сьогодні` : ""),
        action: { label: "Скасувати", fn: () => removeMany(ids) },
      });
      setTab(landedToday > 0 ? "today" : hasFuture ? "week" : "inbox");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Щось пішло не так.");
    } finally {
      setLoading(false);
    }
  }

  function handleCarryOver() {
    const n = carryOverToTomorrow();
    if (n > 0)
      setToast({
        message: `Перенесено ${n} ${plural(n, "задачу", "задачі", "задач")} на завтра.`,
      });
  }

  const dateLabel = new Date().toLocaleDateString("uk-UA", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <SwipeCtx.Provider value={{ openId: openSwipeId, setOpenId: setOpenSwipeId }}>
    <div className="app">
      <div className="header">
        <h1>
          {tab === "today"
            ? "Сьогодні"
            : tab === "week"
            ? "Наступні 7 днів"
            : "Незаплановане"}
        </h1>
        <div className="date">{dateLabel}</div>
      </div>

      <div className="content">
        {!loaded ? null : tab === "today" ? (
          <TodayView
            active={todayActive}
            done={todayDone}
            overloaded={overloaded}
            plannedMinutes={plannedMinutes}
            unfinishedP1={unfinishedP1}
            overdue={overdue}
            onToggle={toggleDone}
            onInbox={moveToInbox}
            onRemove={handleRemove}
            onCarryOver={handleCarryOver}
          />
        ) : tab === "week" ? (
          <WeekView
            week={week}
            tasksByDay={tasksByDay}
            onToggle={toggleDone}
            onRemove={handleRemove}
            onMove={moveToDate}
          />
        ) : (
          <InboxView
            inbox={inbox}
            onSchedule={scheduleToday}
            onToggle={toggleDone}
            onRemove={handleRemove}
          />
        )}
      </div>

      {/* НИЖНЯ НАВІГАЦІЯ */}
      <nav className="tabbar">
        <button
          className={`tab ${tab === "today" ? "active" : ""}`}
          onClick={() => setTab("today")}
          type="button"
        >
          {todayActive.length > 0 && (
            <span className="count">{todayActive.length}</span>
          )}
          <TabIcon kind="today" />
          Сьогодні
        </button>
        <button
          className={`tab ${tab === "week" ? "active" : ""}`}
          onClick={() => setTab("week")}
          type="button"
        >
          <TabIcon kind="week" />
          Тиждень
        </button>
        <button
          className={`tab ${tab === "inbox" ? "active" : ""}`}
          onClick={() => setTab("inbox")}
          type="button"
        >
          {inbox.length > 0 && <span className="count">{inbox.length}</span>}
          <TabIcon kind="inbox" />
          Вхідні
        </button>
      </nav>

      {/* Головна дія — у зоні великого пальця */}
      {!captureOpen && (
        <button
          className="fab"
          onClick={() => setCaptureOpen(true)}
          type="button"
          aria-label="Новий запис — вивалити думки"
        >
          <Plus />
          Записати
        </button>
      )}

      {toast && (
        <div className="toast" role="status">
          <span>{toast.message}</span>
          {toast.action && (
            <button
              className="toast-action"
              type="button"
              onClick={() => {
                toast.action!.fn();
                setToast(null);
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}

      {/* Нижня шторка: brain dump у зоні великого пальця */}
      {captureOpen && (
        <>
          <div className="sheet-backdrop" onClick={closeCapture} />
          <div
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Новий запис"
          >
            <div className="sheet-grabber" />
            <div className="sheet-head">
              <div className="sheet-title">Що в голові?</div>
              <button
                className="sheet-close"
                onClick={closeCapture}
                aria-label="Закрити"
                type="button"
              >
                <Close />
              </button>
            </div>
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Вивали все підряд — AI розкладе по задачах…"
            />
            <div className="capture-actions">
              {speech.supported && (
                <button
                  className={`mic-btn ${speech.listening ? "on" : ""}`}
                  onClick={speech.toggle}
                  aria-label="Голосовий ввід"
                  type="button"
                >
                  <Mic />
                </button>
              )}
              <button
                className="primary-btn"
                onClick={handleParse}
                disabled={loading || !draft.trim()}
                type="button"
              >
                {loading ? <span className="spinner" /> : "Розібрати на задачі"}
              </button>
            </div>
            {speech.listening && (
              <div className="hint">🎙️ Слухаю… говори, потім тапни «Розібрати».</div>
            )}
            {speech.error && <div className="error">{speech.error}</div>}
            {error && <div className="error">{error}</div>}
            {!speech.supported && (
              <div className="hint">
                Голос недоступний у цьому браузері — пиши текстом.
              </div>
            )}
          </div>
        </>
      )}
    </div>
    </SwipeCtx.Provider>
  );
}

// ---- Today ----
function TodayView(props: {
  active: Task[];
  done: Task[];
  overloaded: boolean;
  plannedMinutes: number;
  unfinishedP1: Task[];
  overdue: Task[];
  onToggle: (id: string) => void;
  onInbox: (id: string) => void;
  onRemove: (id: string) => void;
  onCarryOver: () => void;
}) {
  const {
    active,
    done,
    overloaded,
    plannedMinutes,
    unfinishedP1,
    overdue,
    onToggle,
    onInbox,
    onRemove,
    onCarryOver,
  } = props;

  if (active.length === 0 && done.length === 0) {
    return (
      <div className="empty">
        <div className="big">☀️</div>
        <div className="t">План на сьогодні порожній</div>
        <div className="s">
          Тапни «＋ Записати» внизу або познач задачі з «Вхідних» на сьогодні.
        </div>
      </div>
    );
  }

  return (
    <>
      {overdue.length > 0 && (
        <div className="banner alert">
          <span>⏰</span>
          <span>
            {overdue.length} {plural(overdue.length, "задача", "задачі", "задач")}{" "}
            прострочено.{" "}
            <button className="link-btn" onClick={onCarryOver} type="button">
              Перенести на завтра
            </button>
          </span>
        </div>
      )}
      {unfinishedP1.length > 0 && (
        <div className="banner alert">
          <span>🔴</span>
          <span>
            {unfinishedP1.length}{" "}
            {plural(unfinishedP1.length, "пріоритетна задача", "пріоритетні задачі", "пріоритетних задач")}{" "}
            (P1) ще не виконано — почни з них.
          </span>
        </div>
      )}
      {overloaded && (
        <div className="banner warn">
          <span>⚖️</span>
          <span>
            Заплановано ~{fmtMinutes(plannedMinutes)} роботи на 8-годинний день. План
            перевантажений — щось варто перенести.
          </span>
        </div>
      )}

      {active.length > 0 && (
        <div className="summary">
          {active.length} {plural(active.length, "задача", "задачі", "задач")}
          {plannedMinutes > 0 && ` · ~${fmtMinutes(plannedMinutes)}`}
        </div>
      )}

      {active.map((t) => (
        <TaskRow
          key={t.id}
          task={t}
          onToggle={onToggle}
          onRemove={onRemove}
          secondaryAction={{ label: "У вхідні", fn: () => onInbox(t.id) }}
        />
      ))}

      {done.length > 0 && (
        <>
          <div className="section-title">Виконано ({done.length})</div>
          {done.map((t) => (
            <TaskRow key={t.id} task={t} onToggle={onToggle} onRemove={onRemove} />
          ))}
        </>
      )}
    </>
  );
}

// ---- Inbox ----
function InboxView(props: {
  inbox: Task[];
  onSchedule: (id: string) => void;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const { inbox, onSchedule, onToggle, onRemove } = props;
  if (inbox.length === 0) {
    return (
      <div className="empty">
        <div className="big">📥</div>
        <div className="t">Вхідні порожні</div>
        <div className="s">Усе розібрано. Нові думки — кнопкою «＋ Записати» внизу.</div>
      </div>
    );
  }
  return (
    <>
      <div className="summary">
        Задачі без дня. Признач на сьогодні або залиш на потім.
      </div>
      {inbox.map((t) => (
        <TaskRow
          key={t.id}
          task={t}
          onToggle={onToggle}
          onRemove={onRemove}
          secondaryAction={{ label: "→ Сьогодні", fn: () => onSchedule(t.id) }}
          primaryHighlight
        />
      ))}
    </>
  );
}

// ---- Week ----
function WeekView(props: {
  week: WeekDay[];
  tasksByDay: Record<string, Task[]>;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, date: string) => void;
}) {
  const { week, tasksByDay, onToggle, onRemove, onMove } = props;
  const total = week.reduce((s, d) => s + tasksByDay[d.iso].length, 0);

  if (total === 0) {
    return (
      <div className="empty">
        <div className="big">🗓️</div>
        <div className="t">Тиждень порожній</div>
        <div className="s">
          Заплануй задачі на сьогодні або признач їх на потрібний день.
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="summary">Розклад на 7 днів. Задачі можна переносити між днями.</div>
      {week.map((day) => {
        const list = tasksByDay[day.iso];
        const active = list.filter((t) => t.status !== "done");
        const mins = active.reduce((s, t) => s + (t.estimateMinutes ?? 0), 0);
        return (
          <div key={day.iso} className="week-day">
            <div className="week-day-head">
              <span>
                {day.label} <span className="wd-date">· {day.dateLabel}</span>
              </span>
              {list.length > 0 && (
                <span className="wd-count">
                  {list.length}
                  {mins > 0 ? ` · ~${fmtMinutes(mins)}` : ""}
                </span>
              )}
            </div>
            {list.length === 0 ? (
              <div className="week-empty">Вільно</div>
            ) : (
              list.map((t) => (
                <WeekTaskRow
                  key={t.id}
                  task={t}
                  week={week}
                  onToggle={onToggle}
                  onRemove={onRemove}
                  onMove={onMove}
                />
              ))
            )}
          </div>
        );
      })}
    </>
  );
}

function WeekTaskRow(props: {
  task: Task;
  week: WeekDay[];
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, date: string) => void;
}) {
  const { task: t, week, onToggle, onRemove, onMove } = props;
  const done = t.status === "done";
  const pClass = t.priority <= 3 ? `p${t.priority}` : "";
  return (
    <SwipeToDelete id={t.id} onDelete={() => onRemove(t.id)}>
      <div className={`task week-task ${done ? "completed" : ""}`}>
        <button
          className={`checkbox ${done ? "done" : pClass}`}
          onClick={() => onToggle(t.id)}
          aria-label={done ? "Позначити невиконаною" : "Виконати"}
          type="button"
        >
          {done && <Check />}
        </button>
        <div className="task-body">
          <div className="task-title">{t.title}</div>
          <div className="task-meta">
            {t.priority <= 3 && (
              <span className={`meta-chip p${t.priority}`}>
                {PRIORITY_META[t.priority as Priority].short}
              </span>
            )}
            {t.estimateMinutes != null && (
              <span className="meta-chip">🕐 {fmtMinutes(t.estimateMinutes)}</span>
            )}
            {t.tags.map((tag) => (
              <span className="tag" key={tag}>
                #{tag}
              </span>
            ))}
          </div>
        </div>
        <div className="task-side">
          <select
            className="day-select"
            value={t.scheduledDate ?? ""}
            onChange={(e) => onMove(t.id, e.target.value)}
            aria-label="Перенести на день"
          >
            {week.map((d) => (
              <option key={d.iso} value={d.iso}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </SwipeToDelete>
  );
}

// ---- рядок задачі ----
function TaskRow(props: {
  task: Task;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  secondaryAction?: { label: string; fn: () => void };
  primaryHighlight?: boolean;
}) {
  const { task: t, onToggle, onRemove, secondaryAction, primaryHighlight } = props;
  const done = t.status === "done";
  const pClass = t.priority <= 3 ? `p${t.priority}` : "";
  return (
    <SwipeToDelete id={t.id} onDelete={() => onRemove(t.id)}>
      <div className={`task ${done ? "completed" : ""}`}>
        <button
          className={`checkbox ${done ? "done" : pClass}`}
          onClick={() => onToggle(t.id)}
          aria-label={done ? "Позначити невиконаною" : "Виконати"}
          type="button"
        >
          {done && <Check />}
        </button>

        <div className="task-body">
          <div className="task-title">{t.title}</div>
          <div className="task-meta">
            {t.priority <= 3 && (
              <span className={`meta-chip p${t.priority}`}>
                {PRIORITY_META[t.priority as Priority].short}
              </span>
            )}
            {t.estimateMinutes != null && (
              <span className="meta-chip">🕐 {fmtMinutes(t.estimateMinutes)}</span>
            )}
            {t.dueDate && (
              <span
                className={`meta-chip ${t.dueDate <= todayStr() ? "due" : ""}`}
              >
                📅 {fmtDate(t.dueDate)}
              </span>
            )}
            {t.tags.map((tag) => (
              <span className="tag" key={tag}>
                #{tag}
              </span>
            ))}
          </div>
        </div>

        {secondaryAction && !done && (
          <div className="task-side">
            <button
              className={`row-action ${primaryHighlight ? "accent" : ""}`}
              onClick={secondaryAction.fn}
              type="button"
            >
              {secondaryAction.label}
            </button>
          </div>
        )}
      </div>
    </SwipeToDelete>
  );
}

function TabIcon({ kind }: { kind: "today" | "week" | "inbox" }) {
  if (kind === "today")
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <rect
          x="3"
          y="4"
          width="18"
          height="17"
          rx="3"
          stroke="currentColor"
          strokeWidth="2"
        />
        <path
          d="M3 9h18M8 2v4M16 2v4"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <rect x="6.5" y="12" width="4" height="4" rx="1" fill="currentColor" />
      </svg>
    );
  if (kind === "week")
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <rect
          x="3"
          y="4"
          width="18"
          height="17"
          rx="3"
          stroke="currentColor"
          strokeWidth="2"
        />
        <path
          d="M3 9h18M8 2v4M16 2v4M7 13h10M7 17h6"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    );
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path
        d="M4 13l2-8h12l2 8M4 13v5a1 1 0 001 1h14a1 1 0 001-1v-5M4 13h5l1 2h4l1-2h5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// множина українською: 1 задача / 2-4 задачі / 5+ задач
function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}
