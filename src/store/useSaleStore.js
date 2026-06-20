import { create } from 'zustand'

export const useSaleStore = create((set) => ({
  saleInProgress: false,
  setSaleInProgress: (v) => set({ saleInProgress: v }),
  // Set true when a remote force-close arrives while a sale is running;
  // cleared when the sale finishes and the modal is shown.
  pendingForceClose: false,
  setPendingForceClose: (v) => set({ pendingForceClose: v }),
}))
