"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type CalendarView = "timeGridDay" | "timeGridWeek" | "dayGridMonth" | "multiMonthYear" | "resourceTimeGridDay" | "listWeek";

export const VIEW_LABELS: Record<CalendarView, string> = {
  timeGridDay: "Dia",
  timeGridWeek: "Semana",
  dayGridMonth: "Mês",
  multiMonthYear: "Ano",
  resourceTimeGridDay: "Equipe",
  listWeek: "Lista",
};

interface CalendarState {
  view: CalendarView;
  date: string; // ISO do dia em foco
  hiddenCategories: string[];
  onlyMine: boolean;
  setView: (view: CalendarView) => void;
  setDate: (date: Date | string) => void;
  toggleCategory: (id: string) => void;
  setOnlyMine: (v: boolean) => void;
}

export const useCalendarStore = create<CalendarState>()(
  persist(
    (set) => ({
      view: "timeGridWeek",
      date: new Date().toISOString(),
      hiddenCategories: [],
      onlyMine: false,
      setView: (view) => set({ view }),
      setDate: (date) => set({ date: typeof date === "string" ? date : date.toISOString() }),
      toggleCategory: (id) =>
        set((s) => ({
          hiddenCategories: s.hiddenCategories.includes(id)
            ? s.hiddenCategories.filter((c) => c !== id)
            : [...s.hiddenCategories, id],
        })),
      setOnlyMine: (onlyMine) => set({ onlyMine }),
    }),
    { name: "lex-calendar", partialize: (s) => ({ view: s.view, hiddenCategories: s.hiddenCategories, onlyMine: s.onlyMine }) },
  ),
);
