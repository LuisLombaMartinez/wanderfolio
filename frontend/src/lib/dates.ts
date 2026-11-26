const DAY_MS = 86_400_000

/** Days from `now`'s local calendar date to `startDate` (a `YYYY-MM-DD` calendar date). */
export function daysUntil(startDate: string, now: Date = new Date()): number {
  const [y, m, d] = startDate.split('-').map(Number)
  // Compare calendar dates in UTC so daylight-saving shifts never add or lose an hour.
  const start = Date.UTC(y, m - 1, d)
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((start - today) / DAY_MS)
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

function parts(date: string): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number)
  return [y, m, d]
}

/** True for a real `YYYY-MM-DD` calendar date (no 2026-02-30). */
export function isRealDate(date: string): boolean {
  if (!DATE_PATTERN.test(date)) return false
  const [y, m, d] = parts(date)
  const check = new Date(Date.UTC(y, m - 1, d))
  return check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === d
}

/**
 * A Trip's dates in Spanish: "28 abr – 7 may 2027", "3 – 7 ago 2027", "28 abr 2027",
 * "28 dic 2026 – 3 ene 2027". Parsed as calendar parts, never through `new Date(string)`.
 */
export function formatDateRange(startDate: string, endDate: string): string {
  const [sy, sm, sd] = parts(startDate)
  const [ey, em, ed] = parts(endDate)
  if (startDate === endDate) return `${sd} ${MONTHS[sm - 1]} ${sy}`
  if (sy !== ey) return `${sd} ${MONTHS[sm - 1]} ${sy} – ${ed} ${MONTHS[em - 1]} ${ey}`
  if (sm === em) return `${sd} – ${ed} ${MONTHS[em - 1]} ${ey}`
  return `${sd} ${MONTHS[sm - 1]} – ${ed} ${MONTHS[em - 1]} ${ey}`
}

/** Days a Trip lasts, both ends included. */
export function tripLength(startDate: string, endDate: string): number {
  const [sy, sm, sd] = parts(startDate)
  const [ey, em, ed] = parts(endDate)
  return Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / DAY_MS) + 1
}

/** "1 día juntos" / "{n} días juntos". */
export function tripLengthLabel(startDate: string, endDate: string): string {
  const n = tripLength(startDate, endDate)
  return n === 1 ? '1 día juntos' : `${n} días juntos`
}

/** The viewer's local calendar day of a UTC timestamp, as "12 may 2027" (never the time); "" if unreadable. */
export function formatLocalDay(timestamp: string): string {
  const at = new Date(timestamp)
  if (Number.isNaN(at.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  const day = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
  return formatDateRange(day, day)
}
