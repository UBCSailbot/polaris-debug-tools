// frontend/compat.js
// Firmware protocol-version compatibility checks.

export const REQUIRED_PROTO_VERSION = 1;

export function checkVersionCompat(profile) {
  if (!profile?.available) {
    return { compatible: null, firmwareVersion: null, protoVersion: null, warnMsg: null };
  }

  const protoVersion = typeof profile.proto === 'number' ? profile.proto : null;
  const firmwareVersion = profile.fw ?? null;

  if (protoVersion === null) {
    return {
      compatible: false,
      firmwareVersion,
      protoVersion: null,
      warnMsg: 'Firmware did not report a protocol version. Some features may not work correctly.',
    };
  }

  if (protoVersion < REQUIRED_PROTO_VERSION) {
    return {
      compatible: false,
      firmwareVersion,
      protoVersion,
      warnMsg: `Firmware protocol v${protoVersion} detected — v${REQUIRED_PROTO_VERSION} required. Update your firmware.`,
    };
  }

  // The spec (serial-protocol-v1.md section 17) requires wire-breaking changes
  // to bump the proto version, so a newer proto is not guaranteed to work with
  // this app either.
  if (protoVersion > REQUIRED_PROTO_VERSION) {
    return {
      compatible: false,
      firmwareVersion,
      protoVersion,
      warnMsg: `Firmware protocol v${protoVersion} is newer than this app supports (v${REQUIRED_PROTO_VERSION}). Update the desktop app.`,
    };
  }

  return { compatible: true, firmwareVersion, protoVersion, warnMsg: null };
}
