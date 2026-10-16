// Teltonika AVL Protocol Encoder (Codec 8 & Codec 8 Extended)

export interface GPSData {
  timestamp: number;
  priority: number; // 0=Low, 1=High, 2=Panic
  longitude: number;
  latitude: number;
  altitude: number;
  angle: number;
  satellites: number;
  speed: number;
}

export interface IOElement {
  id: number;
  value: number;
  size: 1 | 2 | 4 | 8;
}

export interface AVLPacket {
  imei: string;
  gpsData: GPSData;
  ioElements: IOElement[];
  codecId: number; // 0x08 = Codec 8, 0x8E = Codec 8 Extended
}

// Common IO Element IDs
export const IO_ELEMENTS = {
  DIGITAL_INPUT_1: 1,
  DIGITAL_INPUT_2: 2,
  ANALOG_INPUT_1: 9,
  ANALOG_INPUT_2: 10,
  GSM_SIGNAL: 21,
  SPEED: 24,
  COG: 25,
  GPS_POWER_VOLTAGE: 66,
  BATTERY_VOLTAGE: 67,
  GSM_CELL_ID: 68,
  EXTERNAL_VOLTAGE: 69,
  ICV: 70,
  GSM_OPERATOR: 71,
  TOTAL_ODOMETER: 16,
  FUEL_USED: 72,
  FUEL_RATE: 73,
  TEMPERATURE: 54,
  HUMIDITY: 55,
  MOVING: 63,
  UNDEFINED_MOVING: 64,
  AUTO_GEOFENCE: 65,
  IGNITION: 239,
  MOTION: 240,
  GSM_LAC: 241,
  DIN_1: 1,
  DOUT_1: 179,
  SLEEP_MODE: 250,
};

export const IO_ELEMENT_NAMES: Record<number, string> = {
  1: 'Digital Input 1',
  2: 'Digital Input 2',
  9: 'Analog Input 1',
  10: 'Analog Input 2',
  16: 'Total Odometer',
  21: 'GSM Signal',
  23: 'Ignition',
  24: 'Speed',
  25: 'Angle (COG)',
  54: 'Temperature',
  55: 'Humidity',
  63: 'Moving',
  64: 'Undefined Moving',
  65: 'Auto Geofence',
  66: 'GPS Power Voltage',
  67: 'Battery Voltage',
  68: 'GSM Cell ID',
  69: 'External Voltage (mV)',
  70: 'ICV Voltage',
  71: 'GSM Operator',
  72: 'Fuel Used',
  73: 'Fuel Rate',
  179: 'Digital Output 1',
  239: 'Ignition',
  240: 'Motion',
  241: 'GSM LAC',
  250: 'Sleep Mode',
};

// CRC-16/ARC calculation (Teltonika uses this)
export function crc16(data: Uint8Array): number {
  let crc = 0x0000;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      if (crc & 0x0001) {
        crc = (crc >> 1) ^ 0xA001;
      } else {
        crc = crc >> 1;
      }
    }
  }
  return crc;
}

// Convert to big-endian bytes
function toBytes(value: number, byteLength: number): number[] {
  const bytes: number[] = [];
  for (let i = byteLength - 1; i >= 0; i--) {
    bytes.push((value >> (i * 8)) & 0xFF);
  }
  return bytes;
}

// Encode IMEI to login packet
export function encodeLoginPacket(imei: string): Uint8Array {
  const imeiBytes = new TextEncoder().encode(imei);
  const length = imeiBytes.length;
  const packet = new Uint8Array(2 + length);
  packet[0] = (length >> 8) & 0xFF;
  packet[1] = length & 0xFF;
  packet.set(imeiBytes, 2);
  return packet;
}

