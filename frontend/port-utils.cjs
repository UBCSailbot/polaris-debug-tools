// frontend/port-utils.cjs
// Serial-port list normalization for main.js. ST-Link (the NUCLEO's onboard
// debugger/VCP) is detected by USB VID 0483 or by name, and sorted first so
// the board port is always the obvious pick in the GUI.
'use strict';

const ST_VENDOR_ID = '0483';
const ST_NAME_RE = /st[\s_-]?link|stmicroelectronics/i;

function isStLinkPort(port) {
  if (!port) {
    return false;
  }

  const vid = String(port.vendorId || '').trim().toLowerCase().replace(/^0x/, '');
  if (vid === ST_VENDOR_ID) {
    return true;
  }

  return ST_NAME_RE.test(String(port.manufacturer || '')) ||
         ST_NAME_RE.test(String(port.friendlyName || ''));
}

function comNumber(path) {
  const match = path.match(/^COM(\d+)$/i);
  return match ? Number(match[1]) : null;
}

/**
 * Dedupe, flag, and sort a raw port list (from SerialPort.list() or the
 * Windows PowerShell fallback). ST-Link ports sort first; within each group
 * ports are ordered by COM number, then by path.
 */
function normalizeListedPorts(ports) {
  const seen = new Map();

  for (const port of ports || []) {
    const portPath = String(port?.path || port?.DeviceID || '').trim();

    if (!portPath || seen.has(portPath)) {
      continue;
    }

    const normalized = {
      path: portPath,
      manufacturer: String(port?.manufacturer || port?.Manufacturer || '').trim(),
      friendlyName: String(port?.friendlyName || port?.Name || '').trim(),
      vendorId: String(port?.vendorId || '').trim(),
      productId: String(port?.productId || '').trim(),
    };
    normalized.isStLink = isStLinkPort(normalized);
    seen.set(portPath, normalized);
  }

  return Array.from(seen.values()).sort((a, b) => {
    if (a.isStLink !== b.isStLink) {
      return a.isStLink ? -1 : 1;
    }

    const numA = comNumber(a.path);
    const numB = comNumber(b.path);
    if (numA != null && numB != null) {
      return numA - numB;
    }

    return a.path.localeCompare(b.path);
  });
}

module.exports = { normalizeListedPorts, isStLinkPort };
