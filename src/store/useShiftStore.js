import { create } from 'zustand'

export const useShiftStore = create((set) => ({
  currentShift: null,
  setCurrentShift: (shift) => set({ currentShift: shift }),
  clearShift: () => set({ currentShift: null }),
}))
