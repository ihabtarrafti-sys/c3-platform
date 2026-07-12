import { describe, expect, it } from 'vitest';
import { documentBytesMatchDeclaredType } from '../src/document';
import { isAllowedPersonPhotoContentType, PERSON_PHOTO_CONTENT_TYPES, PERSON_PHOTO_MAX_BYTES } from '../src/person';

const bytes = (...parts: Array<string | number[]>): Uint8Array => {
  const chunks = parts.map((p) => (typeof p === 'string' ? new TextEncoder().encode(p) : Uint8Array.from(p)));
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
};

describe('HARDEN-2 M-07 — the declared type must match the bytes', () => {
  it('binary formats prove themselves by magic bytes', () => {
    expect(documentBytesMatchDeclaredType('application/pdf', bytes('%PDF-1.7\n…'))).toBe(true);
    expect(documentBytesMatchDeclaredType('application/pdf', bytes('just text'))).toBe(false);
    expect(documentBytesMatchDeclaredType('image/png', bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'data'))).toBe(true);
    expect(documentBytesMatchDeclaredType('image/png', bytes([0xff, 0xd8, 0xff], 'jpegdata'))).toBe(false);
    expect(documentBytesMatchDeclaredType('image/jpeg', bytes([0xff, 0xd8, 0xff, 0xe0], 'jfif'))).toBe(true);
    expect(documentBytesMatchDeclaredType('image/webp', bytes('RIFF', [1, 2, 3, 4], 'WEBPVP8 '))).toBe(true);
    expect(documentBytesMatchDeclaredType('image/webp', bytes('RIFF', [1, 2, 3, 4], 'WAVEfmt '))).toBe(false);
    const zip = bytes([0x50, 0x4b, 0x03, 0x04], 'ooxml-payload');
    expect(documentBytesMatchDeclaredType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', zip)).toBe(true);
    expect(documentBytesMatchDeclaredType('application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes('plain'))).toBe(false);
  });

  it('text types must NOT look binary (no known signature, no NUL in the first KiB)', () => {
    expect(documentBytesMatchDeclaredType('text/plain', bytes('a receipt note'))).toBe(true);
    expect(documentBytesMatchDeclaredType('text/csv', bytes('a,b,c\n1,2,3\n'))).toBe(true);
    expect(documentBytesMatchDeclaredType('text/plain', bytes('%PDF-1.4 disguised'))).toBe(false);
    expect(documentBytesMatchDeclaredType('text/csv', bytes([0x50, 0x4b, 0x03, 0x04], 'zip-as-csv'))).toBe(false);
    expect(documentBytesMatchDeclaredType('text/plain', bytes('nul', [0x00], 'byte'))).toBe(false);
  });

  it('an unlisted type never matches', () => {
    expect(documentBytesMatchDeclaredType('application/x-msdownload', bytes('MZ…'))).toBe(false);
  });
});

describe('person photo — image-only, well below the document ceiling (Track B)', () => {
  it('accepts exactly png/jpeg/webp; refuses PDFs and office docs (valid documents, not headshots)', () => {
    expect([...PERSON_PHOTO_CONTENT_TYPES]).toEqual(['image/png', 'image/jpeg', 'image/webp']);
    for (const t of PERSON_PHOTO_CONTENT_TYPES) expect(isAllowedPersonPhotoContentType(t)).toBe(true);
    for (const t of ['application/pdf', 'text/plain', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'image/gif', '']) {
      expect(isAllowedPersonPhotoContentType(t)).toBe(false);
    }
  });

  it('the photo ceiling is smaller than the document ceiling', () => {
    expect(PERSON_PHOTO_MAX_BYTES).toBe(8 * 1024 * 1024);
  });
});
