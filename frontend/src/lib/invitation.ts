import { INVITATION_MESSAGES } from '@/lib/messages'

/** The most characters an Invitation's question may have (the API checks the same). */
export const QUESTION_LIMIT = 120

/** The question the Trip form suggests (MASTER section 51). */
export function suggestedQuestion(destination: string): string {
  const d = destination.trim()
  return d ? `¿Te vienes conmigo a ${d}?` : '¿Te vienes conmigo de viaje?'
}

/** Whether the question is still the untouched suggestion for this destination, so it may follow it. */
export function questionFollows(question: string, destination: string): boolean {
  return question === suggestedQuestion(destination)
}

/** The question as it is saved: trimmed, with every run of whitespace (Enter included) as one space. */
export function normalizeQuestion(question: string): string {
  return question.replace(/\s+/g, ' ').trim()
}

/** The same checks as the API, with the Spanish texts of MASTER section 52; undefined when valid. */
export function validateQuestion(question: string): string | undefined {
  const q = normalizeQuestion(question)
  if (!q) return INVITATION_MESSAGES['question-required']
  if (Array.from(q).length > QUESTION_LIMIT) return INVITATION_MESSAGES['question-too-long']
  return undefined
}

/** Adds the Invitations the queue doesn't hold yet at its end, keeping its order (no re-sorting). */
export function appendPending<T extends { tripId: string }>(queue: T[], incoming: T[]): T[] {
  const have = new Set(queue.map((i) => i.tripId))
  const added = incoming.filter((i) => !have.has(i.tripId) && have.add(i.tripId))
  return added.length ? [...queue, ...added] : queue
}
