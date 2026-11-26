/** Browser-side checks for a picked file, with the same codes the API answers with (MASTER section 29). */

export const MAX_FILE_BYTES = 31_457_280
export const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'] as const
/** The picker's `accept`: some browsers report HEIC files with no type, so the extensions are listed too. */
export const ACCEPT = `${ALLOWED_TYPES.join(',')},.heic,.heif`

const TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
}

export type FileRefusalCode = 'unsupported-file-type' | 'file-too-large' | 'empty-file' | 'invalid-filename'

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/

const isGeneric = (type: string) => type === '' || type === 'application/octet-stream'

/** The type the file is checked as: the browser's, or (pickers leave it empty or generic) the extension's. */
export function contentTypeOf(file: { name: string; type: string }): string {
  if (!isGeneric(file.type)) return file.type
  const ext = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase()
  return file.name.includes('.') ? (TYPE_BY_EXTENSION[ext] ?? '') : ''
}

/** The type to tell the API: the browser's, or empty when it gave none, so the API reads the extension. */
export const contentTypeToSend = (file: { type: string }): string => (isGeneric(file.type) ? '' : file.type)

/** The reason a file can't be uploaded, or null if it can. */
export function checkFile(file: { name: string; type: string; size: number }): FileRefusalCode | null {
  if (file.name === '' || [...file.name].length > 255 || CONTROL_CHARS.test(file.name)) return 'invalid-filename'
  if (!(ALLOWED_TYPES as readonly string[]).includes(contentTypeOf(file))) return 'unsupported-file-type'
  if (file.size <= 0) return 'empty-file'
  if (file.size > MAX_FILE_BYTES) return 'file-too-large'
  return null
}
