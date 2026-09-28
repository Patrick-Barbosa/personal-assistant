import { describe, expect, it } from "vitest";
import { describeCron, optionsToCron, parseHabitCron } from "./cronDescription";

describe("describeCron", () => {
  it("descreve presets de passo", () => {
    expect(describeCron("0 * * * *")).toBe("A cada 1 hora (no minuto zero)");
    expect(describeCron("0 */2 * * *")).toBe("A cada 2 horas");
    expect(describeCron("0 */6 * * *")).toBe("A cada 6 horas");
    expect(describeCron("0 */12 * * *")).toBe("A cada 12 horas");
  });

  it("descreve passo genérico", () => {
    expect(describeCron("0 */3 * * *")).toBe("A cada 3 horas (no minuto 0)");
  });

  it("descreve agendamento diário com hora formatada", () => {
    expect(describeCron("30 9 * * *")).toBe("Todos os dias às 09:30");
  });

  it("descreve dias úteis", () => {
    expect(describeCron("0 9 * * 1-5")).toBe("De segunda a sexta-feira às 09:00");
  });

  it("rejeita expressão incompleta", () => {
    expect(describeCron("0 9 * *")).toBe(
      "Expressão cron incompleta (são necessários 5 campos)"
    );
  });

  it("descreve expressão genérica sem formato", () => {
    expect(describeCron("15 10 5 6 3")).toContain("Minuto: 15");
  });
});

describe("optionsToCron", () => {
  it("converte seletores amigáveis em cron válido", () => {
    expect(
      optionsToCron({ frequency: "hourly", time: "09:00", daysOfWeek: [] })
    ).toBe("0 * * * *");
    expect(
      optionsToCron({ frequency: "daily", time: "09:30", daysOfWeek: [] })
    ).toBe("30 9 * * *");
    expect(
      optionsToCron({ frequency: "weekdays", time: "09:00", daysOfWeek: [] })
    ).toBe("0 9 * * 1-5");
    expect(
      optionsToCron({ frequency: "weekly", time: "09:00", daysOfWeek: [1, 3] })
    ).toBe("0 9 * * 1,3");
  });

  it("faz round-trip legível via describeCron", () => {
    const expr = optionsToCron({
      frequency: "daily",
      time: "09:30",
      daysOfWeek: [],
    });
    expect(describeCron(expr)).toBe("Todos os dias às 09:30");
  });
});

describe("parseHabitCron", () => {
  it("extrai hora e dias do cron diário", () => {
    expect(parseHabitCron("0 9 * * *")).toEqual({ hora: "09:00", dias: [] });
    expect(parseHabitCron("30 14 * * *")).toEqual({ hora: "14:30", dias: [] });
  });

  it("expande intervalo de dias úteis (1-5)", () => {
    expect(parseHabitCron("0 9 * * 1-5")).toEqual({
      hora: "09:00",
      dias: [1, 2, 3, 4, 5],
    });
  });

  it("normaliza lista de dias, com 7=Dom virando 0 e sem repetir", () => {
    expect(parseHabitCron("15 8 * * 1,3,7")).toEqual({
      hora: "08:15",
      dias: [0, 1, 3],
    });
  });

  it("cai nos padrões do form para cron fora do padrão", () => {
    expect(parseHabitCron("incompleto")).toEqual({
      hora: "09:00",
      dias: [],
    });
    expect(parseHabitCron("* * * * *")).toEqual({ hora: "09:00", dias: [] });
    expect(parseHabitCron("0 99 * * 1,3")).toEqual({
      hora: "09:00",
      dias: [1, 3],
    });
  });

  it("round-trip com optionsToCron preserva hora e dias", () => {
    const cron = optionsToCron({
      frequency: "weekly",
      time: "07:45",
      daysOfWeek: [2, 4],
    });
    expect(parseHabitCron(cron)).toEqual({ hora: "07:45", dias: [2, 4] });
  });
});
