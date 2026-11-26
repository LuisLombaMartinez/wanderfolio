import { describe, expect, it } from 'vitest'
import { fieldForCode, validateTrip, type TripValues } from './trip-form'

const valid: TripValues = {
  title: 'Escapada',
  destination: 'Lisboa',
  startDate: '2027-04-28',
  endDate: '2027-05-07',
  description: '',
}

describe('validateTrip', () => {
  it('accepts a complete Trip, including a same-day one', () => {
    expect(validateTrip(valid)).toEqual({})
    expect(validateTrip({ ...valid, endDate: valid.startDate })).toEqual({})
  })
  it('requires a title and a destination (blank counts as empty)', () => {
    const errors = validateTrip({ ...valid, title: '  ', destination: '' })
    expect(errors.title).toBe('Ponle un nombre a nuestro viaje.')
    expect(errors.destination).toBe('¿A dónde vamos? Falta el destino.')
  })
  it('refuses an end before the start', () => {
    expect(validateTrip({ ...valid, endDate: '2027-04-27' }).endDate).toBe('La vuelta no puede ser antes de la ida.')
  })
  it('asks for missing dates', () => {
    const errors = validateTrip({ ...valid, startDate: '', endDate: '' })
    expect(errors.startDate).toBe('¿Cuándo empezamos? Elige una fecha.')
    expect(errors.endDate).toBe('¿Y cuándo volvemos? Elige una fecha.')
  })
  it('enforces the length limits', () => {
    expect(validateTrip({ ...valid, title: 'a'.repeat(121) }).title).toMatch(/máximo 120/)
    expect(validateTrip({ ...valid, description: 'a'.repeat(2001) }).description).toMatch(/2000/)
  })
})

describe('fieldForCode', () => {
  it('routes API codes to their field', () => {
    expect(fieldForCode('title-too-long')).toBe('title')
    expect(fieldForCode('end-before-start')).toBe('endDate')
    expect(fieldForCode('internal')).toBeUndefined()
  })
})
