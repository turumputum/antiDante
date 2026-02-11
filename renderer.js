// ── State ────────────────────────────────────────────────────────────────────
let config = { devices: {} };
let devices = [];
let networkInterfaces = [];
let runningStreams = new Set();
let gstreamerOk = false;

const $ = (s, p) => (p || document).querySelector(s);
const $$ = (s, p) => [...(p || document).querySelectorAll(s)];

// ── Helpers ──────────────────────────────────────────────────────────────────

function getDeviceConfig(deviceId) {
  return config.devices[deviceId] || {
    host: '239.0.7.1',
    hostSuffix: '1',
    port: 7777,
    bindAddress: '0.0.0.0',
    autoStart: false,
    enabled: false
  };
}

function setDeviceConfig(deviceId, cfg) {
  config.devices[deviceId] = cfg;
  window.api.saveConfig(config);
}

function validateSettings(cfg) {
  const errors = [];
  const suffix = parseInt(cfg.hostSuffix, 10);
  if (isNaN(suffix) || suffix < 0 || suffix > 254) errors.push('Последний октет IP должен быть 0–254');
  const port = parseInt(cfg.port, 10);
  if (isNaN(port) || port < 1024 || port > 65535) errors.push('Порт должен быть 1024–65535');
  return errors;
}

function buildHost(suffix) {
  return `239.0.7.${suffix}`;
}

// ── Render device list ──────────────────────────────────────────────────────

