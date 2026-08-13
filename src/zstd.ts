import { zstdDecompressSync } from "node:zlib";

/**
 * Zstandard container support for the DeepSeek Harness session logs.
 *
 * DSH appends each write batch as its own checksummed zstd frame, so a session
 * file is a *concatenation* of frames, not a single frame. `zstdDecompressSync`
 * only decodes the first frame, so we scan the container for complete frames
 * and decompress each one, skipping a torn trailing frame (the live session is
 * still being written while you read it).
 */

const ZSTD_MAGIC = 0xfd2fb528;

export function isZstd(buf: Buffer): boolean {
  return buf.length >= 4 && buf.readUInt32LE(0) === ZSTD_MAGIC;
}

export function decompressZstd(buf: Buffer): string {
  const frames = scanFrames(buf);
  let out = "";
  for (const f of frames) {
    try {
      out += zstdDecompressSync(buf.subarray(f.start, f.end)).toString("utf8");
    } catch {
      // A single corrupt frame should not take down the whole paste.
      continue;
    }
  }
  return out;
}

interface Frame {
  start: number;
  end: number;
}

/** Walk the concatenated-frame container and return complete frame ranges. */
function scanFrames(buf: Buffer): Frame[] {
  const frames: Frame[] = [];
  let off = 0;

  while (off < buf.length) {
    const start = off;
    if (buf.length - off < 4) break; // torn magic
    if (buf.readUInt32LE(off) !== ZSTD_MAGIC) {
      throw new Error("corrupt Zstandard stream: invalid frame magic");
    }
    off += 4;
    if (off >= buf.length) break; // magic only, no header

    const descriptor = buf.readUInt8(off);
    off += 1;
    if ((descriptor & 0x18) !== 0) throw new Error("corrupt Zstandard stream: reserved bits");

    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 0x20) !== 0;
    const checksum = (descriptor & 0x04) !== 0;
    const dictionaryFlag = descriptor & 0x03;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    const remainingHeader = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buf.length - off < remainingHeader) break; // torn header
    off += remainingHeader;

    let complete = true;
    for (;;) {
      if (buf.length - off < 3) {
        complete = false;
        break;
      }
      const blockHeader = buf.readUIntLE(off, 3);
      off += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 3;
      const blockSize = blockHeader >>> 3;
      if (blockType === 3) throw new Error("corrupt Zstandard stream: reserved block type");
      const payload = blockType === 1 ? 1 : blockSize;
      if (buf.length - off < payload) {
        complete = false;
        break;
      }
      off += payload;
      if (lastBlock) break;
    }
    if (!complete) break; // torn block

    if (checksum) {
      if (buf.length - off < 4) break; // torn checksum
      off += 4;
    }
    frames.push({ start, end: off });
  }

  return frames;
}
