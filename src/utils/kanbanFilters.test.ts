import { describe, expect, it } from "vitest";
import type { KanbanTask, TaskLinks } from "../types";
import {
  backendDropIndex,
  DEFAULT_KANBAN_FILTERS,
  filterKanbanTasks,
  hasActiveKanbanFilters,
  normalizeKanbanContext,
  normalizeKanbanFilters,
  removeKanbanFilter,
} from "./kanbanFilters";

const task = (overrides: Partial<KanbanTask> = {}): KanbanTask => ({
  id: "task-1",
  week_id: "2026-W39",
  titulo: "Tarefa",
  task_column: "todo",
  status: "active",
  position: 1,
  task_kind: "normal",
  created_at: "2026-09-21T10:00:00Z",
  updated_at: "2026-09-21T10:00:00Z",
  ...overrides,
});

const links = (overrides: Partial<TaskLinks> = {}): TaskLinks => ({
  task_id: "task-1",
  notes: [],
  entities: [],
  ...overrides,
});

describe("filterKanbanTasks", () => {
  const tasks = [
    task({ id: "normal", titulo: "Revisar relatório", due_date: "2026-09-24" }),
    task({
      id: "overdue",
      titulo: "Contato pendente",
      due_date: "2026-09-23",
    }),
    task({
      id: "habit",
      titulo: "Correr",
      task_kind: "habit",
      due_date: "2026-09-24",
    }),
    task({
      id: "done",
      titulo: "Arquivar",
      task_column: "done",
      due_date: "2026-09-23",
    }),
  ];
  const linksByTask = new Map<string, TaskLinks | undefined>([
    ["normal", links({ task_id: "normal", notes: ["notas/relatorio.md"] })],
    ["habit", links({ task_id: "habit" })],
  ]);

  it("combina busca, prazo e tipo sem incluir concluídas nas métricas de atenção", () => {
    const result = filterKanbanTasks(
      tasks,
      linksByTask,
      { ...DEFAULT_KANBAN_FILTERS, today: true, query: "relat" },
      "2026-09-24"
    );
    expect(result.map((item) => item.id)).toEqual(["normal"]);
  });

  it("filtra atrasadas, hábitos e vínculos", () => {
    expect(
      filterKanbanTasks(tasks, linksByTask, { ...DEFAULT_KANBAN_FILTERS, overdue: true }, "2026-09-24").map(
        (item) => item.id
      )
    ).toEqual(["overdue"]);
    expect(
      filterKanbanTasks(tasks, linksByTask, { ...DEFAULT_KANBAN_FILTERS, habits: true }, "2026-09-24").map(
        (item) => item.id
      )
    ).toEqual(["habit"]);
    expect(
      filterKanbanTasks(tasks, linksByTask, { ...DEFAULT_KANBAN_FILTERS, notes: true }, "2026-09-24").map(
        (item) => item.id
      )
    ).toEqual(["normal"]);
  });

  it("trata nota principal e vínculos adicionais como links", () => {
    const withCanonicalNote = task({ id: "canonical", note_path: "tarefa.md" });
    const withRelatedNote = task({ id: "related" });
    const withEntity = task({ id: "entity" });
    const linkMap = new Map<string, TaskLinks | undefined>([
      ["related", links({ task_id: "related", notes: ["notas/extra.md"] })],
      ["entity", links({ task_id: "entity", entities: [{ id: "e1", subtipo: "projeto", titulo: "Projeto", note_path: "entidades/projeto.md", created_at: "" }] })],
    ]);
    expect(filterKanbanTasks([withCanonicalNote, withRelatedNote, withEntity], linkMap, { ...DEFAULT_KANBAN_FILTERS, notes: true }, "2026-09-24").map((item) => item.id)).toEqual(["canonical", "related"]);
    expect(filterKanbanTasks([withCanonicalNote, withRelatedNote, withEntity], linkMap, { ...DEFAULT_KANBAN_FILTERS, entities: true }, "2026-09-24").map((item) => item.id)).toEqual(["entity"]);
  });

  it("separa abertas e concluídas", () => {
    expect(
      filterKanbanTasks(tasks, linksByTask, { ...DEFAULT_KANBAN_FILTERS, status: "completed" }, "2026-09-24").map(
        (item) => item.id
      )
    ).toEqual(["done"]);
  });
});

describe("backendDropIndex", () => {
  it("mantém o índice do backend quando a lista visual tem cards ocultos", () => {
    const full = [
      task({ id: "a", position: 1 }),
      task({ id: "hidden", position: 2 }),
      task({ id: "b", position: 3 }),
    ];
    const visible = [full[0], full[2]];
    expect(backendDropIndex(full, visible, 0, "a")).toBe(1);
    expect(backendDropIndex(full, visible, 1, "a")).toBe(2);
  });

  it("insere no fim quando o filtro não mostra nenhum card", () => {
    const full = [task({ id: "a" }), task({ id: "b" })];
    expect(backendDropIndex(full, [], 0, "a")).toBe(1);
  });

  it("resolve início, meio e fim sem contar o card arrastado duas vezes", () => {
    const full = [task({ id: "a" }), task({ id: "b" }), task({ id: "c" })];
    const visible = [...full];
    expect(backendDropIndex(full, visible, 0, "b")).toBe(0);
    expect(backendDropIndex(full, visible, 1, "b")).toBe(1);
    expect(backendDropIndex(full, visible, 2, "b")).toBe(2);
  });
});

describe("persistência de filtros", () => {
  it("descarta valores inválidos e mantém apenas filtros conhecidos", () => {
    const filters = normalizeKanbanFilters({ query: "  busca ", today: true, status: "inventado", notes: "sim" });
    expect(filters).toEqual({
      query: "  busca ",
      today: true,
      overdue: false,
      habits: false,
      notes: false,
      entities: false,
      status: "all",
    });
    expect(hasActiveKanbanFilters(filters)).toBe(true);
  });

  it("valida semana, aba e período do contexto", () => {
    expect(normalizeKanbanContext({ semana: "2025-W53", tab: "board", periodo: "semana" }).semana).toBeNull();
    expect(normalizeKanbanContext({ semana: " 2026-w9 ", tab: "board", periodo: "semana" }).semana).toBe("2026-W09");
    expect(normalizeKanbanContext({ semana: "semana inválida", tab: "board", periodo: "mes" })).toEqual({
      semana: null,
      tab: "board",
      periodo: "mes",
      filters: DEFAULT_KANBAN_FILTERS,
    });
  });

  it("remove busca e status sem apagar os demais filtros", () => {
    const filters = { ...DEFAULT_KANBAN_FILTERS, query: "relatório", status: "open" as const, today: true };
    expect(removeKanbanFilter(filters, "query")).toMatchObject({ query: "", status: "open", today: true });
    expect(removeKanbanFilter(filters, "status")).toMatchObject({ query: "relatório", status: "all", today: true });
  });
});
