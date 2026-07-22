import { describe, it, expect } from "vitest";
import { coerceTime } from "../lib/parse-utils";

describe("coerceTime", () => {
  it("нормалізує різні формати до HH:MM", () => {
    expect(coerceTime("15:00")).toBe("15:00");
    expect(coerceTime("9:05")).toBe("09:05");
    expect(coerceTime("3")).toBe("03:00");
    expect(coerceTime("1530")).toBe("15:30");
    expect(coerceTime(" 08:30 ")).toBe("08:30");
  });
  it("вимагає рівно 2 цифри хвилин (модель віддає HH:MM)", () => {
    expect(coerceTime("9:5")).toBeNull();
  });
  it("відкидає невалідний час", () => {
    expect(coerceTime("25:00")).toBeNull();
    expect(coerceTime("12:60")).toBeNull();
    expect(coerceTime("abc")).toBeNull();
    expect(coerceTime("")).toBeNull();
    expect(coerceTime(42)).toBeNull();
  });
});
