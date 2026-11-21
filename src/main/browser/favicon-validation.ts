export function safePNG(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length > 32768 ||
    !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value)
  )
    return false;
  const bytes = Buffer.from(value.slice(22), 'base64');
  return (
    bytes.length >= 24 &&
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.readUInt32BE(16) === 16 &&
    bytes.readUInt32BE(20) === 16
  );
}
