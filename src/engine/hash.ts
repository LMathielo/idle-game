// Stable state hash: canonical JSON (sorted keys) + FNV-1a 32-bit over UTF-8 bytes.
// Not cryptographic: it detects divergence between client and (future) server replays.

/** JSON with object keys sorted at every level. Matches JSON.stringify for everything else. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('canonicalJson: non-finite number');
    if (value === undefined) throw new Error('canonicalJson: undefined at top level');
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

/** FNV-1a 32-bit of the UTF-8 encoding of `text`, as 8 lowercase hex chars. */
export function fnv1a32(text: string): string {
  let hash = 0x811c9dc5;
  const byte = (b: number) => {
    hash ^= b;
    hash = Math.imul(hash, 0x01000193);
  };
  for (let i = 0; i < text.length; i++) {
    let cp = text.codePointAt(i)!;
    if (cp > 0xffff) i++; // surrogate pair consumed
    if (cp < 0x80) byte(cp);
    else if (cp < 0x800) {
      byte(0xc0 | (cp >> 6));
      byte(0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      byte(0xe0 | (cp >> 12));
      byte(0x80 | ((cp >> 6) & 0x3f));
      byte(0x80 | (cp & 0x3f));
    } else {
      byte(0xf0 | (cp >> 18));
      byte(0x80 | ((cp >> 12) & 0x3f));
      byte(0x80 | ((cp >> 6) & 0x3f));
      byte(0x80 | (cp & 0x3f));
    }
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function hashState(state: unknown): string {
  return fnv1a32(canonicalJson(state));
}
