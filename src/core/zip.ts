export interface ZipTextFile {
  name: string;
  contents: string;
}

interface EncodedZipFile {
  name: Uint8Array;
  data: Uint8Array;
  checksum: number;
  localOffset: number;
}

const UTF8_FLAG = 0x0800;
const STORE_METHOD = 0;

function createCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

const CRC_TABLE = createCrcTable();

function crc32(data: Uint8Array): number {
  let checksum = 0xFFFFFFFF;
  for (const byte of data) {
    checksum = CRC_TABLE[(checksum ^ byte) & 0xFF]! ^ (checksum >>> 8);
  }
  return (checksum ^ 0xFFFFFFFF) >>> 0;
}

function dosTimestamp(date: Date): { date: number; time: number } {
  const year = Math.max(1980, Math.min(2107, date.getFullYear()));
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  };
}

export function createZip(files: ZipTextFile[], modifiedAt = new Date()): Blob {
  if (files.length === 0) throw new Error("El paquete ZIP necesita al menos un archivo.");
  if (files.length > 65535) throw new Error("El paquete ZIP contiene demasiados archivos.");

  const encoder = new TextEncoder();
  const encoded: EncodedZipFile[] = files.map((file) => {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.contents);
    if (name.length === 0 || name.length > 65535) throw new Error("Nombre de archivo ZIP no válido.");
    return { name, data, checksum: crc32(data), localOffset: 0 };
  });
  const localLength = encoded.reduce((total, file) => total + 30 + file.name.length + file.data.length, 0);
  const centralLength = encoded.reduce((total, file) => total + 46 + file.name.length, 0);
  const buffer = new ArrayBuffer(localLength + centralLength + 22);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const timestamp = dosTimestamp(modifiedAt);
  let offset = 0;

  function uint16(value: number): void {
    view.setUint16(offset, value, true);
    offset += 2;
  }

  function uint32(value: number): void {
    view.setUint32(offset, value, true);
    offset += 4;
  }

  function append(data: Uint8Array): void {
    bytes.set(data, offset);
    offset += data.length;
  }

  for (const file of encoded) {
    file.localOffset = offset;
    uint32(0x04034B50);
    uint16(20);
    uint16(UTF8_FLAG);
    uint16(STORE_METHOD);
    uint16(timestamp.time);
    uint16(timestamp.date);
    uint32(file.checksum);
    uint32(file.data.length);
    uint32(file.data.length);
    uint16(file.name.length);
    uint16(0);
    append(file.name);
    append(file.data);
  }

  const centralOffset = offset;
  for (const file of encoded) {
    uint32(0x02014B50);
    uint16(20);
    uint16(20);
    uint16(UTF8_FLAG);
    uint16(STORE_METHOD);
    uint16(timestamp.time);
    uint16(timestamp.date);
    uint32(file.checksum);
    uint32(file.data.length);
    uint32(file.data.length);
    uint16(file.name.length);
    uint16(0);
    uint16(0);
    uint16(0);
    uint16(0);
    uint32(0);
    uint32(file.localOffset);
    append(file.name);
  }

  uint32(0x06054B50);
  uint16(0);
  uint16(0);
  uint16(encoded.length);
  uint16(encoded.length);
  uint32(centralLength);
  uint32(centralOffset);
  uint16(0);

  return new Blob([buffer], { type: "application/zip" });
}
