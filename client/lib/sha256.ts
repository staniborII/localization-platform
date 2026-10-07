/**
 * SHA-256 of an upload, read in chunks so a multi-gigabyte file is not held in memory.
 * The presign function asks S3 to store this digest and reject the PUT when the bytes differ.
 * A POST to the web client API sends the same kind of digest in x-amz-content-sha256.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** Rotates a 32-bit word to the right. */
function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

/** Incremental SHA-256. Each update can be any length. */
class Sha256 {
  private readonly state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  private readonly block = new Uint8Array(64);
  private filled = 0;
  private bytes = 0;

  /** Adds the next chunk of file bytes. */
  update(chunk: Uint8Array): void {
    this.bytes += chunk.length;
    let offset = 0;
    if (this.filled > 0) {
      const take = Math.min(64 - this.filled, chunk.length);
      this.block.set(chunk.subarray(0, take), this.filled);
      this.filled += take;
      offset = take;
      if (this.filled === 64) {
        this.compress(this.block);
        this.filled = 0;
      }
    }
    while (offset + 64 <= chunk.length) {
      this.compress(chunk.subarray(offset, offset + 64));
      offset += 64;
    }
    if (offset < chunk.length) {
      this.block.set(chunk.subarray(offset), 0);
      this.filled = chunk.length - offset;
    }
  }

  /** Finishes the hash and returns the 32-byte digest. */
  digest(): Uint8Array {
    const hi = Math.floor(this.bytes / 0x20000000);
    const lo = (this.bytes * 8) >>> 0;
    const pad = new Uint8Array(this.filled < 56 ? 64 : 128);
    pad.set(this.block.subarray(0, this.filled));
    pad[this.filled] = 0x80;
    const view = new DataView(pad.buffer);
    view.setUint32(pad.length - 8, hi);
    view.setUint32(pad.length - 4, lo);
    this.compress(pad.subarray(0, 64));
    if (pad.length === 128) {
      this.compress(pad.subarray(64));
    }
    const out = new Uint8Array(32);
    const words = new DataView(out.buffer);
    for (let i = 0; i < 8; i += 1) {
      words.setUint32(i * 4, this.state[i] ?? 0);
    }
    return out;
  }

  /** Folds one 64-byte block into the hash. */
  private compress(block: Uint8Array): void {
    const words = new Uint32Array(64);
    for (let i = 0; i < 16; i += 1) {
      const at = i * 4;
      words[i] = ((block[at]! << 24) | (block[at + 1]! << 16) | (block[at + 2]! << 8) | block[at + 3]!) >>> 0;
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(words[i - 15]!, 7) ^ rotr(words[i - 15]!, 18) ^ (words[i - 15]! >>> 3);
      const s1 = rotr(words[i - 2]!, 17) ^ rotr(words[i - 2]!, 19) ^ (words[i - 2]! >>> 10);
      words[i] = (words[i - 16]! + s0 + words[i - 7]! + s1) >>> 0;
    }
    let a = this.state[0]!;
    let b = this.state[1]!;
    let c = this.state[2]!;
    let d = this.state[3]!;
    let e = this.state[4]!;
    let f = this.state[5]!;
    let g = this.state[6]!;
    let h = this.state[7]!;
    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + K[i]! + words[i]!) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    this.state[0] = (this.state[0]! + a) >>> 0;
    this.state[1] = (this.state[1]! + b) >>> 0;
    this.state[2] = (this.state[2]! + c) >>> 0;
    this.state[3] = (this.state[3]! + d) >>> 0;
    this.state[4] = (this.state[4]! + e) >>> 0;
    this.state[5] = (this.state[5]! + f) >>> 0;
    this.state[6] = (this.state[6]! + g) >>> 0;
    this.state[7] = (this.state[7]! + h) >>> 0;
  }
}

/** Writes a digest as lowercase hex. */
function toHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/** Hashes a JSON body. CloudFront requires this hex value on a POST to the function URL. */
export function sha256HexOfString(value: string): string {
  return sha256Hex(new TextEncoder().encode(value));
}

/** Hashes a whole buffer, feeding it in small pieces so a short test crosses a block boundary. */
export function sha256Hex(data: Uint8Array): string {
  const hash = new Sha256();
  for (let offset = 0; offset < data.length; offset += 3) {
    hash.update(data.subarray(offset, offset + 3));
  }
  return toHex(hash.digest());
}

/** Hashes a file from its stream. The whole file is never copied into one buffer. */
export async function sha256HexOfBlob(blob: Blob): Promise<string> {
  const hash = new Sha256();
  const reader = blob.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      hash.update(value);
    }
  }
  return toHex(hash.digest());
}
