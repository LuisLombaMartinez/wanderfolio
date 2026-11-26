import { ApiError } from '@/lib/api'

const WRONG_CREDENTIALS = 'Ese correo o esa contraseña no nos suenan. ¿Lo intentas otra vez?'
const WEAK_PASSWORD = 'Esa contraseña es demasiado facilita. Prueba con una más larga, con mayúscula, número y símbolo.'
const TOO_MANY = 'Demasiados intentos seguidos. Respira hondo y prueba en un ratito.'
const SESSION_EXPIRED = 'Se nos ha pasado el tiempo. Vuelve a entrar con tu contraseña temporal.'
const FALLBACK = 'Algo ha fallado por el camino. Prueba otra vez.'

/** Spanish copy for API error codes (the Go API's stable `error.code`). */
const API_MESSAGES: Record<string, string> = {
  'not-a-member': 'Esta cuenta no forma parte de nuestro álbum.',
  'bad-response': 'Hemos recibido algo raro del álbum. Prueba otra vez.',
}

/** Turns a Cognito or API error into a friendly Spanish message. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return API_MESSAGES[err.code] ?? FALLBACK
  if (!(err instanceof Error)) return FALLBACK
  switch (err.name) {
    case 'NotAuthorizedException':
      return /session/i.test(err.message) ? SESSION_EXPIRED : WRONG_CREDENTIALS
    case 'UserNotFoundException':
      return WRONG_CREDENTIALS
    case 'InvalidPasswordException':
      return WEAK_PASSWORD
    case 'LimitExceededException':
    case 'TooManyRequestsException':
    case 'TooManyFailedAttemptsException':
      return TOO_MANY
    default:
      return FALLBACK
  }
}

const TRIP_FALLBACK = 'Algo ha fallado por el camino. ¿Probamos otra vez?'
const TOO_LONG = 'Un pelín más corto, porfa: máximo 120 caracteres.'

/** Spanish copy for the Trip API error codes (design/MASTER.md section 23). */
export const TRIP_MESSAGES: Record<string, string> = {
  'title-required': 'Ponle un nombre a nuestro viaje.',
  'destination-required': '¿A dónde vamos? Falta el destino.',
  'title-too-long': TOO_LONG,
  'destination-too-long': TOO_LONG,
  'description-too-long': 'Qué bonito todo, pero caben 2000 caracteres como mucho.',
  'end-before-start': 'La vuelta no puede ser antes de la ida.',
  'invalid-characters': 'Hay un carácter raro por ahí que no sabemos guardar. Prueba a reescribirlo.',
  'bad-response': 'Hemos recibido algo raro del álbum. ¿Probamos otra vez?',
  'trip-not-found': 'Este viaje no está en nuestro álbum.',
}
export const START_REQUIRED = '¿Cuándo empezamos? Elige una fecha.'
export const END_REQUIRED = '¿Y cuándo volvemos? Elige una fecha.'

/** Friendly Spanish for any error from a Trip call; never the API's English message. */
export function tripErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return TRIP_MESSAGES[err.code] ?? TRIP_FALLBACK
  return TRIP_FALLBACK
}

const SHORTEN_AT = 28

/** A filename for a message: control characters shown as "�", the middle cut so the extension stays visible. */
export function displayFilename(name: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = [...name.replace(/[\u0000-\u001f\u007f-\u009f]/g, '�')]
  if (clean.length <= SHORTEN_AT) return clean.join('')
  const tail = 12
  return `${clean.slice(0, SHORTEN_AT - tail - 1).join('')}…${clean.slice(-tail).join('')}`
}

/** Spanish copy for a refused file, by the API's per-file `error.code` (MASTER section 29). */
export function refusalMessage(code: string, filename: string): string {
  const name = `«${displayFilename(filename)}»`
  switch (code) {
    case 'unsupported-file-type':
      return `${name} no es una foto que sepamos abrir. Por ahora solo JPG, PNG, WebP o HEIC.`
    case 'file-too-large':
      return `${name} pesa más de 30 MB y no nos cabe. ¿Tienes una versión más ligera?`
    case 'empty-file':
      return `${name} está vacía. Puede que no se haya copiado bien.`
    case 'invalid-filename':
      return `${name} tiene un nombre que no sabemos guardar. Cámbiaselo y prueba otra vez.`
    default:
      return `${name} no ha podido subirse. ¿Probamos otra vez?`
  }
}