// Encode a single AVL data record (Codec 8)
function encodeAVLRecord(gpsData: GPSData, ioElements: IOElement[], codecId: number): number[] {
  const bytes: number[] = [];

  // Timestamp (8 bytes, Unix ms)
  bytes.push(...toBytes(gpsData.timestamp, 8));

  // Priority (1 byte)
  bytes.push(gpsData.priority & 0xFF);

  // GPS Element
  // Longitude (4 bytes, int32, multiplied by 10000000)
  const lonInt = Math.round(gpsData.longitude * 10000000);
  bytes.push(...toBytes(lonInt >>> 0, 4));

  // Latitude (4 bytes, int32, multiplied by 10000000)
  const latInt = Math.round(gpsData.latitude * 10000000);
  bytes.push(...toBytes(latInt >>> 0, 4));

  // Altitude (2 bytes, int16)
  bytes.push(...toBytes(gpsData.altitude & 0xFFFF, 2));

  // Angle (2 bytes, uint16)
  bytes.push(...toBytes(gpsData.angle & 0xFFFF, 2));

  // Satellites (1 byte)
  bytes.push(gpsData.satellites & 0xFF);

  // Speed (2 bytes, uint16, km/h)
  bytes.push(...toBytes(gpsData.speed & 0xFFFF, 2));

  // IO Elements
  // Group by size
  const io1 = ioElements.filter(e => e.size === 1);
  const io2 = ioElements.filter(e => e.size === 2);
  const io4 = ioElements.filter(e => e.size === 4);
  const io8 = ioElements.filter(e => e.size === 8);

  if (codecId === 0x8E) {
    // Codec 8 Extended uses 2-byte IO IDs
    // Event IO ID (2 bytes)
    bytes.push(0x00, 0x00); // Event ID = 0

    // N1 count (2 bytes for extended)
    bytes.push(...toBytes(io1.length, 2));
    for (const io of io1) {
      bytes.push(...toBytes(io.id, 2));
      bytes.push(io.value & 0xFF);
    }

    // N2 count (2 bytes)
    bytes.push(...toBytes(io2.length, 2));
    for (const io of io2) {
      bytes.push(...toBytes(io.id, 2));
      bytes.push(...toBytes(io.value, 2));
    }

    // N4 count (2 bytes)
    bytes.push(...toBytes(io4.length, 2));
    for (const io of io4) {
      bytes.push(...toBytes(io.id, 2));
      bytes.push(...toBytes(io.value, 4));
    }

    // N8 count (2 bytes)
    bytes.push(...toBytes(io8.length, 2));
    for (const io of io8) {
      bytes.push(...toBytes(io.id, 2));
      bytes.push(...toBytes(io.value, 8));
    }
  } else {
    // Codec 8 uses 1-byte IO IDs
    // Event IO ID (1 byte)
    bytes.push(0x00); // Event ID = 0

    // N1 count (1 byte)
    bytes.push(io1.length & 0xFF);
    for (const io of io1) {
      bytes.push(io.id & 0xFF);
      bytes.push(io.value & 0xFF);
    }

    // N2 count (1 byte)
    bytes.push(io2.length & 0xFF);
    for (const io of io2) {
      bytes.push(io.id & 0xFF);
      bytes.push(...toBytes(io.value, 2));
    }

    // N4 count (1 byte)
    bytes.push(io4.length & 0xFF);
    for (const io of io4) {
      bytes.push(io.id & 0xFF);
      bytes.push(...toBytes(io.value, 4));
    }

    // N8 count (1 byte)
    bytes.push(io8.length & 0xFF);
    for (const io of io8) {
      bytes.push(io.id & 0xFF);
      bytes.push(...toBytes(io.value, 8));
    }
  }

  return bytes;
}

