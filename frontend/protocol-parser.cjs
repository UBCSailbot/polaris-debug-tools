'use strict';

const KNOWN_DOMAINS = new Set(['SYS', 'LOG', 'UART', 'SPI', 'CANFD', 'I2C']);
const LOG_LEVELS = new Set(['INFO', 'WARN', 'ERROR']);
const TERMINAL_TYPES = new Set(['PASS', 'FAIL', 'TIMEOUT', 'INFO']);

function parseLine(raw) {
  const trimmed = String(raw ?? '').trim();
  let firstColon;
  let secondColon;
  let domain;
  let type;
  let payload;

  if (trimmed.length === 0) {
    return null;
  }

  firstColon = trimmed.indexOf(':');
  secondColon = trimmed.indexOf(':', firstColon + 1);
  if ((firstColon <= 0) || (secondColon < 0)) {
    return null;
  }

  domain = trimmed.slice(0, firstColon);
  type = trimmed.slice(firstColon + 1, secondColon);
  payload = trimmed.slice(secondColon + 1);

  if (!KNOWN_DOMAINS.has(domain) || !/^[A-Z0-9_]+$/.test(type)) {
    return null;
  }

  if (domain === 'LOG') {
    if (!LOG_LEVELS.has(type)) {
      return null;
    }
    return {
      raw: trimmed,
      domain,
      kind: 'log',
      level: type,
      payload,
      data: payload,
    };
  }

  if (domain === 'SYS') {
    return {
      raw: trimmed,
      domain,
      proto: domain,
      kind: 'system',
      type,
      status: type,
      payload,
      data: payload,
    };
  }

  if (TERMINAL_TYPES.has(type)) {
    return {
      raw: trimmed,
      domain,
      proto: domain,
      kind: 'response',
      type,
      status: type,
      payload,
      data: payload,
    };
  }

  return {
    raw: trimmed,
    domain,
    proto: domain,
    kind: 'event',
    type,
    event: type,
    payload,
    data: payload,
  };
}

function parseKeyValuePayload(payload) {
  const out = {};
  const text = String(payload ?? '').trim();
  let part;
  let eqIndex;
  let key;

  if (!text) {
    return out;
  }

  for (part of text.split(';')) {
    eqIndex = part.indexOf('=');
    if (eqIndex <= 0) {
      continue;
    }
    key = part.slice(0, eqIndex).trim();
    if (!key) {
      continue;
    }
    out[key] = part.slice(eqIndex + 1).trim();
  }

  return out;
}

function parseCapabilities(payload) {
  const fields = parseKeyValuePayload(payload);
  const caps = typeof fields.caps === 'string' && fields.caps.length > 0
    ? fields.caps.split(',').map(cap => cap.trim()).filter(Boolean)
    : [];
  let proto = null;
  let legacy = null;

  if (fields.proto != null && /^\d+$/.test(fields.proto)) {
    proto = parseInt(fields.proto, 10);
  }

  if (fields.legacy === '1') {
    legacy = true;
  } else if (fields.legacy === '0') {
    legacy = false;
  }

  return {
    proto,
    fw: fields.fw || null,
    board: fields.board || null,
    caps,
    legacy,
  };
}

function isTerminalFrame(parsed) {
  if (!parsed) {
    return false;
  }
  if (parsed.kind === 'response') {
    return true;
  }
  return parsed.kind === 'system' && parsed.type === 'INFO';
}

function isStreamingEvent(parsed) {
  if (!parsed || parsed.kind !== 'event') {
    return false;
  }
  return (
    (parsed.domain === 'UART' && parsed.event === 'DATA') ||
    (parsed.domain === 'CANFD' && parsed.event === 'FRAME')
  );
}

function isLog(parsed) {
  return !!parsed && parsed.kind === 'log';
}

module.exports = {
  parseLine,
  parseCapabilities,
  isTerminalFrame,
  isStreamingEvent,
  isLog,
  parseKeyValuePayload,
};
