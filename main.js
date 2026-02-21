const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const dgram = require('dgram');
const os = require('os');

const CONFIG_PATH = path.join(app.getPath('userData'), 'settings.json');

// ── Helpers ──────────────────────────────────────────────────────────────────

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch (e) {
    console.error('Failed to load config:', e);
  }
  return { devices: {} };
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf-8');
}

// ── GStreamer check ──────────────────────────────────────────────────────────

function findGstreamer() {
  try {
    const ver = execSync('gst-launch-1.0 --version', { encoding: 'utf-8', timeout: 5000 });
    return { found: true, version: ver.trim().split('\n')[0] };
  } catch {
    return { found: false };
  }
}

function checkGstreamerPlugins() {
  const required = ['wasapi2src', 'audioconvert', 'audioresample', 'rtpL16pay', 'udpsink'];
  const missing = [];
  for (const p of required) {
    try {
      execSync(`gst-inspect-1.0 ${p}`, { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' });
    } catch {
      missing.push(p);
    }
  }
  return missing;
}

// ── Device enumeration via gst-device-monitor ───────────────────────────────

function enumerateDevices() {
  try {
    const raw = execSync('gst-device-monitor-1.0 Audio/Source', {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const devices = [];
    const blocks = raw.split(/\n\s*\n/);

    for (const block of blocks) {
      const nameMatch = block.match(/name\s*:\s*(.+)/i);
      const classMatch = block.match(/class\s*:\s*(.+)/i);

      // Extract the full device.id value (e.g. {0.0.0.00000000}.{guid} or just {guid})
      const deviceIdMatch = block.match(/device\.id\s*=\s*(\S+)/i);
      // Extract loopback flag
      const loopbackMatch = block.match(/wasapi2\.device\.loopback\s*=\s*(\w+)/i);
      const apiMatch = block.match(/device\.api\s*=\s*(\S+)/i);

      if (nameMatch && deviceIdMatch) {
        const fullId = deviceIdMatch[1].trim();
        const isLoopback = loopbackMatch ? loopbackMatch[1] === 'true' : false;

        devices.push({
          name: nameMatch[1].trim(),
          id: fullId,
          class: classMatch ? classMatch[1].trim() : 'Unknown',
          api: apiMatch ? apiMatch[1].trim() : 'unknown',
          isLoopback: isLoopback
        });
      }
    }

    // Also try wasapi2 specific enumeration
    try {
      const raw2 = execSync('gst-device-monitor-1.0 Audio/Source Audio/Duplex', {
        encoding: 'utf-8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      // parse additionally if needed — for now the first pass should cover it
    } catch {}

    // Deduplicate by id
    const seen = new Set();
    const uniqueDevices = devices.filter(d => {
      if (seen.has(d.id)) return false;
      seen.add(d.id);
      return true;
    });

    // Sort devices alphabetically by name
    uniqueDevices.sort((a, b) => a.name.localeCompare(b.name));

    return uniqueDevices;
  } catch (e) {
    console.error('Device enumeration failed:', e.message);
    return [];
  }
}

// ── Multicast collision detection ───────────────────────────────────────────

function checkMulticastInUse(host, port) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    let received = false;
    const timeout = setTimeout(() => {
      sock.close();
      resolve(false);
    }, 1500);

    sock.on('message', () => {
      received = true;
      clearTimeout(timeout);
      sock.close();
      resolve(true);
    });

    sock.on('error', () => {
      clearTimeout(timeout);
      try { sock.close(); } catch {}
      resolve(false);
    });

    sock.bind(port, () => {
      try {
        sock.addMembership(host);
      } catch {
        clearTimeout(timeout);
        try { sock.close(); } catch {}
        resolve(false);
      }
    });
  });
}

// ── GStreamer pipeline management ───────────────────────────────────────────

const runningProcesses = {}; // deviceId -> child_process

function buildPipeline(deviceId, cfg) {
  const bindAddr = cfg.bindAddress && cfg.bindAddress !== '0.0.0.0'
    ? `bind-address=${cfg.bindAddress}` : '';
  const loopback = cfg.isLoopback ? 'loopback=true' : '';
  return `gst-launch-1.0 -e wasapi2src device="${deviceId}" ${loopback} ! audio/x-raw,channels=2,rate=48000 ! audioconvert ! audioresample ! rtpL16pay ! udpsink host=${cfg.host} port=${cfg.port} auto-multicast=true ${bindAddr}`.replace(/\s+/g, ' ').trim();
}

function startStream(deviceId, cfg) {
  if (runningProcesses[deviceId]) return { ok: false, error: 'Already running' };

  const bindAddr = cfg.bindAddress && cfg.bindAddress !== '0.0.0.0'
    ? `bind-address=${cfg.bindAddress}` : '';

  const args = [
    '-e',
    'wasapi2src', `device=${deviceId}`,
    ...(cfg.isLoopback ? ['loopback=true'] : []),
    '!', 'audio/x-raw,channels=2,rate=48000',
    '!', 'audioconvert',
    '!', 'audioresample',
    '!', 'rtpL16pay',
    '!', 'udpsink', `host=${cfg.host}`, `port=${cfg.port}`, 'auto-multicast=true',
    ...(bindAddr ? [bindAddr] : [])
  ];

  const child = spawn('gst-launch-1.0', args, { stdio: ['pipe', 'pipe', 'pipe'] });

  child.on('error', (err) => {
    console.error(`Stream error for ${deviceId}:`, err.message);
    delete runningProcesses[deviceId];
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('stream-status', { deviceId, status: 'error', error: err.message });
    }
  });

  child.on('exit', (code) => {
    console.log(`Stream exited for ${deviceId} code=${code}`);
    delete runningProcesses[deviceId];
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('stream-status', { deviceId, status: 'stopped' });
    }
  });

  child.stderr.on('data', (d) => {
    const msg = d.toString();
    console.log(`[gst:${deviceId}] ${msg}`);
    if (/error/i.test(msg) && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('stream-log', { deviceId, message: msg });
    }
  });

  runningProcesses[deviceId] = child;
  return { ok: true };
}

function stopStream(deviceId) {
  const child = runningProcesses[deviceId];
  if (!child) return;
  try {
    child.kill('SIGINT');
  } catch {}
  delete runningProcesses[deviceId];
}

function getNetworkInterfaces() {
  const ifaces = os.networkInterfaces();
  const result = [];
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const a of addrs) {
      if (a.family === 'IPv4' && !a.internal) {
        result.push({ name, address: a.address });
      }
    }
  }
  return result;
}

