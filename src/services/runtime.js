export const isElectronRuntime = () => {
  return typeof window !== 'undefined' && !!window.stocka
}

export const getRuntimeMode = () => {
  return isElectronRuntime() ? 'desktop' : 'web'
}

export const canUseNativePrinter = () => {
  return isElectronRuntime() && !!window.stocka?.printer
}
