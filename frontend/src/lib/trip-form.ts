import { isRealDate, tripLength } from '@/lib/dates'
import { END_REQUIRED, START_REQUIRED, TRIP_MESSAGES } from '@/lib/messages'

export interface TripValues {
  title: string
  destination: string
  startDate: string
  endDate: string
  description: string
}

export type TripField = keyof TripValues
export type TripErrors = Partial<Record<TripField, string>>

export const LIMITS = { title: 120, destination: 120, description: 2000 } as const

/** The same checks as the API, with the same Spanish texts (design/MASTER.md section 23). */
export function validateTrip(v: TripValues): TripErrors {
  const errors: TripErrors = {}
  const title = v.title.trim()
  const destination = v.destination.trim()
  if (!title) errors.title = TRIP_MESSAGES['title-required']
  else if ([...title].length > LIMITS.title) errors.title = TRIP_MESSAGES['title-too-long']
  if (!destination) errors.destination = TRIP_MESSAGES['destination-required']
  else if ([...destination].length > LIMITS.destination) errors.destination = TRIP_MESSAGES['destination-too-long']
  if (!isRealDate(v.startDate)) errors.startDate = START_REQUIRED
  if (!isRealDate(v.endDate)) errors.endDate = END_REQUIRED
  else if (!errors.startDate && tripLength(v.startDate, v.endDate) < 1) errors.endDate = TRIP_MESSAGES['end-before-start']
  if ([...v.description.trim()].length > LIMITS.description) errors.description = TRIP_MESSAGES['description-too-long']
  return errors
}

/** Maps an API error code to the form field it belongs to (undefined: show it in the banner). */
export function fieldForCode(code: string): TripField | undefined {
  switch (code) {
    case 'title-required':
    case 'title-too-long':
      return 'title'
    case 'destination-required':
    case 'destination-too-long':
      return 'destination'
    case 'description-too-long':
      return 'description'
    case 'end-before-start':
      return 'endDate'
    default:
      return undefined
  }
}
