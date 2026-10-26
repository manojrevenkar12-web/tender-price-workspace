import { describe, expect, it } from "vitest";

import { centsToInput, parseCentsInput, relativeDeadline } from "../src/shared/lib/format";

describe("price input", () => {
  it.each([
    ["1.234,56", 123456],
    ["1234,5", 123450],
    ["12", 1200],
    ["0,05", 5],
    ["1234.56", 123456],
    ["1.234", 123400],
    [" 7,10 € ", 710],
    ["", null],
  ])("reads %j", (raw, cents) => {
    expect(parseCentsInput(raw)).toBe(cents);
  });

  it.each(["12,345", "abc", "1,2,3", "-5"])("refuses %j", (raw) => {
    expect(parseCentsInput(raw)).toBeUndefined();
  });

  it("writes German amounts back", () => {
    expect(centsToInput(123456)).toBe("1.234,56");
    expect(centsToInput(null)).toBe("");
  });

  it("describes deadlines", () => {
    const now = Date.parse("2026-10-26T10:00:00Z");
    expect(relativeDeadline("2026-11-02T10:00:00Z", now)).toBe("due in 7 d");
    expect(relativeDeadline("2026-10-20T10:00:00Z", now)).toBe("closed 6 d ago");
    expect(relativeDeadline(null, now)).toBe("no deadline");
  });
});
