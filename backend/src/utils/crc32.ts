/**
 * CRC-32 (IEEE 802.3), the one PNG chunks and the API-key checksum both use.
 *
 * `zlib.crc32` only exists from Node 20.15 / 22.2, and neither a key's
 * checksum nor a PNG's validity may depend on which runtime produced it.
 */
const TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(input: string | Uint8Array): number {
  const bytes = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
