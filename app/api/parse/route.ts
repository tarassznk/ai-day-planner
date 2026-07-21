import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import type { ParsedTask, Priority } from "@/lib/types";

// Ключ живе ТІЛЬКИ тут, на сервері (Vercel env). У браузер не потрапляє.
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Швидка й дешева модель для парсингу — як радить гайд.
const MODEL = "claude-haiku-4-5";

// Forced tool-use гарантує валідний JSON замість «сирого» тексту моделі.
const EXTRACT_TOOL: Anthropic.Tool = {
  name: "extract_tasks",
  description:
    "Розбиває неструктурований потік думок користувача на окремі задачі.",
  input_schema: {
    type: "object",
    properties: {
      tasks: {
        type: "array",
        description: "Список окремих задач, витягнутих з тексту.",
        items: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description:
                "Коротке, чітке формулювання задачі як дії. Українською.",
            },
            priority: {
              type: "integer",
              enum: [1, 2, 3, 4],
              description:
                "Пріоритетність: 1 = висока (терміново й важливо), 2 = середня (важливо), 3 = низька (звичайне), 4 = без пріоритету (дрібне).",
            },
            estimateMinutes: {
              type: "integer",
              description:
                "Оцінка часу на виконання у хвилинах. 0, якщо неможливо оцінити.",
            },
            dueDate: {
              type: "string",
              description:
                "Дедлайн у форматі YYYY-MM-DD, якщо згадано (навіть відносно: 'завтра', 'у пʼятницю'). Порожній рядок, якщо дедлайну немає.",
            },
            startTime: {
              type: "string",
              description:
                "Явний час початку у форматі HH:MM (24 год), якщо в тексті вказано конкретну годину ('о 15:00', 'дзвінок о 3', 'зустріч на 9 ранку'). Порожній рядок, якщо конкретного часу немає.",
            },
            tags: {
              type: "array",
              items: { type: "string" },
              description:
                "1-2 короткі теги-категорії українською (напр. 'робота', 'дім', 'здоровʼя', 'фінанси'). Порожній масив, якщо незрозуміло.",
            },
            scheduleToday: {
              type: "boolean",
              description:
                "true, якщо задачу варто зробити сьогодні (термінова, має дедлайн сьогодні/завтра, або явно про 'сьогодні').",
            },
          },
          required: [
            "title",
            "priority",
            "estimateMinutes",
            "dueDate",
            "startTime",
            "tags",
            "scheduleToday",
          ],
        },
      },
    },
    required: ["tasks"],
  },
};

function systemPrompt(today: string, weekday: string, dateRef: string): string {
  return `Ти — розумний планувальник задач. Користувач диктує або пише все, що в нього в голові, суцільним потоком. Твоя робота — перетворити цей хаос на чіткий список окремих задач.

Сьогодні: ${today} (${weekday}).

Довідник дат (використовуй ТІЛЬКИ його для дедлайнів — не рахуй дати самостійно):
${dateRef}

Правила:
- Розбивай текст на ОКРЕМІ атомарні задачі. Одне речення може містити кілька задач — розділяй їх.
- Формулюй кожну задачу коротко, як дію ("Подзвонити стоматологу", а не "треба десь подзвонити зубному напевно").
- Пріоритетність став за змістом: дедлайни, слова "терміново", "важливо", "не забути" → висока (1); важливе без терміновості → середня (2); рутина → низька (3); дрібне → без пріоритету (4).
- Оцінюй час реалістично у хвилинах. Дрібна дія ~15 хв, зустріч ~60 хв. Якщо взагалі незрозуміло — 0.
- Якщо вказано конкретну годину ("о 15:00", "дзвінок о 3", "зустріч на 9 ранку") — постав startTime у форматі HH:MM (24 год). Інакше порожній рядок.
- Відносні дати ("завтра", "у понеділок", "до пʼятниці") бери ВИКЛЮЧНО з довідника дат вище і став у форматі YYYY-MM-DD. Для дня тижня бери НАЙБЛИЖЧУ майбутню дату з таким днем (перший збіг зверху вниз у довіднику). Якщо дедлайну немає — порожній рядок.
- Не вигадуй задач, яких немає в тексті. Не додавай пояснень — лише виклик інструменту.
- Якщо текст порожній або без задач — поверни порожній масив tasks.`;
}

function coercePriority(p: unknown): Priority {
  const n = Number(p);
  if (n === 1 || n === 2 || n === 3 || n === 4) return n;
  return 4;
}

// Нормалізуємо час до "HH:MM" (24 год). Невалідне → null.
function coerceTime(t: unknown): string | null {
  if (typeof t !== "string") return null;
  const m = t.trim().match(/^(\d{1,2}):?(\d{2})?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY не налаштований на сервері." },
        { status: 500 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const text: string = (body?.text ?? "").toString().trim();

    if (!text) {
      return NextResponse.json({ tasks: [] });
    }

    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const weekday = now.toLocaleDateString("uk-UA", { weekday: "long" });

    // Готовий довідник дат на 14 днів наперед — щоб модель не рахувала сама.
    const dateRef = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(now);
      d.setDate(d.getDate() + i);
      const iso = d.toISOString().slice(0, 10);
      const wd = d.toLocaleDateString("uk-UA", { weekday: "long" });
      const mark = i === 0 ? " (сьогодні)" : i === 1 ? " (завтра)" : "";
      return `${iso} — ${wd}${mark}`;
    }).join("\n");

    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: systemPrompt(today, weekday, dateRef),
      tools: [EXTRACT_TOOL],
      tool_choice: { type: "tool", name: "extract_tasks" },
      messages: [{ role: "user", content: text }],
    });

    // Витягуємо результат інструменту. Не довіряємо формату наосліп — валідуємо.
    const toolUse = message.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );

    if (!toolUse) {
      return NextResponse.json({ tasks: [] });
    }

    const raw = (toolUse.input as { tasks?: unknown[] })?.tasks ?? [];
    const tasks: ParsedTask[] = (Array.isArray(raw) ? raw : [])
      .map((t): ParsedTask | null => {
        const item = t as Record<string, unknown>;
        const title = (item?.title ?? "").toString().trim();
        if (!title) return null;
        const estimate = item?.estimateMinutes;
        return {
          title,
          priority: coercePriority(item?.priority),
          estimateMinutes:
            typeof estimate === "number" && estimate > 0
              ? Math.round(estimate)
              : null,
          dueDate:
            typeof item?.dueDate === "string" && item.dueDate.trim()
              ? item.dueDate.trim()
              : null,
          startTime: coerceTime(item?.startTime),
          tags: Array.isArray(item?.tags)
            ? (item.tags as unknown[])
                .map((x) => x?.toString().trim())
                .filter((x): x is string => !!x)
                .slice(0, 3)
            : [],
          scheduleToday: Boolean(item?.scheduleToday),
        };
      })
      .filter((t): t is ParsedTask => t !== null);

    return NextResponse.json({ tasks });
  } catch (err) {
    console.error("parse error", err);
    return NextResponse.json(
      { error: "Не вдалося розібрати текст. Спробуй ще раз." },
      { status: 500 }
    );
  }
}
