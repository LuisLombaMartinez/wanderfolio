import { describe, expect, it } from 'vitest'
import { QUESTION_LIMIT, appendPending, questionFollows, suggestedQuestion, validateQuestion } from '@/lib/invitation'

describe('the suggested question', () => {
  it('names the trimmed destination', () => {
    expect(suggestedQuestion('  Roma ')).toBe('¿Te vienes conmigo a Roma?')
  })
  it('without a destination yet, asks about a trip', () => {
    expect(suggestedQuestion('   ')).toBe('¿Te vienes conmigo de viaje?')
  })
  it('follows the destination only while the question is still a suggestion', () => {
    expect(questionFollows('¿Te vienes conmigo a Rom?', 'Rom')).toBe(true)
    expect(questionFollows('¿Te vienes conmigo de viaje?', '')).toBe(true)
    expect(questionFollows('¿Me acompañas a Roma?', 'Roma')).toBe(false)
  })
})

describe('validateQuestion', () => {
  it('needs some text after trimming', () => {
    expect(validateQuestion('  \n ')).toBe('Escribe la pregunta que quieres hacerle.')
  })
  it('allows 120 characters, counting an emoji as one', () => {
    expect(QUESTION_LIMIT).toBe(120)
    expect(validateQuestion('😍'.repeat(120))).toBeUndefined()
    expect(validateQuestion('😍'.repeat(121))).toBe('Que quepa en un suspiro: máximo 120 caracteres.')
  })
})

describe('appendPending', () => {
  const inv = (tripId: string) => ({ tripId })
  it('keeps the queue order and adds only Invitations it does not have, at the end', () => {
    expect(appendPending([inv('a'), inv('b')], [inv('b'), inv('c'), inv('a')])).toEqual([inv('a'), inv('b'), inv('c')])
  })
})