// Encode full AVL data packet
export function encodeAVLPacket(packet: AVLPacket): Uint8Array {
  const { gpsData, ioElements, codecId } = packet;

  // Encode AVL record
  const recordBytes = encodeAVLRecord(gpsData, ioElements, codecId);

  // Build data field: Codec ID + Record Count + Records + Record Count
  const dataField: number[] = [];
  dataField.push(codecId & 0xFF); // Codec ID
  dataField.push(0x01); // Number of records (1)
  dataField.push(...recordBytes);
  dataField.push(0x01); // Number of records (repeated)

  // Calculate data field length
  const dataFieldLength = dataField.length;

  // Build complete packet
  const fullPacket: number[] = [];

  // Preamble (4 bytes, always 0x00000000)
  fullPacket.push(0x00, 0x00, 0x00, 0x00);

  // Data field length (4 bytes)
  fullPacket.push(...toBytes(dataFieldLength, 4));

  // Data field
  fullPacket.push(...dataField);

  // Calculate CRC-16 over data field length + data field
  const crcData = new Uint8Array([...toBytes(dataFieldLength, 4), ...dataField]);
  const crc = crc16(crcData);
  fullPacket.push(...toBytes(crc, 2));

  return new Uint8Array(fullPacket);
}

// Convert bytes to hex string
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join(' ')
    .toUpperCase();
}