export const UPLOAD_LINKS_ERROR = 'No hemos podido preparar la subida. ¿Probamos otra vez?'
export const UPLOAD_TRIP_GONE = 'Este viaje ya no está en el álbum. Puede que lo hayamos borrado.'
export const MEDIA_SESSION_ERROR = 'No podemos enseñar las fotos ahora mismo. ¿Probamos otra vez?'
export const POLLING_LOST = 'Se nos ha cortado la conexión. Seguimos intentándolo…'

export const RETRY_FAILED = 'No hemos podido volver a intentarlo. ¿Probamos otra vez?'
export const PHOTO_GONE = 'Esta foto ya no estaba en el álbum.'
export const RETRY_STARTED = 'Volvemos a revelarla'
export const RETRY_ALREADY = 'Ya se está revelando otra vez.'
export const retryAllStarted = (n: number) => (n === 1 ? RETRY_STARTED : `Volvemos a revelar ${n} fotos`)

/** Line 2 of the failed-Photos note after "Reintentar todas" left `j` Photos failed. */
export const retryAllNote = (j: number) => `No hemos podido reintentar ${j === 1 ? 'una' : j}. ¿Probamos otra vez?`

const UNREADABLE = {
  reason: 'No hemos sabido abrirla. Puede que el archivo esté dañado o que sea enorme (más de 50 megapíxeles).',
  hint: 'Podemos probar otra vez, pero si vuelve a fallar, mejor la quitamos y la subes de nuevo desde tu galería.',
}
const GENERIC = { reason: 'Algo se nos ha atascado mientras la revelábamos. Suele ser cosa de un momento.', hint: undefined }
const SECOND_TRY = 'Ya lo hemos intentado otra vez y nada. Mejor la quitamos y la vuelves a subir.'

/**
 * What the failed-Photo dialog says (MASTER section 42). The API's `failureReason` is `code: detail`;
 * only the code picks the wording, and the raw text is never shown.
 */
export function failureCopy(failureReason: string | undefined, secondTry: boolean): { reason: string; hint?: string } {
  const code = failureReason?.split(':')[0].trim()
  const base = code === 'unreadable-image' ? UNREADABLE : GENERIC
  return { reason: base.reason, hint: secondTry ? SECOND_TRY : base.hint }
}

/** The live-region text for Photos that turned `failed` during the session. */
export function failureAnnouncement(failed: { filename: string; again: boolean }[]): string {
  if (failed.length === 0) return ''
  if (failed.length > 1) return `${failed.length} fotos no se han podido revelar.`
  const [one] = failed
  const name = `«${displayFilename(one.filename)}»`
  return one.again ? `No hemos podido revelar ${name} tampoco esta vez.` : `No hemos podido revelar ${name}.`
}

/** Spanish copy for the Photo caption and delete errors (design/MASTER.md sections 33, 34, 36). */
export const CAPTION_MESSAGES: Record<string, string> = {
  'caption-too-long': 'Qué bonito, pero caben 500 caracteres como mucho. Recorta un poquito.',
  'invalid-characters': 'Se ha colado algún carácter raro que no sabemos guardar. ¿Lo quitas?',
}
export const CAPTION_ERROR = 'No hemos podido guardar la frase. ¿Probamos otra vez?'
export const PHOTO_DELETE_ERROR = 'No hemos podido borrarla. ¿Probamos otra vez?'
export const MEDIA_FAILED = 'No hemos podido cargar esta foto'

/** Friendly Spanish for a failed caption save. */
export function captionErrorMessage(err: unknown): string {
  return (err instanceof ApiError && CAPTION_MESSAGES[err.code]) || CAPTION_ERROR
}

/** Spanish copy for choosing the Cover photo (design/MASTER.md sections 38, 40). */
export const COVER_NOT_READY = 'Esta foto aún se está revelando. Cuando esté lista, la ponemos de portada.'
export const COVER_ERROR = 'No hemos podido cambiar la portada. ¿Probamos otra vez?'
export const COVER_LIVE = 'Ya es la portada del viaje'
export const COVER_NOTICE = '¡Nueva portada! Así nos verá el álbum.'

/** Friendly Spanish for a failed cover choice that stays inline (the Photo/Trip gone cases are handled by the caller). */
export function coverErrorMessage(err: unknown): string {
  return err instanceof ApiError && err.code === 'photo-not-ready' ? COVER_NOT_READY : COVER_ERROR
}
