import { describe, expect, it } from "vitest";
import { formatDate, formatDay, parseDate } from "@/lib/utils";

describe("datas", () => {
  it("nunca lança erro com datas inválidas ou em formatos diferentes", () => {
    expect(formatDate("2026-10-07T00:00:00.000ZT12:00:00")).toBe("—");
    expect(formatDate("")).toBe("—");
    expect(parseDate("abc")).toBeNull();
  });

  it("datas sem hora não mudam de dia pelo fuso", () => {
    expect(formatDay("2026-10-07")).toBe(formatDay("2026-10-07T00:00:00.000Z"));
    expect(formatDay("2026-10-07", { day: "2-digit", month: "2-digit", year: "numeric" })).toBe("07/10/2026");
  });
});
