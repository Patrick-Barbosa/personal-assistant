import { describe, expect, it, vi, afterEach } from "vitest";
import { cssVarRgb } from "./cssVarRgb";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cssVarRgb", () => {
  const stubToken = (value: string) => {
    vi.stubGlobal("document", { documentElement: {} });
    vi.stubGlobal(
      "getComputedStyle",
      () => ({ getPropertyValue: () => value }) as unknown as CSSStyleDeclaration,
    );
  };

  it("parses a 6-digit hex token", () => {
    stubToken("#f59e0b");
    expect(cssVarRgb("--accent")).toEqual([245, 158, 11]);
  });

  it("parses a 3-digit hex token", () => {
    stubToken("#fff");
    expect(cssVarRgb("--accent")).toEqual([255, 255, 255]);
  });

  it("falls back on garbage or missing values", () => {
    stubToken("not-a-color");
    expect(cssVarRgb("--accent")).toEqual([245, 158, 11]);
    stubToken("");
    expect(cssVarRgb("--nope")).toEqual([161, 161, 170]);
  });
});
