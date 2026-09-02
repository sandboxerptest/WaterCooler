/**
 * A small PNG codec, scoped to exactly what the character pipeline needs.
 *
 * There is no image library in this project and the one thing that must be
 * decoded — a LimeZu character sheet — is always the same shape: 8-bit RGBA,
 * non-interlaced. So rather than pull in a dependency that can read every PNG
 * ever written, this reads the kinds we meet and refuses the rest loudly:
 * 8-bit greyscale, RGB, greyscale+alpha and RGBA, all decoded to RGBA. (An
 * exported sprite sheet is often RGB with no alpha channel at all.)
 *
 * Note what is *not* decoded here: the picture a person uploads. That is
 * passed to the vision model as base64 and never opened locally, which is why
 * a user can upload a JPEG, a WebP or a screenshot without any of that
 * mattering to this file.
 */

import { deflateSync, inflateSync } from "zlib";

export interface Bitmap {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row-major. */
  data: Uint8Array;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const BYTES_PER_PIXEL = 4;

let crcTable: Int32Array | null = null;

function crc32(buf: Buffer): number {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** The Paeth predictor, as defined by the PNG specification. */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

export function decodePng(file: Buffer): Bitmap {
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (file[i] !== SIGNATURE[i]) throw new Error("Not a PNG file");
  }

  const width = file.readUInt32BE(16);
  const height = file.readUInt32BE(20);
  const bitDepth = file[24];
  const colourType = file[25];
  const interlace = file[28];

  const channels = CHANNELS[colourType];
  if (bitDepth !== 8 || !channels) {
    throw new Error(
      `Unsupported PNG: expected 8-bit greyscale, RGB or RGBA (colour type 0, 2, 4 or 6), got depth ${bitDepth}, colour type ${colourType}`,
    );
  }
  if (interlace !== 0) throw new Error("Unsupported PNG: interlaced");

  const idat: Buffer[] = [];
  let offset = 8;
  while (offset < file.length) {
    const length = file.readUInt32BE(offset);
    const type = file.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT") idat.push(file.subarray(offset + 8, offset + 8 + length));
    if (type === "IEND") break;
    offset += 12 + length;
  }
  if (idat.length === 0) throw new Error("PNG has no image data");

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const data = new Uint8Array(height * stride);

  // Un-filter in place, one scanline at a time. Each line's filter byte says
  // how it was encoded relative to the pixel left of it and the line above.
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    const up = dst - stride;

    for (let x = 0; x < stride; x++) {
      const value = raw[src + x];
      const left = x >= channels ? data[dst + x - channels] : 0;
      const above = y > 0 ? data[up + x] : 0;
      const upLeft = y > 0 && x >= channels ? data[up + x - channels] : 0;

      let out: number;
      switch (filter) {
        case 0:
          out = value;
          break;
        case 1:
          out = value + left;
          break;
        case 2:
          out = value + above;
          break;
        case 3:
          out = value + ((left + above) >> 1);
          break;
        case 4:
          out = value + paeth(left, above, upLeft);
          break;
        default:
          throw new Error(`PNG uses unknown filter ${filter} on row ${y}`);
      }
      data[dst + x] = out & 0xff;
    }
  }

  return { width, height, data: channels === BYTES_PER_PIXEL ? data : toRgba(data, channels) };
}

/** How many bytes each pixel has, by PNG colour type, for the 8-bit types we read. */
const CHANNELS: Record<number, number | undefined> = { 0: 1, 2: 3, 4: 2, 6: 4 };

/** Widen greyscale, RGB or greyscale+alpha samples to RGBA. */
function toRgba(samples: Uint8Array, channels: number): Uint8Array {
  const pixels = samples.length / channels;
  const out = new Uint8Array(pixels * BYTES_PER_PIXEL);
  for (let i = 0; i < pixels; i++) {
    const s = i * channels;
    const d = i * BYTES_PER_PIXEL;
    if (channels === 3) {
      out[d] = samples[s];
      out[d + 1] = samples[s + 1];
      out[d + 2] = samples[s + 2];
      out[d + 3] = 255;
    } else {
      out[d] = out[d + 1] = out[d + 2] = samples[s];
      out[d + 3] = channels === 2 ? samples[s + 1] : 255;
    }
  }
  return out;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

export function encodePng(image: Bitmap): Buffer {
  const { width, height, data } = image;
  const stride = width * BYTES_PER_PIXEL;
  const raw = Buffer.alloc(height * (stride + 1));

  for (let y = 0; y < height; y++) {
    // Filter 0 (none). The sheets are flat pixel art with long runs of one
    // colour, which deflate handles well on its own; predictors buy little
    // here and cost clarity.
    raw[y * (stride + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  return Buffer.concat([
    Buffer.from(SIGNATURE),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