// Decode an AVL packet for display
export function decodeAVLPacket(hexData: string): {
  preamble: string;
  dataLength: number;
  codecId: number;
  codecName: string;
  recordCount: number;
  timestamp: Date;
  priority: string;
  longitude: number;
  latitude: number;
  altitude: number;
  angle: number;
  satellites: number;
  speed: number;
  ioElements: { id: number; name: string; value: number; size: number }[];
  crc: string;
} | null {
  try {
    const bytes = hexData.replace(/\s/g, '').match(/.{2}/g)?.map(h => parseInt(h, 16)) || [];
    if (bytes.length < 12) return null;

    const preamble = bytes.slice(0, 4).map(b => b.toString(16).padStart(2, '0')).join('');
    const dataLength = (bytes[4] << 24) | (bytes[5] << 16) | (bytes[6] << 8) | bytes[7];
    const codecId = bytes[8];
    const codecName = codecId === 0x08 ? 'Codec 8' : codecId === 0x8E ? 'Codec 8 Extended' : `Unknown (0x${codecId.toString(16)})`;
    const recordCount = bytes[9];

    // Parse GPS data
    let offset = 10;
    const tsBytes = bytes.slice(offset, offset + 8);
    let timestamp = 0;
    for (let i = 0; i < 8; i++) {
      timestamp = timestamp * 256 + tsBytes[i];
    }
    offset += 8;

    const priority = bytes[offset]; offset++;
    const priorityName = priority === 0 ? 'Low' : priority === 1 ? 'High' : priority === 2 ? 'Panic' : 'Unknown';

    // Longitude
    const lonBytes = bytes.slice(offset, offset + 4);
    let lonInt = 0;
    for (let i = 0; i < 4; i++) lonInt = lonInt * 256 + lonBytes[i];
    if (lonInt > 0x7FFFFFFF) lonInt -= 0x100000000;
    const longitude = lonInt / 10000000;
    offset += 4;

    // Latitude
    const latBytes = bytes.slice(offset, offset + 4);
    let latInt = 0;
    for (let i = 0; i < 4; i++) latInt = latInt * 256 + latBytes[i];
    if (latInt > 0x7FFFFFFF) latInt -= 0x100000000;
    const latitude = latInt / 10000000;
    offset += 4;

    // Altitude
    const altitude = (bytes[offset] << 8) | bytes[offset + 1];
    offset += 2;

    // Angle
    const angle = (bytes[offset] << 8) | bytes[offset + 1];
    offset += 2;

    // Satellites
    const satellites = bytes[offset]; offset++;

    // Speed
    const speed = (bytes[offset] << 8) | bytes[offset + 1];
    offset += 2;

    // IO Elements
    const ioElements: { id: number; name: string; value: number; size: number }[] = [];

    if (codecId === 0x8E) {
      // Extended codec - 2 byte IO IDs
      const eventId = (bytes[offset] << 8) | bytes[offset + 1]; offset += 2;

      const n1 = (bytes[offset] << 8) | bytes[offset + 1]; offset += 2;
      for (let i = 0; i < n1; i++) {
        const id = (bytes[offset] << 8) | bytes[offset + 1]; offset += 2;
        const value = bytes[offset]; offset++;
        ioElements.push({ id, name: IO_ELEMENT_NAMES[id] || `IO_${id}`, value, size: 1 });
      }

      const n2 = (bytes[offset] << 8) | bytes[offset + 1]; offset += 2;
      for (let i = 0; i < n2; i++) {
        const id = (bytes[offset] << 8) | bytes[offset + 1]; offset += 2;
        const value = (bytes[offset] << 8) | bytes[offset + 1]; offset += 2;
        ioElements.push({ id, name: IO_ELEMENT_NAMES[id] || `IO_${id}`, value, size: 2 });
      }

      const n4 = (bytes[offset] << 8) | bytes[offset + 1]; offset += 2;
      for (let i = 0; i < n4; i++) {
        const id = (bytes[offset] << 8) | bytes[offset + 1]; offset += 2;
        let value = 0;
        for (let j = 0; j < 4; j++) value = value * 256 + bytes[offset + j];
        offset += 4;
        ioElements.push({ id, name: IO_ELEMENT_NAMES[id] || `IO_${id}`, value, size: 4 });
      }

      const n8 = (bytes[offset] << 8) | bytes[offset + 1]; offset += 2;
      for (let i = 0; i < n8; i++) {
        const id = (bytes[offset] << 8) | bytes[offset + 1]; offset += 2;
        let value = 0;
        for (let j = 0; j < 8; j++) value = value * 256 + bytes[offset + j];
        offset += 8;
        ioElements.push({ id, name: IO_ELEMENT_NAMES[id] || `IO_${id}`, value, size: 8 });
      }
    } else {
      // Standard Codec 8 - 1 byte IO IDs
      const eventId = bytes[offset]; offset++;

      const n1 = bytes[offset]; offset++;
      for (let i = 0; i < n1; i++) {
        const id = bytes[offset]; offset++;
        const value = bytes[offset]; offset++;
        ioElements.push({ id, name: IO_ELEMENT_NAMES[id] || `IO_${id}`, value, size: 1 });
      }

      const n2 = bytes[offset]; offset++;
      for (let i = 0; i < n2; i++) {
        const id = bytes[offset]; offset++;
        const value = (bytes[offset] << 8) | bytes[offset + 1]; offset += 2;
        ioElements.push({ id, name: IO_ELEMENT_NAMES[id] || `IO_${id}`, value, size: 2 });
      }

      const n4 = bytes[offset]; offset++;
      for (let i = 0; i < n4; i++) {
        const id = bytes[offset]; offset++;
        let value = 0;
        for (let j = 0; j < 4; j++) value = value * 256 + bytes[offset + j];
        offset += 4;
        ioElements.push({ id, name: IO_ELEMENT_NAMES[id] || `IO_${id}`, value, size: 4 });
      }

      const n8 = bytes[offset]; offset++;
      for (let i = 0; i < n8; i++) {
        const id = bytes[offset]; offset++;
        let value = 0;
        for (let j = 0; j < 8; j++) value = value * 256 + bytes[offset + j];
        offset += 8;
        ioElements.push({ id, name: IO_ELEMENT_NAMES[id] || `IO_${id}`, value, size: 8 });
      }
    }

    // CRC (last 2 bytes)
    const crc = bytes.slice(-2).map(b => b.toString(16).padStart(2, '0')).join('');

    return {
      preamble,
      dataLength,
      codecId,
      codecName,
      recordCount,
      timestamp: new Date(timestamp),
      priority: priorityName,
      longitude,
      latitude,
      altitude,
      angle,
      satellites,
      speed,
      ioElements,
      crc,
    };
  } catch {
    return null;
  }
}
