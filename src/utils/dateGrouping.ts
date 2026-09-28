import { Session } from "../types";

export type SessionDateGroup = "Hoje" | "Ontem" | "Esta Semana" | "Anteriores";

export function groupSessionsByDate(sessions: Session[]): Record<SessionDateGroup, Session[]> {
  const groups: Record<SessionDateGroup, Session[]> = {
    Hoje: [],
    Ontem: [],
    "Esta Semana": [],
    Anteriores: [],
  };

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const startOfWeek = startOfToday - 7 * 24 * 60 * 60 * 1000;

  for (const session of sessions) {
    const sessionTime = new Date(session.updated_at || session.created_at).getTime();
    if (sessionTime >= startOfToday) {
      groups.Hoje.push(session);
    } else if (sessionTime >= startOfYesterday) {
      groups.Ontem.push(session);
    } else if (sessionTime >= startOfWeek) {
      groups["Esta Semana"].push(session);
    } else {
      groups.Anteriores.push(session);
    }
  }

  return groups;
}
