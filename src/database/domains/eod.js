const w = window.stocka.eod

export const addEndOfDay = (e) => w.add(e)
export const getEndOfDayRecords = () => w.getAll()
export const getEndOfDayByDate = (date) => w.getByDate(date)
