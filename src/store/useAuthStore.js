import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

// Legacy: sessions used to persist in localStorage, which kept the previous user
// logged in across app restarts (even to the next day). Remove any old entry.
try { localStorage.removeItem('stocka-auth') } catch { /* storage unavailable */ }

export const useAuthStore = create(
  persist(
    (set) => ({
      user: null,
      setUser: (user) => set({ user }),
      logout: () => set({ user: null }),
    }),
    {
      name: 'stocka-auth',
      // sessionStorage: survives in-app reloads, but dies with the window —
      // closing the app always signs the user out.
      storage: createJSONStorage(() => sessionStorage),
    }
  )
)
