import { describe, it, expect } from "vitest";
import { plural } from "../lib/text";

describe("plural (українська множина)", () => {
  const f = (n: number) => plural(n, "задача", "задачі", "задач");
  it("однина для 1, 21, 31", () => {
    expect(f(1)).toBe("задача");
    expect(f(21)).toBe("задача");
    expect(f(31)).toBe("задача");
  });
  it("2-4 форма", () => {
    expect(f(2)).toBe("задачі");
    expect(f(3)).toBe("задачі");
    expect(f(22)).toBe("задачі");
  });
  it("багато для 5-20, 11-14", () => {
    expect(f(5)).toBe("задач");
    expect(f(11)).toBe("задач");
    expect(f(12)).toBe("задач");
    expect(f(14)).toBe("задач");
    expect(f(100)).toBe("задач");
  });
});
