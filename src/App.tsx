import { useState, useEffect, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  encodeAVLPacket,
  encodeLoginPacket,
  bytesToHex,
  decodeAVLPacket,
  IO_ELEMENTS,
  IO_ELEMENT_NAMES,
  type AVLPacket,
  type GPSData,
  type IOElement,
} from './teltonika/protocol';

// Fix leaflet default marker icon
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

// Custom vehicle icon
const vehicleIcon = new L.Icon({
  iconUrl: 'data:image/svg+xml;base64,' + btoa(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32">
      <circle cx="12" cy="12" r="10" fill="#3B82F6" stroke="#1E40AF" stroke-width="2"/>
      <polygon points="12,4 18,16 12,13 6,16" fill="white"/>
    </svg>
  `),
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

interface LogEntry {
  id: number;
  timestamp: Date;
  type: 'login' | 'data' | 'response';
  hexData: string;
  decoded?: ReturnType<typeof decodeAVLPacket>;
  direction: 'send' | 'receive';
}

interface SimConfig {
  imei: string;
  codecId: number;
  startLat: number;
  startLng: number;
  speed: number;
  heading: number;
  interval: number;
  satellites: number;
  priority: number;
  protocol: 'TCP' | 'UDP';
  serverHost: string;
  serverPort: number;
}

function MapUpdater({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, map.getZoom());
  }, [center, map]);
  return null;
}

export default function App() {
  const [config, setConfig] = useState<SimConfig>({
    imei: '352093081234567',
    codecId: 0x08,
    startLat: -6.2088,
    startLng: 106.8456,
    speed: 60,
    heading: 45,
    interval: 10,
    satellites: 12,
    priority: 0,
    protocol: 'TCP',
    serverHost: '192.168.1.100',
    serverPort: 5027,
  });

  const [isRunning, setIsRunning] = useState(false);
  const [currentPos, setCurrentPos] = useState<[number, number]>([config.startLat, config.startLng]);
  const [path, setPath] = useState<[number, number][]>([[config.startLat, config.startLng]]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [lastPacket, setLastPacket] = useState<string>('');
  const [lastDecoded, setLastDecoded] = useState<ReturnType<typeof decodeAVLPacket>>(null);
  const [ioElements, setIoElements] = useState<IOElement[]>([
    { id: IO_ELEMENTS.IGNITION, value: 1, size: 1 },
    { id: IO_ELEMENTS.MOTION, value: 1, size: 1 },
    { id: IO_ELEMENTS.EXTERNAL_VOLTAGE, value: 12450, size: 2 },
    { id: IO_ELEMENTS.BATTERY_VOLTAGE, value: 3980, size: 2 },
    { id: IO_ELEMENTS.GSM_SIGNAL, value: 4, size: 1 },
    { id: IO_ELEMENTS.SPEED, value: 60, size: 2 },
    { id: IO_ELEMENTS.TOTAL_ODOMETER, value: 15230, size: 4 },
  ]);
  const [showLoginSent, setShowLoginSent] = useState(false);
  const [loginHex, setLoginHex] = useState('');
  const [activeTab, setActiveTab] = useState<'map' | 'packet' | 'log' | 'config'>('map');
  const [totalPackets, setTotalPackets] = useState(0);
  const logEndRef = useRef<HTMLDivElement>(null);
  const logIdRef = useRef(0);

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Generate GPS data
  const generateGPSData = useCallback((): GPSData => {
    return {
      timestamp: Date.now(),
      priority: config.priority,
      longitude: currentPos[1],
      latitude: currentPos[0],
      altitude: 50,
      angle: config.heading,
      satellites: config.satellites,
      speed: config.speed,
    };
  }, [currentPos, config]);

  // Send packet
  const sendPacket = useCallback(() => {
    const gpsData = generateGPSData();
    const packet: AVLPacket = {
      imei: config.imei,
      gpsData,
      ioElements,
      codecId: config.codecId,
    };

    const encoded = encodeAVLPacket(packet);
    const hex = bytesToHex(encoded);

    setLastPacket(hex);
    setLastDecoded(decodeAVLPacket(hex));
    setTotalPackets(p => p + 1);

    const entry: LogEntry = {
      id: logIdRef.current++,
      timestamp: new Date(),
      type: 'data',
      hexData: hex,
      decoded: decodeAVLPacket(hex),
      direction: 'send',
    };
    setLogs(prev => [...prev.slice(-99), entry]);

    // Simulate server response (0x01 for accepted)
    setTimeout(() => {
      const responseEntry: LogEntry = {
        id: logIdRef.current++,
        timestamp: new Date(),
        type: 'response',
        hexData: '01',
        direction: 'receive',
      };
      setLogs(prev => [...prev.slice(-99), responseEntry]);
    }, 50);
  }, [generateGPSData, config, ioElements]);

  // Simulation loop
  useEffect(() => {
    if (!isRunning) return;

    const interval = setInterval(() => {
      // Calculate new position based on speed and heading
      const speedMs = config.speed / 3.6; // Convert km/h to m/s
      const dt = config.interval / 1000; // Convert ms to seconds
      const distance = speedMs * dt; // meters

      // Convert heading to radians
      const headingRad = (config.heading * Math.PI) / 180;

      // Calculate new position (simplified flat earth approximation)
      const latChange = (distance * Math.cos(headingRad)) / 111320;
      const lngChange = (distance * Math.sin(headingRad)) / (111320 * Math.cos((currentPos[0] * Math.PI) / 180));

      const newLat = currentPos[0] + latChange;
      const newLng = currentPos[1] + lngChange;

      setCurrentPos([newLat, newLng]);
      setPath(prev => [...prev.slice(-500), [newLat, newLng]]);

      // Update speed IO element
      setIoElements(prev => prev.map(io =>
        io.id === IO_ELEMENTS.SPEED ? { ...io, value: config.speed } : io
      ));

      sendPacket();
    }, config.interval);

    return () => clearInterval(interval);
  }, [isRunning, config, currentPos, sendPacket]);

  // Send login packet
  const handleLogin = () => {
    const loginPacket = encodeLoginPacket(config.imei);
    const hex = bytesToHex(loginPacket);
    setLoginHex(hex);
    setShowLoginSent(true);

    const entry: LogEntry = {
      id: logIdRef.current++,
      timestamp: new Date(),
      type: 'login',
      hexData: hex,
      direction: 'send',
    };
    setLogs(prev => [...prev.slice(-99), entry]);

    // Simulate response
    setTimeout(() => {
      const responseEntry: LogEntry = {
        id: logIdRef.current++,
        timestamp: new Date(),
        type: 'response',
        hexData: '01',
        direction: 'receive',
      };
      setLogs(prev => [...prev.slice(-99), responseEntry]);
    }, 100);
  };

  // Send single packet manually
  const handleSendOnce = () => {
    sendPacket();
  };

  // Reset simulation
  const handleReset = () => {
    setIsRunning(false);
    setCurrentPos([config.startLat, config.startLng]);
    setPath([[config.startLat, config.startLng]]);
    setLogs([]);
    setLastPacket('');
    setLastDecoded(null);
    setTotalPackets(0);
    setShowLoginSent(false);
  };

  // Add IO element
  const addIOElement = (id: number, size: 1 | 2 | 4 | 8) => {
    if (!ioElements.find(e => e.id === id)) {
      setIoElements(prev => [...prev, { id, value: 0, size }]);
    }
  };

  // Remove IO element
  const removeIOElement = (id: number) => {
    setIoElements(prev => prev.filter(e => e.id !== id));
  };

  // Update IO element value
  const updateIOValue = (id: number, value: number) => {
    setIoElements(prev => prev.map(e => e.id === id ? { ...e, value } : e));
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-gray-900 text-white overflow-hidden">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-4 py-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <i className="fas fa-satellite text-white text-sm"></i>
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">Teltonika GPS Simulator</h1>
            <p className="text-xs text-gray-400">AVL Protocol (Codec 8 / Codec 8 Extended)</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-xs text-gray-400">
            <span className="text-green-400 font-mono">{config.protocol}</span> |
            <span className="ml-1">{config.serverHost}:{config.serverPort}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isRunning ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`}></div>
            <span className="text-xs text-gray-400">{isRunning ? 'RUNNING' : 'STOPPED'}</span>
          </div>
          <div className="text-xs text-gray-400">
            Packets: <span className="text-blue-400 font-mono">{totalPackets}</span>
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <nav className="bg-gray-800 border-b border-gray-700 px-4 flex gap-1 shrink-0">
        {[
          { id: 'map' as const, label: 'Map', icon: 'fa-map-location-dot' },
          { id: 'packet' as const, label: 'Packet Data', icon: 'fa-code' },
          { id: 'log' as const, label: 'Communication Log', icon: 'fa-list' },
          { id: 'config' as const, label: 'Configuration', icon: 'fa-gear' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <i className={`fas ${tab.icon} mr-2`}></i>
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Controls */}
        <div className="w-80 bg-gray-800 border-r border-gray-700 overflow-y-auto p-4 shrink-0">
          {/* Connection Controls */}
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-gray-300 mb-2 flex items-center gap-2">
              <i className="fas fa-plug text-blue-400"></i> Connection
            </h3>
            <div className="space-y-2">
              {!showLoginSent ? (
                <button
                  onClick={handleLogin}
                  className="w-full px-3 py-2 bg-green-600 hover:bg-green-700 rounded text-sm font-medium transition-colors"
                >
                  <i className="fas fa-sign-in-alt mr-2"></i> Send Login (IMEI)
                </button>
              ) : (
                <div className="px-3 py-2 bg-green-900/30 border border-green-700 rounded text-sm text-green-400">
                  <i className="fas fa-check-circle mr-2"></i> Connected
                </div>
              )}
            </div>
          </div>

          {/* Simulation Controls */}
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-gray-300 mb-2 flex items-center gap-2">
              <i className="fas fa-play text-green-400"></i> Simulation
            </h3>
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => setIsRunning(!isRunning)}
                className={`flex-1 px-3 py-2 rounded text-sm font-medium transition-colors ${
                  isRunning
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-green-600 hover:bg-green-700'
                }`}
              >
                <i className={`fas ${isRunning ? 'fa-stop' : 'fa-play'} mr-1`}></i>
                {isRunning ? 'Stop' : 'Start'}
              </button>
              <button
                onClick={handleSendOnce}
                className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium transition-colors"
              >
                <i className="fas fa-paper-plane mr-1"></i> Send
              </button>
              <button
                onClick={handleReset}
                className="px-3 py-2 bg-gray-600 hover:bg-gray-700 rounded text-sm font-medium transition-colors"
              >
                <i className="fas fa-redo"></i>
              </button>
            </div>
          </div>

          {/* GPS Parameters */}
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-gray-300 mb-2 flex items-center gap-2">
              <i className="fas fa-crosshairs text-yellow-400"></i> GPS Parameters
            </h3>
            <div className="space-y-2">
              <div>
                <label className="text-xs text-gray-400">Speed (km/h)</label>
                <input
                  type="range"
                  min="0"
                  max="200"
                  value={config.speed}
                  onChange={e => setConfig(c => ({ ...c, speed: Number(e.target.value) }))}
                  className="w-full accent-blue-500"
                />
                <div className="text-xs text-blue-400 font-mono">{config.speed} km/h</div>
              </div>
              <div>
                <label className="text-xs text-gray-400">Heading (°)</label>
                <input
                  type="range"
                  min="0"
                  max="359"
                  value={config.heading}
                  onChange={e => setConfig(c => ({ ...c, heading: Number(e.target.value) }))}
                  className="w-full accent-blue-500"
                />
                <div className="text-xs text-blue-400 font-mono">{config.heading}°</div>
              </div>
              <div>
                <label className="text-xs text-gray-400">Interval (ms)</label>
                <input
                  type="number"
                  min="100"
                  max="60000"
                  step="100"
                  value={config.interval}
                  onChange={e => setConfig(c => ({ ...c, interval: Number(e.target.value) }))}
                  className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-sm text-white"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">Satellites</label>
                <input
                  type="range"
                  min="0"
                  max="20"
                  value={config.satellites}
                  onChange={e => setConfig(c => ({ ...c, satellites: Number(e.target.value) }))}
                  className="w-full accent-blue-500"
                />
                <div className="text-xs text-blue-400 font-mono">{config.satellites} sats</div>
              </div>
              <div>
                <label className="text-xs text-gray-400">Priority</label>
                <select
                  value={config.priority}
                  onChange={e => setConfig(c => ({ ...c, priority: Number(e.target.value) }))}
                  className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-sm text-white"
                >
                  <option value={0}>Low (0)</option>
                  <option value={1}>High (1)</option>
                  <option value={2}>Panic (2)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Position Display */}
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-gray-300 mb-2 flex items-center gap-2">
              <i className="fas fa-location-dot text-red-400"></i> Current Position
            </h3>
            <div className="bg-gray-900 rounded p-2 space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Latitude:</span>
                <span className="text-white font-mono">{currentPos[0].toFixed(6)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Longitude:</span>
                <span className="text-white font-mono">{currentPos[1].toFixed(6)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Speed:</span>
                <span className="text-white font-mono">{config.speed} km/h</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Heading:</span>
                <span className="text-white font-mono">{config.heading}°</span>
              </div>
            </div>
          </div>

          {/* IO Elements */}
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-gray-300 mb-2 flex items-center gap-2">
              <i className="fas fa-microchip text-purple-400"></i> IO Elements
            </h3>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {ioElements.map(io => (
                <div key={io.id} className="flex items-center gap-1 bg-gray-900 rounded px-2 py-1">
                  <span className="text-xs text-gray-400 flex-1 truncate" title={IO_ELEMENT_NAMES[io.id]}>
                    {IO_ELEMENT_NAMES[io.id] || `IO_${io.id}`}
                  </span>
                  <input
                    type="number"
                    value={io.value}
                    onChange={e => updateIOValue(io.id, Number(e.target.value))}
                    className="w-16 px-1 py-0.5 bg-gray-700 border border-gray-600 rounded text-xs text-white text-right"
                  />
                  <button
                    onClick={() => removeIOElement(io.id)}
                    className="text-red-400 hover:text-red-300 text-xs px-1"
                  >
                    <i className="fas fa-times"></i>
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-2">
              <select
                onChange={e => {
                  const [idStr, sizeStr] = e.target.value.split(':');
                  addIOElement(Number(idStr), Number(sizeStr) as 1 | 2 | 4 | 8);
                  e.target.value = '';
                }}
                className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-xs text-white"
                defaultValue=""
              >
                <option value="" disabled>+ Add IO Element</option>
                {Object.entries(IO_ELEMENT_NAMES)
                  .filter(([id]) => !ioElements.find(e => e.id === Number(id)))
                  .map(([id, name]) => (
                    <option key={id} value={`${id}:${Number(id) > 100 ? 2 : 1}`}>
                      {name} (ID: {id})
                    </option>
                  ))}
              </select>
            </div>
          </div>
        </div>

        {/* Right Panel - Main Content */}
        <div className="flex-1 overflow-hidden">
          {activeTab === 'map' && (
            <div className="h-full relative">
              <MapContainer
                center={currentPos}
                zoom={15}
                className="h-full w-full"
                zoomControl={true}
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <Marker position={currentPos} icon={vehicleIcon}>
                  <Popup>
                    <div className="text-xs">
                      <strong>GPS Position</strong><br />
                      Lat: {currentPos[0].toFixed(6)}<br />
                      Lng: {currentPos[1].toFixed(6)}<br />
                      Speed: {config.speed} km/h<br />
                      Heading: {config.heading}°
                    </div>
                  </Popup>
                </Marker>
                {path.length > 1 && (
                  <Polyline positions={path} color="#3B82F6" weight={3} opacity={0.7} />
                )}
                <MapUpdater center={currentPos} />
              </MapContainer>
              {/* Map overlay info */}
              <div className="absolute top-4 right-4 bg-gray-900/90 backdrop-blur rounded-lg p-3 text-xs space-y-1 z-[1000]">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${isRunning ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`}></div>
                  <span className="text-gray-300">{isRunning ? 'Tracking' : 'Idle'}</span>
                </div>
                <div className="text-gray-400">IMEI: <span className="text-white font-mono">{config.imei}</span></div>
                <div className="text-gray-400">Codec: <span className="text-white">{config.codecId === 0x08 ? 'Codec 8' : 'Codec 8 Ext'}</span></div>
              </div>
            </div>
          )}

          {activeTab === 'packet' && (
            <div className="h-full overflow-y-auto p-4 space-y-4">
              {/* Raw Hex Data */}
              <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
                <div className="px-4 py-2 bg-gray-750 border-b border-gray-700 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-300">
                    <i className="fas fa-code text-blue-400 mr-2"></i>Raw Packet (Hex)
                  </h3>
                  {lastPacket && (
                    <button
                      onClick={() => navigator.clipboard.writeText(lastPacket.replace(/\s/g, ''))}
                      className="text-xs text-blue-400 hover:text-blue-300"
                    >
                      <i className="fas fa-copy mr-1"></i>Copy
                    </button>
                  )}
                </div>
                <div className="p-4 font-mono text-xs text-green-400 break-all max-h-40 overflow-y-auto">
                  {lastPacket || <span className="text-gray-500">No packet sent yet. Click "Send" to generate a packet.</span>}
                </div>
              </div>

              {/* Login Packet */}
              {loginHex && (
                <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
                  <div className="px-4 py-2 border-b border-gray-700">
                    <h3 className="text-sm font-semibold text-gray-300">
                      <i className="fas fa-key text-yellow-400 mr-2"></i>Login Packet (IMEI)
                    </h3>
                  </div>
                  <div className="p-4 font-mono text-xs text-yellow-400 break-all">
                    {loginHex}
                  </div>
                </div>
              )}

              {/* Decoded Packet */}
              {lastDecoded && (
                <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
                  <div className="px-4 py-2 border-b border-gray-700">
                    <h3 className="text-sm font-semibold text-gray-300">
                      <i className="fas fa-unlock text-green-400 mr-2"></i>Decoded Packet
                    </h3>
                  </div>
                  <div className="p-4 space-y-3">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-gray-900 rounded p-2">
                        <span className="text-gray-400">Preamble:</span>
                        <span className="text-white font-mono ml-2">0x{lastDecoded.preamble}</span>
                      </div>
                      <div className="bg-gray-900 rounded p-2">
                        <span className="text-gray-400">Data Length:</span>
                        <span className="text-white font-mono ml-2">{lastDecoded.dataLength} bytes</span>
                      </div>
                      <div className="bg-gray-900 rounded p-2">
                        <span className="text-gray-400">Codec:</span>
                        <span className="text-blue-400 font-mono ml-2">{lastDecoded.codecName}</span>
                      </div>
                      <div className="bg-gray-900 rounded p-2">
                        <span className="text-gray-400">Records:</span>
                        <span className="text-white font-mono ml-2">{lastDecoded.recordCount}</span>
                      </div>
                      <div className="bg-gray-900 rounded p-2">
                        <span className="text-gray-400">CRC-16:</span>
                        <span className="text-white font-mono ml-2">0x{lastDecoded.crc}</span>
                      </div>
                      <div className="bg-gray-900 rounded p-2">
                        <span className="text-gray-400">Priority:</span>
                        <span className={`font-mono ml-2 ${
                          lastDecoded.priority === 'Panic' ? 'text-red-400' :
                          lastDecoded.priority === 'High' ? 'text-yellow-400' : 'text-green-400'
                        }`}>{lastDecoded.priority}</span>
                      </div>
                    </div>

                    {/* GPS Data */}
                    <div>
                      <h4 className="text-xs font-semibold text-gray-400 mb-1">GPS Element</h4>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div className="bg-gray-900 rounded p-2">
                          <span className="text-gray-400">Timestamp:</span>
                          <div className="text-white font-mono">{lastDecoded.timestamp.toLocaleString()}</div>
                        </div>
                        <div className="bg-gray-900 rounded p-2">
                          <span className="text-gray-400">Longitude:</span>
                          <div className="text-white font-mono">{lastDecoded.longitude.toFixed(7)}</div>
                        </div>
                        <div className="bg-gray-900 rounded p-2">
                          <span className="text-gray-400">Latitude:</span>
                          <div className="text-white font-mono">{lastDecoded.latitude.toFixed(7)}</div>
                        </div>
                        <div className="bg-gray-900 rounded p-2">
                          <span className="text-gray-400">Altitude:</span>
                          <div className="text-white font-mono">{lastDecoded.altitude} m</div>
                        </div>
                        <div className="bg-gray-900 rounded p-2">
                          <span className="text-gray-400">Angle:</span>
                          <div className="text-white font-mono">{lastDecoded.angle}°</div>
                        </div>
                        <div className="bg-gray-900 rounded p-2">
                          <span className="text-gray-400">Satellites:</span>
                          <div className="text-white font-mono">{lastDecoded.satellites}</div>
                        </div>
                        <div className="bg-gray-900 rounded p-2">
                          <span className="text-gray-400">Speed:</span>
                          <div className="text-white font-mono">{lastDecoded.speed} km/h</div>
                        </div>
                      </div>
                    </div>

                    {/* IO Elements */}
                    <div>
                      <h4 className="text-xs font-semibold text-gray-400 mb-1">IO Elements</h4>
                      <div className="bg-gray-900 rounded overflow-hidden">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-gray-700">
                              <th className="px-3 py-1 text-left text-gray-400">ID</th>
                              <th className="px-3 py-1 text-left text-gray-400">Name</th>
                              <th className="px-3 py-1 text-right text-gray-400">Value</th>
                              <th className="px-3 py-1 text-right text-gray-400">Size</th>
                            </tr>
                          </thead>
                          <tbody>
                            {lastDecoded.ioElements.map((io, idx) => (
                              <tr key={idx} className="border-b border-gray-800">
                                <td className="px-3 py-1 text-blue-400 font-mono">{io.id}</td>
                                <td className="px-3 py-1 text-gray-300">{io.name}</td>
                                <td className="px-3 py-1 text-green-400 font-mono text-right">{io.value}</td>
                                <td className="px-3 py-1 text-gray-400 font-mono text-right">{io.size}B</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Protocol Structure */}
              <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
                <div className="px-4 py-2 border-b border-gray-700">
                  <h3 className="text-sm font-semibold text-gray-300">
                    <i className="fas fa-diagram-project text-orange-400 mr-2"></i>Packet Structure (Codec 8)
                  </h3>
                </div>
                <div className="p-4 text-xs font-mono space-y-1">
                  <div className="flex gap-2">
                    <span className="text-gray-400 w-32">Preamble (4B):</span>
                    <span className="text-yellow-400">00 00 00 00</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-gray-400 w-32">Data Length (4B):</span>
                    <span className="text-cyan-400">XX XX XX XX</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-gray-400 w-32">Codec ID (1B):</span>
                    <span className="text-blue-400">08 (Codec 8) / 8E (Ext)</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-gray-400 w-32">Record Count (1B):</span>
                    <span className="text-green-400">01</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-gray-400 w-32">Timestamp (8B):</span>
                    <span className="text-purple-400">Unix ms</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-gray-400 w-32">Priority (1B):</span>
                    <span className="text-red-400">0/1/2</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-gray-400 w-32">GPS Longitude (4B):</span>
                    <span className="text-orange-400">int32 × 10⁷</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-gray-400 w-32">GPS Latitude (4B):</span>
                    <span className="text-orange-400">int32 × 10⁷</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-gray-400 w-32">Altitude (2B):</span>
                    <span className="text-gray-300">meters</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-gray-400 w-32">Angle (2B):</span>
                    <span className="text-gray-300">degrees</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-gray-400 w-32">Satellites (1B):</span>
                    <span className="text-gray-300">count</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-gray-400 w-32">Speed (2B):</span>
                    <span className="text-gray-300">km/h</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-gray-400 w-32">IO Elements:</span>
                    <span className="text-pink-400">variable</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-gray-400 w-32">Record Count (1B):</span>
                    <span className="text-green-400">01</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-gray-400 w-32">CRC-16 (2B):</span>
                    <span className="text-red-400">checksum</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'log' && (
            <div className="h-full flex flex-col">
              <div className="px-4 py-2 bg-gray-800 border-b border-gray-700 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-300">
                  <i className="fas fa-terminal text-green-400 mr-2"></i>Communication Log
                </h3>
                <button
                  onClick={() => setLogs([])}
                  className="text-xs text-gray-400 hover:text-gray-200"
                >
                  <i className="fas fa-trash mr-1"></i>Clear
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-2 font-mono text-xs space-y-1">
                {logs.length === 0 ? (
                  <div className="text-gray-500 text-center py-8">
                    No communication yet. Send a login packet or start simulation.
                  </div>
                ) : (
                  logs.map(log => (
                    <div key={log.id} className={`flex gap-2 px-2 py-1 rounded ${
                      log.direction === 'send' ? 'bg-blue-900/20' : 'bg-green-900/20'
                    }`}>
                      <span className="text-gray-500 shrink-0">
                        {log.timestamp.toLocaleTimeString()}
                      </span>
                      <span className={`shrink-0 ${
                        log.direction === 'send' ? 'text-blue-400' : 'text-green-400'
                      }`}>
                        {log.direction === 'send' ? '→ TX' : '← RX'}
                      </span>
                      <span className="text-gray-400 shrink-0">
                        [{log.type.toUpperCase()}]
                      </span>
                      <span className={`${
                        log.type === 'response' ? 'text-green-400' : 'text-yellow-400'
                      } break-all`}>
                        {log.hexData.length > 80 ? log.hexData.substring(0, 80) + '...' : log.hexData}
                      </span>
                    </div>
                  ))
                )}
                <div ref={logEndRef} />
              </div>
            </div>
          )}

          {activeTab === 'config' && (
            <div className="h-full overflow-y-auto p-4 space-y-4">
              {/* Device Configuration */}
              <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
                <div className="px-4 py-2 border-b border-gray-700">
                  <h3 className="text-sm font-semibold text-gray-300">
                    <i className="fas fa-mobile-screen text-blue-400 mr-2"></i>Device Settings
                  </h3>
                </div>
                <div className="p-4 space-y-3">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">IMEI</label>
                    <input
                      type="text"
                      value={config.imei}
                      onChange={e => setConfig(c => ({ ...c, imei: e.target.value }))}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm text-white font-mono"
                      placeholder="15 digit IMEI"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Codec</label>
                    <select
                      value={config.codecId}
                      onChange={e => setConfig(c => ({ ...c, codecId: Number(e.target.value) }))}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm text-white"
                    >
                      <option value={0x08}>Codec 8 (0x08)</option>
                      <option value={0x8E}>Codec 8 Extended (0x8E)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Server Configuration */}
              <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
                <div className="px-4 py-2 border-b border-gray-700">
                  <h3 className="text-sm font-semibold text-gray-300">
                    <i className="fas fa-server text-green-400 mr-2"></i>Server Settings
                  </h3>
                </div>
                <div className="p-4 space-y-3">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Protocol</label>
                    <select
                      value={config.protocol}
                      onChange={e => setConfig(c => ({ ...c, protocol: e.target.value as 'TCP' | 'UDP' }))}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm text-white"
                    >
                      <option value="TCP">TCP</option>
                      <option value="UDP">UDP</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Server Host</label>
                    <input
                      type="text"
                      value={config.serverHost}
                      onChange={e => setConfig(c => ({ ...c, serverHost: e.target.value }))}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Server Port</label>
                    <input
                      type="number"
                      value={config.serverPort}
                      onChange={e => setConfig(c => ({ ...c, serverPort: Number(e.target.value) }))}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm text-white font-mono"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Common: 5027 (TCP data), 5028 (UDP data), 5029 (TCP login)
                    </p>
                  </div>
                </div>
              </div>

              {/* Starting Position */}
              <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
                <div className="px-4 py-2 border-b border-gray-700">
                  <h3 className="text-sm font-semibold text-gray-300">
                    <i className="fas fa-map-pin text-red-400 mr-2"></i>Starting Position
                  </h3>
                </div>
                <div className="p-4 space-y-3">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Latitude</label>
                    <input
                      type="number"
                      step="0.000001"
                      value={config.startLat}
                      onChange={e => setConfig(c => ({ ...c, startLat: Number(e.target.value) }))}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Longitude</label>
                    <input
                      type="number"
                      step="0.000001"
                      value={config.startLng}
                      onChange={e => setConfig(c => ({ ...c, startLng: Number(e.target.value) }))}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm text-white font-mono"
                    />
                  </div>
                  <div className="text-xs text-gray-500">
                    <p>Common locations:</p>
                    <button
                      onClick={() => setConfig(c => ({ ...c, startLat: -6.2088, startLng: 106.8456 }))}
                      className="text-blue-400 hover:text-blue-300 mr-2"
                    >Jakarta</button>
                    <button
                      onClick={() => setConfig(c => ({ ...c, startLat: 1.3521, startLng: 103.8198 }))}
                      className="text-blue-400 hover:text-blue-300 mr-2"
                    >Singapore</button>
                    <button
                      onClick={() => setConfig(c => ({ ...c, startLat: -8.3405, startLng: 115.0920 }))}
                      className="text-blue-400 hover:text-blue-300 mr-2"
                    >Bali</button>
                    <button
                      onClick={() => setConfig(c => ({ ...c, startLat: 51.5074, startLng: -0.1278 }))}
                      className="text-blue-400 hover:text-blue-300"
                    >London</button>
                  </div>
                </div>
              </div>

              {/* Protocol Info */}
              <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
                <div className="px-4 py-2 border-b border-gray-700">
                  <h3 className="text-sm font-semibold text-gray-300">
                    <i className="fas fa-info-circle text-yellow-400 mr-2"></i>Protocol Information
                  </h3>
                </div>
                <div className="p-4 text-xs text-gray-400 space-y-2">
                  <p><strong className="text-gray-300">Teltonika AVL Protocol</strong> is used by FMB920, FMB120, FMC640, and other Teltonika GPS trackers.</p>
                  <p><strong className="text-gray-300">Communication Flow:</strong></p>
                  <ol className="list-decimal list-inside space-y-1 ml-2">
                    <li>Device sends IMEI login packet</li>
                    <li>Server responds with 0x01 (accepted) or 0x00 (denied)</li>
                    <li>Device sends AVL data packets</li>
                    <li>Server responds with number of accepted records (4 bytes)</li>
                  </ol>
                  <p className="mt-2"><strong className="text-gray-300">Default Ports:</strong></p>
                  <ul className="list-disc list-inside ml-2 space-y-1">
                    <li>5027 - TCP Data</li>
                    <li>5028 - UDP Data</li>
                    <li>5029 - TCP Login</li>
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
