"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTasks, useSettings, todayStr, tomorrowStr } from "@/lib/store";
import { isoLocal } from "@/lib/date";
import { useSpeech } from "@/lib/useSpeech";
import {
  buildTimeline,
  fmtTime,
  toMin,
  LUNCH_START,
  LUNCH_MIN,
  type Timeline,
  type BusyBlock,
  type WorkdayOptions,
} from "@/lib/schedule";
import { downloadIcs } from "@/lib/ics";
import { plural } from "@/lib/text";
import {
  PRIORITY_META,
  type Task,
  type Priority,
  type ParsedTask,
} from "@/lib/types";

type Tab = "today" | "calendar" | "inbox";

// Приклад швидкого старту на вітальному екрані — збігається з демо-сценарієм.
const EXAMPLE_DUMP =
  "Підготувати квартальний звіт до пʼятниці, дзвінок із клієнтом о 15:00, сходити в спортзал, відповісти на пошту";

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---- дрібні хелпери ----
function fmtDate(iso: string): string {
  const today = todayStr();
  const tmr = tomorrowStr();
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

// Скільки чекаємо на відповідь AI, перш ніж здатися (мс). Без цього при
// «завислій» (не впалій) мережі спінер крутився б вічно.
const REQUEST_TIMEOUT_MS = 20000;

// POST JSON з таймаутом і людськими повідомленнями про офлайн/тайм-аут.
async function postJson<T>(url: string, payload: unknown): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new Error("Немає зʼєднання з інтернетом. Перевір мережу й спробуй ще.");
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Помилка сервера");
    return data as T;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error("Сервіс не відповів вчасно. Спробуй ще раз.");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
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
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
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
const Gear = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
    <path
      d="M12 2l1.6 2.6 3-.6.4 3 2.6 1.6-1.4 2.7 1.4 2.7-2.6 1.6-.4 3-3-.6L12 22l-1.6-2.6-3 .6-.4-3L4.4 15.4 5.8 12.7 4.4 10l2.6-1.6.4-3 3 .6L12 2z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
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
    updateTask,
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
  const [detailId, setDetailId] = useState<string | null>(null);
  const [openSwipeId, setOpenSwipeId] = useState<string | null>(null);
  const { settings, update: updateSettings } = useSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Перепланування з обмеженнями (сесійне — не зберігаємо в localStorage).
  const [busyBlocks, setBusyBlocks] = useState<BusyBlock[]>([]);
  const [replanOpen, setReplanOpen] = useState(false);
  const [replanText, setReplanText] = useState("");
  const [replanLoading, setReplanLoading] = useState(false);
  const [replanError, setReplanError] = useState<string | null>(null);
  // Календар: зсув місяця від поточного (0 = цей місяць) і обраний день.
  const [monthOffset, setMonthOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState<string>(todayStr());
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
  // «Виконано» = усе, що завершили саме СЬОГОДНІ (за completedAt), незалежно
  // від того, на який день задача була запланована — інакше виконана
  // прострочена задача зникала б з обох секцій.
  const todayDone = useMemo(
    () =>
      tasks.filter(
        (t) =>
          t.status === "done" &&
          t.completedAt &&
          isoLocal(new Date(t.completedAt)) === today
      ),
    [tasks, today]
  );
  const inbox = useMemo(
    () => sortTasks(tasks.filter((t) => t.status === "inbox")),
    [tasks]
  );
  const detailTask = useMemo(
    () => tasks.find((t) => t.id === detailId) ?? null,
    [tasks, detailId]
  );

  // Календар: усі задачі по датах (для крапок/лічильників у сітці місяця).
  const tasksByDate = useMemo(() => {
    const map: Record<string, Task[]> = {};
    for (const t of tasks) {
      if (!t.scheduledDate) continue;
      (map[t.scheduledDate] ??= []).push(t);
    }
    for (const iso of Object.keys(map)) map[iso] = sortTasks(map[iso]);
    return map;
  }, [tasks]);

  // Налаштування робочого дня → опції планувальника (спільні для Today і Calendar).
  const workOpts: WorkdayOptions = useMemo(
    () => ({ dayStart: toMin(settings.dayStart), dayEnd: toMin(settings.dayEnd) }),
    [settings.dayStart, settings.dayEnd]
  );
  // Скільки реально годин у робочому дні (мінус обід, якщо в межах) — для банера.
  const workLabel = useMemo(() => {
    const ds = toMin(settings.dayStart);
    const de = Math.max(toMin(settings.dayEnd), ds + 30);
    const lunch = Math.max(
      0,
      Math.min(LUNCH_START + LUNCH_MIN, de) - Math.max(LUNCH_START, ds)
    );
    const cap = Math.max(0, de - ds - lunch);
    return { minutes: cap, range: `${settings.dayStart}–${settings.dayEnd}` };
  }, [settings.dayStart, settings.dayEnd]);

  // Таймлайн дня «за енергією» + реалістичність (клієнтський, без AI).
  const timeline = useMemo(
    () => buildTimeline(todayActive, busyBlocks, workOpts),
    [todayActive, busyBlocks, workOpts]
  );
  const plannedMinutes = timeline.plannedMinutes;
  const overloaded = timeline.overflow.length > 0;

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
    // Гард від «сміттєвого»/надто короткого вводу — щоб не смикати AI даремно.
    if (text.replace(/\s+/g, "").length < 3) {
      setError("Напиши трохи більше — хоча б одну задачу.");
      return;
    }
    if (speech.listening) speech.stop();
    setLoading(true);
    setError(null);
    try {
      const data = await postJson<{ tasks?: ParsedTask[] }>("/api/parse", {
        text,
        today,
      });
      const parsed: ParsedTask[] = data.tasks ?? [];
      if (parsed.length === 0) {
        setError("Не вдалося виділити задачі. Спробуй сформулювати конкретніше.");
        return;
      }

      // Дедуплікація: нормалізуємо назву й відкидаємо збіги з наявними
      // задачами та повтори всередині самої пачки. Рятує демо від дублів,
      // якщо той самий дамп розібрати двічі або AI поверне однакові пункти.
      const norm = (s: string) =>
        s
          .toLowerCase()
          .replace(/\s+/g, " ")
          .replace(/[.,!?;:—–-]+$/u, "")
          .trim();
      const existing = new Set(tasks.map((t) => norm(t.title)));
      const seen = new Set<string>();
      const fresh: ParsedTask[] = [];
      let dupes = 0;
      for (const p of parsed) {
        const key = norm(p.title);
        if (!key || existing.has(key) || seen.has(key)) {
          dupes++;
          continue;
        }
        seen.add(key);
        fresh.push(p);
      }
      if (fresh.length === 0) {
        setError(
          `Ці задачі вже є у списку (${dupes} ${plural(dupes, "дублікат", "дублікати", "дублікатів")}). Додай щось нове.`
        );
        return;
      }

      const created = addParsed(fresh);
      const n = created.length;
      const ids = created.map((c) => c.id);
      const landedToday = fresh.filter(
        (p) => p.scheduleToday || p.dueDate === today
      ).length;
      const hasFuture = fresh.some(
        (p) => !p.scheduleToday && p.dueDate && p.dueDate > today
      );
      setDraft("");
      setCaptureOpen(false);
      setToast({
        message:
          `Додано ${n} ${plural(n, "задачу", "задачі", "задач")}` +
          (landedToday ? ` · ${landedToday} на сьогодні` : "") +
          (dupes > 0
            ? ` · пропущено ${dupes} ${plural(dupes, "дублікат", "дублікати", "дублікатів")}`
            : ""),
        action: { label: "Скасувати", fn: () => removeMany(ids) },
      });
      setTab(landedToday > 0 ? "today" : hasFuture ? "calendar" : "inbox");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Щось пішло не так.");
    } finally {
      setLoading(false);
    }
  }

  function handleMoveTomorrow(id: string) {
    moveToDate(id, tomorrowStr());
    setToast({ message: "Перенесено на завтра." });
  }

  async function handleReplan() {
    const text = replanText.trim();
    if (!text || replanLoading) return;
    setReplanLoading(true);
    setReplanError(null);
    try {
      const data = await postJson<{ busy?: BusyBlock[] }>("/api/replan", {
        text,
      });
      const busy: BusyBlock[] = data.busy ?? [];
      if (busy.length === 0) {
        setReplanError("Не вдалося зрозуміти обмеження. Напр.: «зустрічі 14–16».");
        return;
      }
      setBusyBlocks(busy);
      setReplanOpen(false);
      setReplanText("");
      setToast({
        message: `План перебудовано навколо ${busy.length} ${plural(busy.length, "обмеження", "обмежень", "обмежень")}.`,
      });
    } catch (e) {
      setReplanError(e instanceof Error ? e.message : "Щось пішло не так.");
    } finally {
      setReplanLoading(false);
    }
  }

  function clearBusy() {
    setBusyBlocks([]);
    setToast({ message: "Обмеження скинуто." });
  }

  function handleExport() {
    const n = downloadIcs(timeline.slots, today);
    setToast({
      message:
        n > 0
          ? `Експортовано ${n} ${plural(n, "подію", "події", "подій")} у файл .ics.`
          : "Немає запланованих задач для експорту.",
    });
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
        <div className="header-main">
          <h1>
            {tab === "today"
              ? "Сьогодні"
              : tab === "calendar"
              ? "Календар"
              : "Незаплановане"}
          </h1>
          <div className="date">{dateLabel}</div>
        </div>
        <button
          className="settings-btn"
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-label="Налаштування робочого дня"
        >
          <Gear />
        </button>
      </div>

      <div className="content">
        {!loaded ? null : tasks.length === 0 && tab === "today" ? (
          <Welcome
            onStart={() => setCaptureOpen(true)}
            onTryExample={() => {
              setDraft(EXAMPLE_DUMP);
              setCaptureOpen(true);
            }}
          />
        ) : tab === "today" ? (
          <TodayView
            timeline={timeline}
            done={todayDone}
            overloaded={overloaded}
            plannedMinutes={plannedMinutes}
            workLabel={workLabel}
            unfinishedP1={unfinishedP1}
            overdue={overdue}
            onToggle={toggleDone}
            onInbox={moveToInbox}
            onRemove={handleRemove}
            onCarryOver={handleCarryOver}
            onMoveTomorrow={handleMoveTomorrow}
            onOpen={setDetailId}
            onReplan={() => {
              setReplanError(null);
              setReplanOpen(true);
            }}
            onClearBusy={clearBusy}
            onExport={handleExport}
          />
        ) : tab === "calendar" ? (
          <CalendarView
            tasksByDate={tasksByDate}
            workOpts={workOpts}
            monthOffset={monthOffset}
            setMonthOffset={setMonthOffset}
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            onToggle={toggleDone}
            onRemove={handleRemove}
            onOpen={setDetailId}
          />
        ) : (
          <InboxView
            inbox={inbox}
            onSchedule={scheduleToday}
            onToggle={toggleDone}
            onRemove={handleRemove}
            onOpen={setDetailId}
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
          className={`tab ${tab === "calendar" ? "active" : ""}`}
          onClick={() => setTab("calendar")}
          type="button"
        >
          <TabIcon kind="calendar" />
          Календар
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

      {/* Шторка налаштувань робочого дня */}
      {settingsOpen && (
        <>
          <div
            className="sheet-backdrop"
            onClick={() => setSettingsOpen(false)}
          />
          <div
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Налаштування робочого дня"
          >
            <div className="sheet-grabber" />
            <div className="sheet-head">
              <div className="sheet-title">Робочий день</div>
              <button
                className="sheet-close"
                onClick={() => setSettingsOpen(false)}
                aria-label="Закрити"
                type="button"
              >
                <Close />
              </button>
            </div>
            <div className="hint" style={{ marginBottom: 8 }}>
              Години, у межах яких AI планує задачі. Обід (13:00–14:00)
              враховується автоматично, якщо потрапляє в цей проміжок.
            </div>
            <div className="detail-grid">
              <div>
                <div className="detail-label">Початок</div>
                <input
                  type="time"
                  className="detail-input"
                  value={settings.dayStart}
                  onChange={(e) =>
                    updateSettings({ dayStart: e.target.value || "09:00" })
                  }
                  aria-label="Початок робочого дня"
                />
              </div>
              <div>
                <div className="detail-label">Кінець</div>
                <input
                  type="time"
                  className="detail-input"
                  value={settings.dayEnd}
                  onChange={(e) =>
                    updateSettings({ dayEnd: e.target.value || "18:00" })
                  }
                  aria-label="Кінець робочого дня"
                />
              </div>
            </div>
            <div className="settings-summary">
              Доступно для планування: <b>~{fmtMinutes(workLabel.minutes)}</b> (
              {workLabel.range})
            </div>
            <div className="capture-actions">
              <button
                className="primary-btn"
                type="button"
                onClick={() => setSettingsOpen(false)}
              >
                Готово
              </button>
            </div>
          </div>
        </>
      )}

      {/* Шторка «перепланувати з обмеженнями» */}
      {replanOpen && (
        <>
          <div
            className="sheet-backdrop"
            onClick={() => setReplanOpen(false)}
          />
          <div
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Перепланувати з обмеженнями"
          >
            <div className="sheet-grabber" />
            <div className="sheet-head">
              <div className="sheet-title">Перепланувати з обмеженнями</div>
              <button
                className="sheet-close"
                onClick={() => setReplanOpen(false)}
                aria-label="Закрити"
                type="button"
              >
                <Close />
              </button>
            </div>
            <div className="hint" style={{ marginBottom: 8 }}>
              Опиши, коли ти зайнятий — AI перебудує план навколо цього.
            </div>
            <textarea
              autoFocus
              value={replanText}
              onChange={(e) => setReplanText(e.target.value)}
              placeholder="Напр.: у мене зустрічі 14–16, і до 10 не можу…"
            />
            <div className="capture-actions">
              <button
                className="primary-btn"
                onClick={handleReplan}
                disabled={replanLoading || !replanText.trim()}
                type="button"
              >
                {replanLoading ? (
                  <span className="spinner" />
                ) : (
                  "Перебудувати план"
                )}
              </button>
            </div>
            {replanError && <div className="error">{replanError}</div>}
          </div>
        </>
      )}

      {/* Шторка деталей задачі */}
      {detailTask && (
        <TaskDetail
          task={detailTask}
          onClose={() => setDetailId(null)}
          onUpdate={(patch) => updateTask(detailTask.id, patch)}
          onToggleDone={() => toggleDone(detailTask.id)}
          onDelete={() => {
            setDetailId(null);
            handleRemove(detailTask.id);
          }}
        />
      )}
    </div>
    </SwipeCtx.Provider>
  );
}

// ---- Вітальний екран (перше відкриття, жодної задачі) ----
function Welcome(props: { onStart: () => void; onTryExample: () => void }) {
  const { onStart, onTryExample } = props;
  return (
    <div className="welcome">
      <div className="welcome-badge">✨ AI-планер дня</div>
      <h2 className="welcome-title">Вивали все з голови — решту зробить AI</h2>
      <p className="welcome-sub">
        Надиктуй або напиши все підряд, що крутиться в голові. AI сам розкладе це
        на задачі: пріоритетність, час, дедлайни й теги — та збере план на день.
      </p>

      <div className="welcome-steps">
        <div className="welcome-step">
          <span className="ws-num">1</span>
          <span>Вивали думки одним потоком</span>
        </div>
        <div className="welcome-step">
          <span className="ws-num">2</span>
          <span>AI перетворює хаос на задачі</span>
        </div>
        <div className="welcome-step">
          <span className="ws-num">3</span>
          <span>Отримуєш готовий план на день</span>
        </div>
      </div>

      <button className="welcome-cta" type="button" onClick={onStart}>
        <Plus />
        Записати перші думки
      </button>

      <button className="welcome-example" type="button" onClick={onTryExample}>
        <span className="we-label">Спробувати на прикладі</span>
        <span className="we-text">«{EXAMPLE_DUMP}»</span>
      </button>
    </div>
  );
}

// ---- Деталі задачі: нотатки, підзадачі, пріоритет, час ----
function subId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `s_${Math.random().toString(36).slice(2)}`;
}

function TaskDetail(props: {
  task: Task;
  onClose: () => void;
  onUpdate: (patch: Partial<Task>) => void;
  onToggleDone: () => void;
  onDelete: () => void;
}) {
  const { task: t, onClose, onUpdate, onToggleDone, onDelete } = props;
  const [newSub, setNewSub] = useState("");
  const done = t.status === "done";
  const subDone = t.subtasks.filter((s) => s.done).length;

  function addSub() {
    const title = newSub.trim();
    if (!title) return;
    onUpdate({
      subtasks: [...t.subtasks, { id: subId(), title, done: false }],
    });
    setNewSub("");
  }
  function toggleSub(id: string) {
    onUpdate({
      subtasks: t.subtasks.map((s) =>
        s.id === id ? { ...s, done: !s.done } : s
      ),
    });
  }
  function removeSub(id: string) {
    onUpdate({ subtasks: t.subtasks.filter((s) => s.id !== id) });
  }

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div
        className="sheet detail-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Деталі задачі"
      >
        <div className="sheet-grabber" />
        <div className="sheet-head">
          <div className="sheet-title">Деталі задачі</div>
          <button
            className="sheet-close"
            onClick={onClose}
            aria-label="Закрити"
            type="button"
          >
            <Close />
          </button>
        </div>

        <div className="detail-scroll">
          <input
            className="detail-title"
            value={t.title}
            onChange={(e) => onUpdate({ title: e.target.value })}
            placeholder="Назва задачі"
            aria-label="Назва задачі"
          />

          <div className="detail-label">Пріоритетність</div>
          <div className="prio-row">
            {([1, 2, 3, 4] as Priority[]).map((p) => (
              <button
                key={p}
                type="button"
                className={`prio-btn p${p} ${t.priority === p ? "on" : ""}`}
                onClick={() => onUpdate({ priority: p })}
              >
                {PRIORITY_META[p].short}
              </button>
            ))}
          </div>

          <div className="detail-label">День</div>
          <input
            type="date"
            className="detail-input"
            value={t.scheduledDate ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              onUpdate(
                v
                  ? {
                      scheduledDate: v,
                      status: t.status === "done" ? "done" : "planned",
                    }
                  : { scheduledDate: null, status: "inbox" }
              );
            }}
            aria-label="День задачі"
          />

          <div className="detail-grid">
            <div>
              <div className="detail-label">Час початку</div>
              <input
                type="time"
                className="detail-input"
                value={t.startTime ?? ""}
                onChange={(e) =>
                  onUpdate({ startTime: e.target.value || null })
                }
                aria-label="Час початку"
              />
            </div>
            <div>
              <div className="detail-label">Тривалість, хв</div>
              <input
                type="number"
                min={0}
                step={5}
                className="detail-input"
                value={t.estimateMinutes ?? ""}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  onUpdate({ estimateMinutes: n > 0 ? n : null });
                }}
                placeholder="—"
                aria-label="Тривалість у хвилинах"
              />
            </div>
          </div>

          <div className="detail-label">
            Підзадачі{" "}
            {t.subtasks.length > 0 && (
              <span className="sub-count">
                {subDone}/{t.subtasks.length}
              </span>
            )}
          </div>
          <div className="sub-list">
            {t.subtasks.map((s) => (
              <div className="sub-item" key={s.id}>
                <button
                  type="button"
                  className={`checkbox small ${s.done ? "done" : ""}`}
                  onClick={() => toggleSub(s.id)}
                  aria-label={s.done ? "Зняти відмітку" : "Виконати підзадачу"}
                >
                  {s.done && <Check />}
                </button>
                <span className={`sub-title ${s.done ? "done" : ""}`}>
                  {s.title}
                </span>
                <button
                  type="button"
                  className="sub-remove"
                  onClick={() => removeSub(s.id)}
                  aria-label="Видалити підзадачу"
                >
                  <Close />
                </button>
              </div>
            ))}
            <div className="sub-add">
              <input
                value={newSub}
                onChange={(e) => setNewSub(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addSub();
                }}
                placeholder="Додати підзадачу…"
                aria-label="Нова підзадача"
              />
              <button
                type="button"
                className="sub-add-btn"
                onClick={addSub}
                disabled={!newSub.trim()}
                aria-label="Додати"
              >
                <Plus />
              </button>
            </div>
          </div>

          <div className="detail-label">Нотатки</div>
          <textarea
            className="detail-notes"
            value={t.notes}
            onChange={(e) => onUpdate({ notes: e.target.value })}
            placeholder="Деталі, посилання, контекст…"
            aria-label="Нотатки"
          />

          <div className="detail-footer">
            <button
              type="button"
              className={`detail-done ${done ? "on" : ""}`}
              onClick={onToggleDone}
            >
              {done ? "↩ Повернути в роботу" : "✓ Виконано"}
            </button>
            <button type="button" className="detail-delete" onClick={onDelete}>
              <Trash />
              Видалити
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ---- Today ----
function TodayView(props: {
  timeline: Timeline;
  done: Task[];
  overloaded: boolean;
  plannedMinutes: number;
  workLabel: { minutes: number; range: string };
  unfinishedP1: Task[];
  overdue: Task[];
  onToggle: (id: string) => void;
  onInbox: (id: string) => void;
  onRemove: (id: string) => void;
  onCarryOver: () => void;
  onMoveTomorrow: (id: string) => void;
  onOpen: (id: string) => void;
  onReplan: () => void;
  onClearBusy: () => void;
  onExport: () => void;
}) {
  const {
    timeline,
    done,
    overloaded,
    plannedMinutes,
    workLabel,
    unfinishedP1,
    overdue,
    onToggle,
    onInbox,
    onRemove,
    onCarryOver,
    onMoveTomorrow,
    onOpen,
    onReplan,
    onClearBusy,
    onExport,
  } = props;

  const scheduled = timeline.slots.filter((s) => !s.overflow);
  const overflow = timeline.overflow;
  const busy = timeline.busy;
  const activeCount = scheduled.length + overflow.length;

  // Хронологічний список для рендеру: задачі + зайняті інтервали разом.
  const rows: Array<
    | { kind: "task"; start: number; slot: (typeof scheduled)[number] }
    | { kind: "busy"; start: number; block: (typeof busy)[number] }
  > = [
    ...scheduled.map((slot) => ({
      kind: "task" as const,
      start: slot.startMin,
      slot,
    })),
    ...busy.map((block) => ({
      kind: "busy" as const,
      start: block.startMin,
      block,
    })),
  ].sort((a, b) => a.start - b.start);

  if (activeCount === 0 && done.length === 0) {
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
            (висока пріоритетність) ще не виконано — почни з них.
          </span>
        </div>
      )}
      {overloaded && (
        <div className="banner warn">
          <span>⚖️</span>
          <span>
            Заплановано ~{fmtMinutes(plannedMinutes)}, а робочий день —{" "}
            {workLabel.range} (~{fmtMinutes(workLabel.minutes)}). {overflow.length}{" "}
            {plural(overflow.length, "задача не вміщується", "задачі не вміщуються", "задач не вміщуються")}
            . Перенеси нижче виділені на завтра.
          </span>
        </div>
      )}

      {activeCount > 0 && (
        <div className="summary">
          {activeCount} {plural(activeCount, "задача", "задачі", "задач")}
          {plannedMinutes > 0 && ` · ~${fmtMinutes(plannedMinutes)}`} · план за
          енергією: важче — на ранок
        </div>
      )}

      {activeCount > 0 && (
        <div className="replan-bar">
          <button type="button" className="replan-btn" onClick={onReplan}>
            🔧 Перепланувати з обмеженнями
          </button>
          {busy.length > 0 && (
            <div className="busy-chips">
              {busy.map((b, i) => (
                <span className="busy-chip" key={i}>
                  {b.label} {fmtTime(b.startMin)}–{fmtTime(b.endMin)}
                </span>
              ))}
              <button type="button" className="busy-clear" onClick={onClearBusy}>
                Скинути
              </button>
            </div>
          )}
        </div>
      )}

      {rows.map((row, i) =>
        row.kind === "task" ? (
          <TaskRow
            key={row.slot.task.id}
            task={row.slot.task}
            timeLabel={`${fmtTime(row.slot.startMin)}–${fmtTime(row.slot.endMin)}`}
            fixed={row.slot.fixed}
            onToggle={onToggle}
            onRemove={onRemove}
            onOpen={onOpen}
            secondaryAction={{
              label: "У вхідні",
              fn: () => onInbox(row.slot.task.id),
            }}
          />
        ) : (
          <div className="busy-row" key={`busy-${i}-${row.start}`}>
            <div className="busy-row-time">
              {fmtTime(row.block.startMin)}–{fmtTime(row.block.endMin)}
            </div>
            <div className="busy-row-label">🔒 {row.block.label}</div>
          </div>
        )
      )}

      {overflow.length > 0 && (
        <>
          <div className="section-title overflow-title">
            Не вміщується в робочий день. Шкода, що в добі всього 24 години
          </div>
          {overflow.map((s) => (
            <TaskRow
              key={s.task.id}
              task={s.task}
              overflow
              onToggle={onToggle}
              onRemove={onRemove}
              onOpen={onOpen}
              secondaryAction={{
                label: "→ Завтра",
                fn: () => onMoveTomorrow(s.task.id),
              }}
              primaryHighlight
            />
          ))}
        </>
      )}

      {done.length > 0 && (
        <>
          <div className="section-title">Виконано ({done.length})</div>
          {done.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              onToggle={onToggle}
              onRemove={onRemove}
              onOpen={onOpen}
            />
          ))}
        </>
      )}

      {activeCount > 0 && (
        <button type="button" className="export-btn" onClick={onExport}>
          📅 Експортувати план у календар (.ics)
        </button>
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
  onOpen: (id: string) => void;
}) {
  const { inbox, onSchedule, onToggle, onRemove, onOpen } = props;
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
          onOpen={onOpen}
          secondaryAction={{ label: "→ Сьогодні", fn: () => onSchedule(t.id) }}
          primaryHighlight
        />
      ))}
    </>
  );
}