// ── Window ──────────────────────────────────────────────────────────────────

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 820,
    height: 700,
    minWidth: 600,
    minHeight: 450,
    backgroundColor: '#1e1e1e',
    title: 'AntiDante — Audio Streamer',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.setMenu(null);
  mainWindow.loadFile('index.html');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── IPC handlers ────────────────────────────────────────────────────────────

ipcMain.handle('check-gstreamer', () => {
  const gs = findGstreamer();
  if (!gs.found) return { found: false };
  const missing = checkGstreamerPlugins();
  return { found: true, version: gs.version, missingPlugins: missing };
});

ipcMain.handle('get-devices', () => enumerateDevices());

ipcMain.handle('get-network-interfaces', () => getNetworkInterfaces());

ipcMain.handle('load-config', () => loadConfig());

ipcMain.handle('save-config', (_, cfg) => {
  saveConfig(cfg);
  return true;
});

ipcMain.handle('check-multicast', async (_, host, port) => {
  return await checkMulticastInUse(host, port);
});

ipcMain.handle('start-stream', async (_, deviceId, cfg) => {
  return startStream(deviceId, cfg);
});

ipcMain.handle('stop-stream', (_, deviceId) => {
  stopStream(deviceId);
  return true;
});

ipcMain.handle('get-running-streams', () => {
  return Object.keys(runningProcesses);
});

ipcMain.handle('get-config-path', () => CONFIG_PATH);

// ── App lifecycle ───────────────────────────────────────────────────────────

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('in-process-gpu');
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('use-gl', 'angle');
// ── Offline: prevent any outgoing network from Electron/Chromium ────────────
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-domain-reliability');
app.commandLine.appendSwitch('disable-sync');
app.commandLine.appendSwitch('disable-default-apps');
app.commandLine.appendSwitch('no-proxy-server');

app.whenReady().then(() => {
  // Block all outgoing HTTP(S) requests at the session level
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url;
    // Allow only local file:// and devtools:// protocols
    if (url.startsWith('file://') || url.startsWith('devtools://') || url.startsWith('chrome-devtools://')) {
      callback({});
    } else {
      console.log(`[offline] Blocked external request: ${url}`);
      callback({ cancel: true });
    }
  });

  createWindow();
});

app.on('window-all-closed', () => {
  // Stop all streams before quitting
  for (const id of Object.keys(runningProcesses)) {
    stopStream(id);
  }
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
