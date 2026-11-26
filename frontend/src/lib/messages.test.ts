import { describe, expect, it } from 'vitest'
import { ApiError } from './api'
import {
  RETRY_FAILED,
  displayFilename,
  errorMessage,
  failureAnnouncement,
  failureCopy,
  refusalMessage,
  retryAllNote,
  tripErrorMessage,
} from './messages'

function named(name: string, message = '') {
  const err = new Error(message)
  err.name = name
  return err
}

describe('errorMessage', () => {
  it('explains a wrong email or password without saying which one', () => {
    const expected = 'Ese correo o esa contraseña no nos suenan. ¿Lo intentas otra vez?'
    expect(errorMessage(named('NotAuthorizedException', 'Incorrect username or password.'))).toBe(expected)
    expect(errorMessage(named('UserNotFoundException'))).toBe(expected)
  })

  it('asks for a stronger password', () => {
    expect(errorMessage(named('InvalidPasswordException'))).toBe(
      'Esa contraseña es demasiado facilita. Prueba con una más larga, con mayúscula, número y símbolo.',
    )
  })

  it('asks to wait after too many attempts', () => {
    expect(errorMessage(named('LimitExceededException'))).toBe(
      'Demasiados intentos seguidos. Respira hondo y prueba en un ratito.',
    )
    expect(errorMessage(named('TooManyRequestsException'))).toBe(
      'Demasiados intentos seguidos. Respira hondo y prueba en un ratito.',
    )
  })

  it('explains an expired first-login session', () => {
    expect(errorMessage(named('NotAuthorizedException', 'Invalid session for the user, session is expired.'))).toBe(
      'Se nos ha pasado el tiempo. Vuelve a entrar con tu contraseña temporal.',
    )
  })

  it('maps API error codes', () => {
    expect(errorMessage(new ApiError(403, 'not-a-member'))).toBe('Esta cuenta no forma parte de nuestro álbum.')
  })

  it('falls back to a friendly message for anything else', () => {
    const fallback = 'Algo ha fallado por el camino. Prueba otra vez.'
    expect(errorMessage(new TypeError('Failed to fetch'))).toBe(fallback)
    expect(errorMessage(new ApiError(500, 'internal'))).toBe(fallback)
    expect(errorMessage('weird')).toBe(fallback)
  })
})

describe('tripErrorMessage', () => {
  it('maps each Trip error code to Spanish', () => {
    expect(tripErrorMessage(new ApiError(422, 'title-required'))).toBe('Ponle un nombre a nuestro viaje.')
    expect(tripErrorMessage(new ApiError(422, 'end-before-start'))).toBe('La vuelta no puede ser antes de la ida.')
    expect(tripErrorMessage(new ApiError(404, 'trip-not-found'))).toBe('Este viaje no está en nuestro álbum.')
    expect(tripErrorMessage(new ApiError(422, 'invalid-characters'))).toBe(
      'Hay un carácter raro por ahí que no sabemos guardar. Prueba a reescribirlo.',
    )
    expect(tripErrorMessage(new ApiError(200, 'bad-response'))).toBe(
      'Hemos recibido algo raro del álbum. ¿Probamos otra vez?',
    )
  })
  it('never leaks the English message', () => {
    expect(tripErrorMessage(new ApiError(500, 'internal', 'boom'))).toBe(
      'Algo ha fallado por el camino. ¿Probamos otra vez?',
    )
    expect(tripErrorMessage(new TypeError('Failed to fetch'))).toBe('Algo ha fallado por el camino. ¿Probamos otra vez?')
  })
})

describe('refusalMessage', () => {
  it('has Spanish copy for each per-file code and a fallback', () => {
    expect(refusalMessage('unsupported-file-type', 'a.mov')).toBe('«a.mov» no es una foto que sepamos abrir. Por ahora solo JPG, PNG, WebP o HEIC.')
    expect(refusalMessage('file-too-large', 'a.jpg')).toContain('pesa más de 30 MB')
    expect(refusalMessage('empty-file', 'a.jpg')).toContain('está vacía')
    expect(refusalMessage('invalid-filename', 'a.jpg')).toContain('nombre que no sabemos guardar')
    expect(refusalMessage('whatever', 'a.jpg')).toBe('«a.jpg» no ha podido subirse. ¿Probamos otra vez?')
  })
})

describe('displayFilename', () => {
  it('cuts the middle of long names and keeps the extension', () => {
    const shown = displayFilename('IMG_20261203_123456_very_long_name_0042.jpg')
    expect([...shown].length).toBeLessThanOrEqual(28)
    expect(shown.endsWith('_0042.jpg')).toBe(true)
    expect(shown).toContain('…')
  })
  it('replaces control characters', () => {
    expect(displayFilename('a\u0007b.jpg')).toBe('a�b.jpg')
  })
})

describe('failureCopy', () => {
  it('gives the generic copy to a Photo the API reports as stuck (processing-timeout)', () => {
    expect(failureCopy('processing-timeout', false)).toEqual(failureCopy('processing-error', false))
    expect(failureCopy('processing-timeout', false).reason).toMatch(/atascado/)
  })

  it('picks the wording by the code before the colon and never shows the raw reason', () => {
    const unreadable = failureCopy('unreadable-image: UnreadableImage', false)
    expect(unreadable.reason).toBe('No hemos sabido abrirla. Puede que el archivo esté dañado o que sea enorme (más de 50 megapíxeles).')
    expect(unreadable.hint).toBe('Podemos probar otra vez, pero si vuelve a fallar, mejor la quitamos y la subes de nuevo desde tu galería.')
    const generic = failureCopy('processing-error: Boom', false)
    expect(generic.reason).toBe('Algo se nos ha atascado mientras la revelábamos. Suele ser cosa de un momento.')
    expect(generic.hint).toBeUndefined()
    expect(failureCopy(undefined, false)).toEqual(generic)
    expect(failureCopy('something else entirely', false)).toEqual(generic)
    expect(JSON.stringify(unreadable)).not.toContain('UnreadableImage')
  })
  it('turns the hint into the second-try hint whatever the reason', () => {
    const second = 'Ya lo hemos intentado otra vez y nada. Mejor la quitamos y la vuelves a subir.'
    expect(failureCopy('unreadable-image: X', true).hint).toBe(second)
    expect(failureCopy('processing-error: X', true).hint).toBe(second)
    expect(failureCopy(undefined, true).hint).toBe(second)
  })
})

describe('failureAnnouncement', () => {
  const f = (filename: string, again = false) => ({ filename, again })
  it('names one Photo, counts several, and says "tampoco" after a retry from this device', () => {
    expect(failureAnnouncement([f('a.jpg')])).toBe('No hemos podido revelar «a.jpg».')
    expect(failureAnnouncement([f('a.jpg'), f('b.jpg')])).toBe('2 fotos no se han podido revelar.')
    expect(failureAnnouncement([f('a.jpg', true)])).toBe('No hemos podido revelar «a.jpg» tampoco esta vez.')
    expect(failureAnnouncement([])).toBe('')
  })
})

describe('retry strings', () => {
  it('has the dialog alert and the note line for partial failures', () => {
    expect(RETRY_FAILED).toBe('No hemos podido volver a intentarlo. ¿Probamos otra vez?')
    expect(retryAllNote(1)).toBe('No hemos podido reintentar una. ¿Probamos otra vez?')
    expect(retryAllNote(3)).toBe('No hemos podido reintentar 3. ¿Probamos otra vez?')
  })
})
