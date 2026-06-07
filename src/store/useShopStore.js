import { create } from 'zustand'

export const useShopStore = create((set) => ({
  shop: null,
  setShop: (shop) => set({ shop }),
}))
