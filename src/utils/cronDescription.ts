/**
 * Utilitário de tradução de expressões cron de 5 campos para Português natural,
 * e conversão de seletores amigáveis em expressões cron válidas.
 */

export interface FriendlyCronOptions {
  frequency: "hourly" | "every_2h" | "every_6h" | "every_12h" | "daily" | "weekdays" | "weekly";
  time: string; // "HH:MM"
  daysOfWeek: number[]; // 0=Dom, 1=Seg, ..., 6=Sáb
}

export function describeCron(expr: string): string {
  const trimmed = expr.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) {
    return "Expressão cron incompleta (são necessários 5 campos)";
  }

  const [min, hour, dom, mon, dow] = parts;

  // Presets clássicos de passo
  if (min === "0" && hour === "*" && dom === "*" && mon === "*" && dow === "*") {
    return "A cada 1 hora (no minuto zero)";
  }
  if (min === "0" && hour === "*/2" && dom === "*" && mon === "*" && dow === "*") {
    return "A cada 2 horas";
  }
  if (min === "0" && hour === "*/6" && dom === "*" && mon === "*" && dow === "*") {
    return "A cada 6 horas";
  }
  if (min === "0" && hour === "*/12" && dom === "*" && mon === "*" && dow === "*") {
    return "A cada 12 horas";
  }
  if (hour.startsWith("*/")) {
    const step = hour.replace("*/", "");
    return `A cada ${step} horas (no minuto ${min === "*" ? "0" : min})`;
  }

  // Dias da semana
  const dayNames: Record<string, string> = {
    "0": "Domingo",
    "1": "Segunda-feira",
    "2": "Terça-feira",
    "3": "Quarta-feira",
    "4": "Quinta-feira",
    "5": "Sexta-feira",
    "6": "Sábado",
    "7": "Domingo",
  };

  const formattedTime =
    !isNaN(Number(hour)) && !isNaN(Number(min))
      ? `${hour.padStart(2, "0")}:${min.padStart(2, "0")}`
      : null;

  if (dom === "*" && mon === "*") {
    if (dow === "*") {
      if (formattedTime) {
        return `Todos os dias às ${formattedTime}`;
      }
    } else if (dow === "1-5") {
      if (formattedTime) {
        return `De segunda a sexta-feira às ${formattedTime}`;
      }
      return "De segunda a sexta-feira";
    } else if (dayNames[dow]) {
      if (formattedTime) {
        return `Toda(o) ${dayNames[dow]} às ${formattedTime}`;
      }
      return `Toda(o) ${dayNames[dow]}`;
    } else if (dow.includes(",")) {
      const days = dow.split(",").map((d) => dayNames[d.trim()] || d).join(", ");
      if (formattedTime) {
        return `Nos dias (${days}) às ${formattedTime}`;
      }
      return `Nos dias: ${days}`;
    }
  }

  // Descrição genérica legível
  return `Minuto: ${min} | Hora: ${hour} | Dia: ${dom} | Mês: ${mon} | Sem: ${dow}`;
}

/**
 * Inverso de `previewCron`/`optionsToCron`: cron de 5 campos → estado do
 * formulário de hábito (`hora` "HH:MM" + `dias` 0..6, dom=0). Usado para
 * pré-preencher a edição de um hábito existente.
 *
 * Melhor esforço: campos fora do padrão do app caem nos defaults do form
 * ("09:00" / todos os dias) em vez de invalidar a edição.
 */
export function parseHabitCron(expr: string): { hora: string; dias: number[] } {
  const parts = expr.trim().split(/\s+/);
  const fallback = { hora: "09:00", dias: [] as number[] };
  if (parts.length !== 5) return fallback;

  const [min, hour, , , dow] = parts;
  const h = Number(hour);
  const m = Number(min);
  const hora =
    Number.isInteger(h) && Number.isInteger(m) && h >= 0 && h <= 23 && m >= 0 && m <= 59
      ? `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
      : fallback.hora;

  let dias: number[] = [];
  if (dow === "*" || dow === "") {
    dias = [];
  } else if (/^\d+-\d+$/.test(dow)) {
    const [lo, hi] = dow.split("-").map(Number);
    if (lo <= hi && lo >= 0 && hi <= 7) {
      for (let d = lo; d <= hi; d++) dias.push(d);
    } else {
      return { hora, dias: fallback.dias };
    }
  } else {
    dias = dow
      .split(",")
      .map((d) => Number(d.trim()))
      .filter((d) => Number.isInteger(d) && d >= 0 && d <= 7)
      .map((d) => (d === 7 ? 0 : d)); // cron aceita 7=Dom; o form usa 0
  }
  return { hora, dias: [...new Set(dias)].sort((a, b) => a - b) };
}

export function optionsToCron(opts: FriendlyCronOptions): string {
  const [hStr, mStr] = opts.time.split(":");
  const h = parseInt(hStr || "9", 10);
  const m = parseInt(mStr || "0", 10);

  switch (opts.frequency) {
    case "hourly":
      return "0 * * * *";
    case "every_2h":
      return "0 */2 * * *";
    case "every_6h":
      return "0 */6 * * *";
    case "every_12h":
      return "0 */12 * * *";
    case "daily":
      return `${m} ${h} * * *`;
    case "weekdays":
      return `${m} ${h} * * 1-5`;
    case "weekly": {
      const d = opts.daysOfWeek.length > 0 ? opts.daysOfWeek.join(",") : "0";
      return `${m} ${h} * * ${d}`;
    }
    default:
      return "0 */6 * * *";
  }
}