// ---- Календар (місячна сітка + план обраного дня) ----
const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];

function CalendarView(props: {
  tasksByDate: Record<string, Task[]>;
  workOpts: WorkdayOptions;
  monthOffset: number;
  setMonthOffset: (n: number) => void;
  selectedDate: string;
  setSelectedDate: (iso: string) => void;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const {
    tasksByDate,
    workOpts,
    monthOffset,
    setMonthOffset,
    selectedDate,
    setSelectedDate,
    onToggle,
    onRemove,
    onOpen,
  } = props;
  const today = todayStr();

  // Місяць, що показуємо (0 = поточний).
  const now = new Date();
  const view = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const year = view.getFullYear();
  const month = view.getMonth();
  const monthTitle = cap(
    view.toLocaleDateString("uk-UA", { month: "long", year: "numeric" })
  );

  // Сітка 6×7, тиждень із понеділка (включно з «хвостами» сусідніх місяців).
  const firstWeekday = (view.getDay() + 6) % 7;
  const gridStart = new Date(year, month, 1 - firstWeekday);
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });

  // План обраного дня — той самий таймлайн «за енергією», що й на Сьогодні.
  const dayList = tasksByDate[selectedDate] ?? [];
  const doneTasks = dayList.filter((t) => t.status === "done");
  const activeTasks = dayList.filter((t) => t.status !== "done");
  const tl = buildTimeline(activeTasks, [], workOpts);
  const scheduled = tl.slots.filter((s) => !s.overflow);
  const timeMap = new Map<string, { label: string; fixed: boolean }>();
  for (const s of scheduled) {
    timeMap.set(s.task.id, {
      label: `${fmtTime(s.startMin)}–${fmtTime(s.endMin)}`,
      fixed: s.fixed,
    });
  }
  const overflowIds = new Set(tl.overflow.map((s) => s.task.id));
  const ordered = [
    ...scheduled.map((s) => s.task),
    ...tl.overflow.map((s) => s.task),
    ...doneTasks,
  ];
  const selLabel = cap(
    new Date(selectedDate + "T00:00:00").toLocaleDateString("uk-UA", {
      weekday: "long",
      day: "numeric",
      month: "long",
    })
  );

  return (
    <>
      <div className="cal-head">
        <button
          className="cal-nav"
          type="button"
          onClick={() => setMonthOffset(monthOffset - 1)}
          aria-label="Попередній місяць"
        >
          ‹
        </button>
        <div className="cal-title">{monthTitle}</div>
        <button
          className="cal-nav"
          type="button"
          onClick={() => setMonthOffset(monthOffset + 1)}
          aria-label="Наступний місяць"
        >
          ›
        </button>
      </div>

      <div className="cal-weekdays">
        {WEEKDAY_LABELS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>

      <div className="cal-grid">
        {cells.map((d, i) => {
          const iso = isoLocal(d);
          const inMonth = d.getMonth() === month;
          const dayTasks = (tasksByDate[iso] ?? []).filter(
            (t) => t.status !== "done"
          );
          const isToday = iso === today;
          const isSel = iso === selectedDate;
          return (
            <button
              key={i}
              type="button"
              className={`cal-cell ${inMonth ? "" : "out"} ${
                isToday ? "today" : ""
              } ${isSel ? "sel" : ""}`}
              onClick={() => setSelectedDate(iso)}
              aria-label={`${d.getDate()}, задач: ${dayTasks.length}`}
            >
              <span className="cal-num">{d.getDate()}</span>
              {dayTasks.length > 0 && (
                <span className="cal-dots">
                  {dayTasks.slice(0, 3).map((t) => (
                    <span
                      key={t.id}
                      className={`cal-dot p${t.priority <= 3 ? t.priority : 4}`}
                    />
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="section-title cal-day-title">{selLabel}</div>
      {ordered.length === 0 ? (
        <div className="cal-day-empty">
          Нічого не заплановано. Тапни «＋ Записати», щоб додати.
        </div>
      ) : (
        ordered.map((t) => (
          <TaskRow
            key={t.id}
            task={t}
            timeLabel={timeMap.get(t.id)?.label}
            fixed={timeMap.get(t.id)?.fixed}
            overflow={overflowIds.has(t.id)}
            onToggle={onToggle}
            onRemove={onRemove}
            onOpen={onOpen}
          />
        ))
      )}
    </>
  );
}

// ---- рядок задачі ----
function TaskRow(props: {
  task: Task;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onOpen?: (id: string) => void;
  timeLabel?: string;
  fixed?: boolean;
  overflow?: boolean;
  secondaryAction?: { label: string; fn: () => void };
  primaryHighlight?: boolean;
}) {
  const {
    task: t,
    onToggle,
    onRemove,
    onOpen,
    timeLabel,
    fixed,
    overflow,
    secondaryAction,
    primaryHighlight,
  } = props;
  const done = t.status === "done";
  const pClass = t.priority <= 3 ? `p${t.priority}` : "";
  const subDone = t.subtasks.filter((s) => s.done).length;
  return (
    <SwipeToDelete id={t.id} onDelete={() => onRemove(t.id)}>
      <div className={`task ${done ? "completed" : ""} ${overflow ? "is-overflow" : ""}`}>
        <button
          className={`checkbox ${done ? "done" : pClass}`}
          onClick={() => onToggle(t.id)}
          aria-label={done ? "Позначити невиконаною" : "Виконати"}
          type="button"
        >
          {done && <Check />}
        </button>

        <button
          className="task-body"
          type="button"
          onClick={() => onOpen?.(t.id)}
          aria-label={`Відкрити «${t.title}»`}
        >
          {(timeLabel || overflow) && (
            <div className={`task-time ${fixed ? "fixed" : ""}`}>
              {overflow ? "⚠ бракує часу 😔" : fixed ? `📌 ${timeLabel}` : timeLabel}
            </div>
          )}
          <div className="task-title">{t.title}</div>
          <div className="task-meta">
            {t.priority <= 3 && (
              <span className={`meta-chip p${t.priority}`}>
                Пріоритетність: {PRIORITY_META[t.priority as Priority].short}
              </span>
            )}
            {t.estimateMinutes != null && (
              <span className="meta-chip">🕐 {fmtMinutes(t.estimateMinutes)}</span>
            )}
            {t.subtasks.length > 0 && (
              <span className="meta-chip">
                ☑ {subDone}/{t.subtasks.length}
              </span>
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
        </button>

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

function TabIcon({ kind }: { kind: "today" | "calendar" | "inbox" }) {
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
  if (kind === "calendar")
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
