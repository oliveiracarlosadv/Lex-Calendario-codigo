"use client";

import { create } from "zustand";

interface QuickCreate {
  start: string;
  end: string;
  allDay: boolean;
}

interface UiState {
  searchOpen: boolean;
  mobileNavOpen: boolean;
  quickCreate: QuickCreate | null;
  setSearchOpen: (open: boolean) => void;
  setMobileNavOpen: (open: boolean) => void;
  openQuickCreate: (q: QuickCreate) => void;
  closeQuickCreate: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  searchOpen: false,
  mobileNavOpen: false,
  quickCreate: null,
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),
  openQuickCreate: (quickCreate) => set({ quickCreate }),
  closeQuickCreate: () => set({ quickCreate: null }),
}));
