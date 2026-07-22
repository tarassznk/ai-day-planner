import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { coerceTime, MAX_INPUT_CHARS } from "@/lib/parse-utils";

// Перепланування з обмеженнями. AI РОБИТЬ ЛИШЕ ОДНЕ: перетворює вільний текст
// («у мене зустрічі 14–16, після обіду не можу») на список зайнятих інтервалів.
// Сам розклад будує детермінований клієнтський планувальник — це надійніше
// наживо, ніж просити модель згенерувати цілий план.
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = "claude-haiku-4-5";

const BUSY_TOOL: Anthropic.Tool = {
  name: "extract_busy",
  description:
    "Витягує зайняті проміжки часу з опису обмежень користувача на сьогодні.",
  input_schema: {
    type: "object",
    properties: {
      busy: {
        type: "array",
        description: "Проміжки, коли користувач НЕ може працювати над задачами.",
        items: {
          type: "object",
          properties: {
            start: {
              type: "string",
              description: "Початок зайнятості, HH:MM (24 год).",
            },
            end: {
              type: "string",
              description: "Кінець зайнятості, HH:MM (24 год).",
            },
            label: {
              type: "string",
              description:
                "Короткий підпис українською (напр. 'зустрічі', 'обід', 'лікар').",
            },
          },
          required: ["start", "end", "label"],
        },
      },
    },
    required: ["busy"],
  },
};

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
    if (!text) return NextResponse.json({ busy: [] });
    if (text.length > MAX_INPUT_CHARS) {
      return NextResponse.json(
        {
          error: `Забагато тексту (макс. ${MAX_INPUT_CHARS} символів). Скороти опис.`,
        },
        { status: 400 }
      );
    }

    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: `Ти допомагаєш перепланувати день. Користувач описує, коли він зайнятий або не може працювати. Витягни зайняті проміжки у форматі HH:MM.
Правила:
- "зустрічі 14–16" → start 14:00, end 16:00.
- "до 11 зайнятий" → start 09:00, end 11:00 (робочий день починається о 09:00).
- "після 17 не можу" → start 17:00, end 18:00 (робочий день до 18:00).
- "обід о 13" → start 13:00, end 14:00.
- Якщо годину дано без хвилин — став :00. Не вигадуй проміжків, яких немає в тексті.`,
      tools: [BUSY_TOOL],
      tool_choice: { type: "tool", name: "extract_busy" },
      messages: [{ role: "user", content: text }],
    });

    const toolUse = message.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    const raw = (toolUse?.input as { busy?: unknown[] })?.busy ?? [];
    const busy = (Array.isArray(raw) ? raw : [])
      .map((b) => {
        const item = b as Record<string, unknown>;
        const start = coerceTime(item?.start);
        const end = coerceTime(item?.end);
        if (!start || !end || end <= start) return null;
        const label = (item?.label ?? "зайнято").toString().trim() || "зайнято";
        return { start, end, label };
      })
      .filter((x): x is { start: string; end: string; label: string } => !!x);

    return NextResponse.json({ busy });
  } catch (err) {
    console.error("replan error", err);
    return NextResponse.json(
      { error: "Не вдалося перепланувати. Спробуй ще раз." },
      { status: 500 }
    );
  }
}
