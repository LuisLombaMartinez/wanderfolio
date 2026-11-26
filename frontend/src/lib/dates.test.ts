import { describe, expect, it } from 'vitest'
import { daysUntil, formatDateRange, isRealDate, tripLength, tripLengthLabel } from './dates'

// `now` values are built with the local-time Date constructor: Trip dates are
// calendar dates and the countdown uses the viewer's local time (spec #5).
describe('daysUntil', () => {
  it('counts whole calendar days to the start date', () => {
    expect(daysUntil('2027-04-28', new Date(2027, 3, 7, 23, 59))).toBe(21)
    expect(daysUntil('2027-04-28', new Date(2027, 3, 7, 0, 1))).toBe(21)
  })

  it('is 1 the day before', () => {
    expect(daysUntil('2027-04-28', new Date(2027, 3, 27, 12))).toBe(1)
  })

  it('is 0 on the start date and negative after it', () => {
    expect(daysUntil('2027-04-28', new Date(2027, 3, 28, 8))).toBe(0)
    expect(daysUntil('2027-04-28', new Date(2027, 3, 30, 8))).toBe(-2)
  })

  it('crosses a daylight-saving change without drifting', () => {
    // Europe moves the clocks on the last Sunday of March.
    expect(daysUntil('2027-04-01', new Date(2027, 2, 20, 12))).toBe(12)
  })
})

describe('formatDateRange', () => {
  it('writes the year once at the end', () => {
    expect(formatDateRange('2027-04-28', '2027-05-07')).toBe('28 abr – 7 may 2027')
  })
  it('collapses a range inside one month', () => {
    expect(formatDateRange('2027-08-03', '2027-08-07')).toBe('3 – 7 ago 2027')
  })
  it('shows a single day once', () => {
    expect(formatDateRange('2027-04-28', '2027-04-28')).toBe('28 abr 2027')
  })
  it('keeps both years across a year change', () => {
    expect(formatDateRange('2026-12-28', '2027-01-03')).toBe('28 dic 2026 – 3 ene 2027')
  })
})

describe('tripLength', () => {
  it('counts both ends', () => {
    expect(tripLength('2027-04-28', '2027-05-07')).toBe(10)
    expect(tripLength('2027-04-28', '2027-04-28')).toBe(1)
  })
  it('labels in Spanish with the singular', () => {
    expect(tripLengthLabel('2027-04-28', '2027-04-28')).toBe('1 día juntos')
    expect(tripLengthLabel('2027-04-28', '2027-05-07')).toBe('10 días juntos')
  })
})

describe('isRealDate', () => {
  it('accepts real dates and rejects the rest', () => {
    expect(isRealDate('2028-02-29')).toBe(true)
    expect(isRealDate('2027-02-29')).toBe(false)
    expect(isRealDate('')).toBe(false)
    expect(isRealDate('2026-1-5')).toBe(false)
  })
})
