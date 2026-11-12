export function webpDimensions(bytes) {
  if (bytes.length < 30 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") return null;
  const kind = bytes.toString("ascii", 12, 16);
  if (kind === "VP8X") return {
    width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3),
  };
  if (kind === "VP8 " && bytes.length >= 30) return {
    width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff,
  };
  if (kind === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) return {
    width: 1 + (bytes[21] | ((bytes[22] & 0x3f) << 8)),
    height: 1 + ((bytes[22] >> 6) | (bytes[23] << 2) | ((bytes[24] & 0x0f) << 10)),
  };
  return null;
}
