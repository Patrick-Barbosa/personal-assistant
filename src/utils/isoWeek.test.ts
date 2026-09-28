import { describe, expect, it } from "vitest";
import {
  isoWeekIdOf,
  isoWeekIdOfDate,
  isValidWeekId,
  isoWeekNumber,
  parseWeekId,
  shiftWeekId,
  weekIdFor,
} from "./isoWeek";

describe("parseWeekId", () => {
  it("aceita o formato 2026-W39 (maiúscula e minúscula)", () => {
    expect(parseWeekId("2026-W39")).toEqual([2026, 39]);
    expect(parseWeekId(" 2026-w9 ")).toEqual([2026, 9]);
  });

  it("rejeita formatos inválidos", () => {
    expect(parseWeekId("2026-39")).toBeNull();
    expect(parseWeekId("W39")).toBeNull();
    expect(parseWeekId("2026-W0")).toBeNull();
    expect(parseWeekId("2026-W54")).toBeNull();
    expect(parseWeekId("abc")).toBeNull();
  });
});

describe("isoWeekIdOf", () => {
  it("devolve a semana da data (segunda = início)", () => {
    // 2026-09-24 é uma quinta-feira → semana 39 (seg 21 → dom 27).
    expect(isoWeekIdOfDate("2026-09-24")).toBe("2026-W39");
    expect(isoWeekIdOfDate("2026-09-21")).toBe("2026-W39");
    expect(isoWeekIdOfDate("2026-09-27")).toBe("2026-W39");
    expect(isoWeekIdOfDate("2026-09-28")).toBe("2026-W40");
    expect(isoWeekIdOfDate("2026-09-20")).toBe("2026-W38");
  });

  it("cobre a virada de ano ISO (28/12/2020 ainda é 2020-W53)", () => {
    expect(isoWeekIdOfDate("2020-12-28")).toBe("2020-W53");
    expect(isoWeekIdOfDate("2021-01-01")).toBe("2020-W53");
    expect(isoWeekIdOfDate("2021-01-04")).toBe("2021-W01");
  });

  it("cobre anos onde 1º de janeiro cai na semana anterior", () => {
    // 01/01/2016 (sexta) ainda pertence a 2015-W53; 04/01/2016 abre 2016-W01.
    expect(isoWeekIdOfDate("2016-01-01")).toBe("2015-W53");
    // Já na semana 1 do próprio ano quando 4 de janeiro é anterior ao dia 1.
    expect(isoWeekIdOfDate("2015-01-01")).toBe("2015-W01");
  });

  it("bate com a data de hoje do ambiente", () => {
    const today = new Date();
    expect(isoWeekIdOf(today)).toBe(isoWeekIdOfDate(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`));
  });
});

describe("isValidWeekId", () => {
  it("rejeita uma semana ISO que não existe no ano", () => {
    expect(isValidWeekId("2025-W53")).toBe(false);
    expect(isValidWeekId("2026-W53")).toBe(true);
  });
});

describe("shiftWeekId", () => {
  it("avança e recua sem perder o formato", () => {
    expect(shiftWeekId("2026-W39", 1)).toBe("2026-W40");
    expect(shiftWeekId("2026-W39", -1)).toBe("2026-W38");
    expect(shiftWeekId("2026-W01", -1)).toBe("2025-W52");
    expect(shiftWeekId("2026-W52", 1)).toBe("2026-W53");
    expect(shiftWeekId("2026-W53", 1)).toBe("2027-W01");
  });

  it("é inverso em série (ida e volta)", () => {
    expect(shiftWeekId(shiftWeekId("2026-W39", 5), -5)).toBe("2026-W39");
    expect(shiftWeekId(shiftWeekId("2020-W53", 1), -1)).toBe("2020-W53");
  });

  it("devolve o id intacto quando é inválido", () => {
    expect(shiftWeekId("nada", 2)).toBe("nada");
  });
});

describe("helpers", () => {
  it("weekIdFor sempre com 2 dígitos", () => {
    expect(weekIdFor(2026, 9)).toBe("2026-W09");
    expect(weekIdFor(2026, 39)).toBe("2026-W39");
  });

  it("isoWeekNumber extrai o número", () => {
    expect(isoWeekNumber("2026-W09")).toBe(9);
    expect(isoWeekNumber("xx")).toBeNull();
  });
});
