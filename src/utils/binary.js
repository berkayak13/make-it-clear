// Base64-encodes an ArrayBuffer in chunks small enough to avoid overflowing the
// argument limit of String.fromCharCode.apply on large images. Shared by the
// extraction (vision data-URIs) and static-site (offline image embedding) paths.
export function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
