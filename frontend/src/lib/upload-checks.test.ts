import { describe, expect, it } from 'vitest'
import { ACCEPT, MAX_FILE_BYTES, checkFile, contentTypeOf, contentTypeToSend } from './upload-checks'

const file = (name: string, type: string, size = 1000) => ({ name, type, size })

describe('contentTypeToSend', () => {
  it('sends the empty type when the browser gave none or a generic one, so the API reads the extension', () => {
    expect(contentTypeToSend(file('IMG.heic', ''))).toBe('')
    expect(contentTypeToSend(file('IMG.heic', 'application/octet-stream'))).toBe('')
    expect(contentTypeToSend(file('IMG.jpg', 'image/jpeg'))).toBe('image/jpeg')
    expect(contentTypeToSend(file('IMG.heic', 'image/heic'))).toBe('image/heic')
  })
})

describe('ACCEPT', () => {
  it('lists the HEIF types and extensions for the picker', () => {
    expect(ACCEPT).toBe('image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif')
  })
})

describe('checkFile', () => {
  it('accepts JPEG, PNG, WebP and HEIF', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']) expect(checkFile(file('a.img', type))).toBeNull()
  })
  it('refuses other types', () => {
    expect(checkFile(file('a.gif', 'image/gif'))).toBe('unsupported-file-type')
    expect(checkFile(file('a.mov', 'video/quicktime'))).toBe('unsupported-file-type')
    expect(checkFile(file('a.heic', 'image/tiff'))).toBe('unsupported-file-type')
  })
  it('infers the type from the extension when the browser gives none', () => {
    expect(contentTypeOf(file('IMG.JPG', ''))).toBe('image/jpeg')
    expect(checkFile(file('IMG.jpeg', ''))).toBeNull()
    expect(checkFile(file('IMG.heic', ''))).toBeNull()
    expect(checkFile(file('IMG.HEIF', ''))).toBeNull()
    expect(contentTypeOf(file('IMG.heic', 'application/octet-stream'))).toBe('image/heic')
    expect(checkFile(file('IMG.gif', 'application/octet-stream'))).toBe('unsupported-file-type')
    expect(checkFile(file('noextension', ''))).toBe('unsupported-file-type')
  })
  it('enforces the size limits', () => {
    expect(checkFile(file('a.jpg', 'image/jpeg', 0))).toBe('empty-file')
    expect(checkFile(file('a.jpg', 'image/jpeg', MAX_FILE_BYTES))).toBeNull()
    expect(checkFile(file('a.jpg', 'image/jpeg', MAX_FILE_BYTES + 1))).toBe('file-too-large')
  })
  it('refuses bad names', () => {
    expect(checkFile(file('', 'image/jpeg'))).toBe('invalid-filename')
    expect(checkFile(file('a\u0007.jpg', 'image/jpeg'))).toBe('invalid-filename')
    expect(checkFile(file('x'.repeat(256), 'image/jpeg'))).toBe('invalid-filename')
    expect(checkFile(file('x'.repeat(255), 'image/jpeg'))).toBeNull()
  })
})