function renderDevices() {
  const list = $('#device-list');

  if (!devices.length) {
    list.innerHTML = '<div class="placeholder">Аудиоустройства не найдены.<br>Убедитесь, что GStreamer установлен корректно.</div>';
    return;
  }

  list.innerHTML = '';

  for (const dev of devices) {
    const cfg = getDeviceConfig(dev.id);
    const isRunning = runningStreams.has(dev.id);
    const errors = validateSettings(cfg);
    const hasErrors = errors.length > 0;

    let statusClass = 'status-inactive';
    if (isRunning) statusClass = 'status-running';
    else if (hasErrors && cfg.enabled) statusClass = 'status-error';

    const card = document.createElement('div');
    card.className = `device-card ${statusClass}`;
    card.dataset.deviceId = dev.id;

    card.innerHTML = `
      <div class="device-header">
        <div class="device-indicator"></div>
        <span class="device-name" title="${escHtml(dev.name)}">${escHtml(dev.name)}</span>
        <span class="device-id-badge" title="${escHtml(dev.id)}">${escHtml(dev.id)}</span>
        <label class="device-toggle" title="Вкл / Выкл поток">
          <input type="checkbox" class="toggle-stream" data-id="${escAttr(dev.id)}" ${isRunning ? 'checked' : ''} ${!gstreamerOk ? 'disabled' : ''}>
          <span class="toggle-track"></span>
        </label>
        <span class="expand-arrow">▶</span>
      </div>
      <div class="device-settings">
        <div class="settings-grid">
          <label>Multicast IP:</label>
          <div class="ip-row">
            <span class="ip-prefix">239.0.7.</span>
            <input type="text" class="cfg-host-suffix" value="${cfg.hostSuffix || '1'}" maxlength="3" data-id="${escAttr(dev.id)}">
          </div>

          <label>Порт:</label>
          <input type="text" class="cfg-port" value="${cfg.port || 7777}" maxlength="5" data-id="${escAttr(dev.id)}">

          <label>Bind адрес:</label>
          <select class="cfg-bind" data-id="${escAttr(dev.id)}">
            <option value="0.0.0.0" ${cfg.bindAddress === '0.0.0.0' ? 'selected' : ''}>Все интерфейсы (0.0.0.0)</option>
            ${networkInterfaces.map(ni =>
              `<option value="${ni.address}" ${cfg.bindAddress === ni.address ? 'selected' : ''}>${escHtml(ni.name)} — ${ni.address}</option>`
            ).join('')}
          </select>

          <label>Автозапуск:</label>
          <div class="checkbox-row">
            <input type="checkbox" class="cfg-autostart" data-id="${escAttr(dev.id)}" ${cfg.autoStart ? 'checked' : ''}>
            <span style="font-size:11px;color:var(--text-dim)">Запускать поток при старте</span>
          </div>
        </div>
        ${hasErrors && cfg.enabled ? `<div class="error-msg">⚠ ${errors.join('; ')}</div>` : ''}
        <div class="settings-actions">
          <button class="btn btn-sm btn-save" data-id="${escAttr(dev.id)}">Сохранить</button>
        </div>
      </div>
    `;

    list.appendChild(card);
  }

  // Bind events
  bindDeviceEvents();
}

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
function escAttr(s) {
  return s.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Event binding ───────────────────────────────────────────────────────────

function bindDeviceEvents() {
  // Expand / collapse
  for (const hdr of $$('.device-header')) {
    hdr.addEventListener('click', (e) => {
      // Don't toggle when clicking the switch
      if (e.target.closest('.device-toggle')) return;
      const card = hdr.closest('.device-card');
      card.classList.toggle('expanded');
    });
  }

  // Toggle stream on/off
  for (const toggle of $$('.toggle-stream')) {
    toggle.addEventListener('change', async (e) => {
      e.stopPropagation();
      const deviceId = toggle.dataset.id;
      if (toggle.checked) {
        await doStartStream(deviceId);
      } else {
        await doStopStream(deviceId);
      }
    });
  }

  // Save settings
  for (const btn of $$('.btn-save')) {
    btn.addEventListener('click', (e) => {
      const deviceId = btn.dataset.id;
      saveDeviceSettings(deviceId);
    });
  }

  // Dirty-tracking for settings fields
  for (const card of $$('.device-card')) {
    const deviceId = card.dataset.deviceId;
    const cfg = getDeviceConfig(deviceId);

    const suffixInput = $('.cfg-host-suffix', card);
    const portInput = $('.cfg-port', card);
    const bindSelect = $('.cfg-bind', card);
    const autoStartCheck = $('.cfg-autostart', card);
    const saveBtn = $('.btn-save', card);

    const savedValues = {
      hostSuffix: String(cfg.hostSuffix || '1'),
      port: String(cfg.port || 7777),
      bindAddress: cfg.bindAddress || '0.0.0.0',
      autoStart: !!cfg.autoStart
    };

    function checkDirty() {
      let hasDirty = false;

      const fields = [
        { el: suffixInput, current: suffixInput.value.trim(), saved: savedValues.hostSuffix },
        { el: portInput, current: portInput.value.trim(), saved: savedValues.port },
        { el: bindSelect, current: bindSelect.value, saved: savedValues.bindAddress },
      ];

      for (const f of fields) {
        const isDirty = f.current !== f.saved;
        f.el.classList.toggle('dirty', isDirty);
        if (isDirty) hasDirty = true;
      }

      // Checkbox dirty
      const autoStartDirty = autoStartCheck.checked !== savedValues.autoStart;
      autoStartCheck.classList.toggle('dirty', autoStartDirty);
      if (autoStartDirty) hasDirty = true;

      saveBtn.classList.toggle('has-changes', hasDirty);
    }

    suffixInput.addEventListener('input', checkDirty);
    portInput.addEventListener('input', checkDirty);
    bindSelect.addEventListener('change', checkDirty);
    autoStartCheck.addEventListener('change', checkDirty);
  }
}

async function saveDeviceSettings(deviceId) {
  const card = $(`.device-card[data-device-id="${CSS.escape(deviceId)}"]`);
  if (!card) return;

  const suffix = $(`.cfg-host-suffix[data-id="${CSS.escape(deviceId)}"]`, card).value.trim();
  const port = $(`.cfg-port[data-id="${CSS.escape(deviceId)}"]`, card).value.trim();
  const bind = $(`.cfg-bind[data-id="${CSS.escape(deviceId)}"]`, card).value;
  const autoStart = $(`.cfg-autostart[data-id="${CSS.escape(deviceId)}"]`, card).checked;

  const cfg = {
    host: buildHost(suffix),
    hostSuffix: suffix,
    port: parseInt(port, 10) || 7777,
    bindAddress: bind,
    autoStart,
    enabled: true
  };

  const wasRunning = runningStreams.has(deviceId);

  setDeviceConfig(deviceId, cfg);

  // Restart stream if it was running
  if (wasRunning) {
    await doStopStream(deviceId);
    await doStartStream(deviceId);
  }

  renderDevices();
}

// ── Stream control ──────────────────────────────────────────────────────────

async function doStartStream(deviceId) {
  const cfg = getDeviceConfig(deviceId);
  const errors = validateSettings(cfg);
  if (errors.length > 0) {
    updateCardStatus(deviceId, 'error');
    return;
  }

  const host = buildHost(cfg.hostSuffix);
  const port = parseInt(cfg.port, 10);

  // Check multicast collision
  try {
    const inUse = await window.api.checkMulticast(host, port);
    if (inUse) {
      alert(`Адрес ${host}:${port} уже используется другим потоком!`);
      updateCardStatus(deviceId, 'error');
      return;
    }
  } catch {}

  const streamCfg = {
    host,
    port,
    bindAddress: cfg.bindAddress || '0.0.0.0'
  };

  const result = await window.api.startStream(deviceId, streamCfg);
  if (result.ok) {
    runningStreams.add(deviceId);
    updateCardStatus(deviceId, 'running');
  } else {
    updateCardStatus(deviceId, 'error');
  }
}

async function doStopStream(deviceId) {
  await window.api.stopStream(deviceId);
  runningStreams.delete(deviceId);
  updateCardStatus(deviceId, 'inactive');
}

function updateCardStatus(deviceId, status) {
  const card = $(`.device-card[data-device-id="${CSS.escape(deviceId)}"]`);
  if (!card) return;
  card.classList.remove('status-inactive', 'status-running', 'status-error');
  card.classList.add(`status-${status}`);
  const toggle = $('.toggle-stream', card);
  if (toggle) toggle.checked = status === 'running';
}

// ── Auto-start streams ─────────────────────────────────────────────────────

async function autoStartStreams() {
  for (const dev of devices) {
    const cfg = getDeviceConfig(dev.id);
    if (cfg.autoStart && cfg.enabled) {
      const errors = validateSettings(cfg);
      if (errors.length === 0) {
        await doStartStream(dev.id);
      }
    }
  }
  renderDevices();
}

// ── Initialization ──────────────────────────────────────────────────────────

async function init() {
  // 1. Check GStreamer
  const gs = await window.api.checkGstreamer();
  if (!gs.found) {
    $('#modal-overlay').classList.remove('hidden');
    $('#modal-close-btn').addEventListener('click', () => {
      $('#modal-overlay').classList.add('hidden');
    });
    gstreamerOk = false;
  } else {
    gstreamerOk = true;
    $('#gst-version').textContent = gs.version;

    if (gs.missingPlugins && gs.missingPlugins.length > 0) {
      $('#modal-overlay').classList.remove('hidden');
      $('.modal h2').textContent = '⚠ Отсутствуют плагины GStreamer';
      $('#modal-missing-plugins').innerHTML =
        `<p class="missing-list"><b>Отсутствующие плагины:</b> ${gs.missingPlugins.join(', ')}</p>`;
      $('#modal-close-btn').addEventListener('click', () => {
        $('#modal-overlay').classList.add('hidden');
      });
    }
  }

  // 2. Load config
  config = await window.api.loadConfig();
  if (!config.devices) config.devices = {};

  // 3. Get network interfaces
  networkInterfaces = await window.api.getNetworkInterfaces();

  // 4. Get running streams
  const running = await window.api.getRunningStreams();
  runningStreams = new Set(running);

  // 5. Enumerate devices
  await refreshDevices();

  // 6. Auto-start
  if (gstreamerOk) {
    await autoStartStreams();
  }

  // 7. Listen for events
  window.api.onStreamStatus((data) => {
    if (data.status === 'stopped' || data.status === 'error') {
      runningStreams.delete(data.deviceId);
    }
    updateCardStatus(data.deviceId, data.status === 'stopped' ? 'inactive' : data.status);
  });

  window.api.onStreamLog((data) => {
    console.warn(`[Stream ${data.deviceId}]`, data.message);
  });
}

async function refreshDevices() {
  const list = $('#device-list');
  list.innerHTML = '<div class="placeholder">Поиск устройств…</div>';
  devices = await window.api.getDevices();

  // Merge new devices with existing config (keep settings, mark new ones)
  for (const dev of devices) {
    if (!config.devices[dev.id]) {
      config.devices[dev.id] = {
        host: '239.0.7.1',
        hostSuffix: '1',
        port: 7777,
        bindAddress: '0.0.0.0',
        autoStart: false,
        enabled: false
      };
    }
  }

  renderDevices();
}

// ── Bind global UI ──────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  $('#btn-refresh').addEventListener('click', refreshDevices);
  init();
});
