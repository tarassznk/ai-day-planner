import { describe, it, expect } from "vitest";
import { isoLocal, coerceDate } from "../lib/date";

describe("isoLocal", () => {
  it("форматує локальну дату як YYYY-MM-DD", () => {
    expect(isoLocal(new Date(2026, 6, 5))).toBe("2026-07-05");
    expect(isoLocal(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
});

describe("coerceDate", () => {
  it("приймає валідну дату", () => {
    expect(coerceDate("2026-07-22")).toBe("2026-07-22");
  });
  it("відкидає неправильний формат", () => {
    expect(coerceDate("завтра")).toBeNull();
    expect(coerceDate("2026/07/22")).toBeNull();
    expect(coerceDate("22-07-2026")).toBeNull();
    expect(coerceDate("")).toBeNull();
  });
  it("відкидає неіснуючі дати", () => {
    expect(coerceDate("2026-02-30")).toBeNull();
    expect(coerceDate("2026-13-01")).toBeNull();
  });
  it("відкидає не-рядки", () => {
    expect(coerceDate(123)).toBeNull();
    expect(coerceDate(null)).toBeNull();
    expect(coerceDate(undefined)).toBeNull();
  });
});
