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

  return { compatible: true, firmwareVersion, protoVersion, warnMsg: null };
}
