import { PROTOCOLS, PROTOCOL_ORDER } from './protocols.js';

export function capsFromProfile(profile) {
  return new Set(profile?.available && Array.isArray(profile.caps) ? profile.caps : []);
}

export function computeSharedCaps(profileA, profileB) {
  const capsA = capsFromProfile(profileA);
  const capsB = capsFromProfile(profileB);

  if (!capsA.size || !capsB.size) {
    return new Set();
  }

  return new Set([...capsA].filter(cap => capsB.has(cap)));
}

export function computeSharedProtocols(profileA, profileB) {
  const sharedCaps = computeSharedCaps(profileA, profileB);
  return PROTOCOL_ORDER.filter(id => sharedCaps.has(PROTOCOLS[id].domainCap));
}

export function describeBoardProfile(profile, connected) {
  if (!connected) {
    return {
      summary: 'Disconnected',
      detail: 'Connect this STM32 bridge board to begin handshaking.',
    };
  }

  if (!profile?.available) {
    switch (profile?.reason) {
      case 'handshake-pending':
        return {
          summary: 'Waiting for SYS:HELLO',
          detail: 'The GUI is probing this board for protocol support.',
        };
      case 'handshake-timeout':
        return {
          summary: 'Handshake unavailable',
          detail: 'Raw terminal use is still possible, but shared controls stay locked.',
        };
      case 'handshake-write-failed':
        return {
          summary: 'Handshake write failed',
          detail: 'Check the serial link and board firmware state.',
        };
      default:
        return {
          summary: 'Board profile unavailable',
          detail: 'Shared protocol controls remain disabled until handshake completes.',
        };
    }
  }

  return {
    summary: `${profile.board || 'board'} | FW ${profile.fw || 'unknown'} | proto ${profile.proto ?? '-'}`,
    detail: profile.caps?.length ? `caps: ${profile.caps.join(', ')}` : 'No capabilities reported.',
  };
}

export function computeDualWarnings(boardA, boardB, activeProto = null) {
  const warnings = [];
  const profileA = boardA?.profile ?? null;
  const profileB = boardB?.profile ?? null;
  const capsA = capsFromProfile(profileA);
  const capsB = capsFromProfile(profileB);
  const onlyAStreaming = activeProto && boardA?.streaming?.has?.(activeProto) && !boardB?.streaming?.has?.(activeProto);
  const onlyBStreaming = activeProto && boardB?.streaming?.has?.(activeProto) && !boardA?.streaming?.has?.(activeProto);

  if (!boardA?.connected || !boardB?.connected) {
    warnings.push('Connect both boards to enable shared dual-board controls.');
    return warnings;
  }

  if (!profileA?.available || !profileB?.available) {
    warnings.push('Waiting for both boards to finish the protocol handshake.');
    return warnings;
  }

  if (boardA?.mode === 'legacy' || boardB?.mode === 'legacy') {
    warnings.push('One board is in legacy mode. Exit legacy mode before using shared controls.');
  }

  if (profileA.proto !== null && profileB.proto !== null && profileA.proto !== profileB.proto) {
    warnings.push(`Protocol mismatch: A uses proto ${profileA.proto}, B uses proto ${profileB.proto}.`);
  }

  if (profileA.fw && profileB.fw && profileA.fw !== profileB.fw) {
    warnings.push(`Firmware mismatch: A is ${profileA.fw}, B is ${profileB.fw}.`);
  }

  if (profileA.board && profileB.board && profileA.board !== profileB.board) {
    warnings.push(`Board type mismatch: A reports ${profileA.board}, B reports ${profileB.board}.`);
  }

  if (profileA.legacy !== profileB.legacy) {
    warnings.push('Legacy support differs between the two connected boards.');
  }

  if (profileA.caps?.length && profileB.caps?.length) {
    const onlyA = [...capsA].filter(cap => !capsB.has(cap));
    const onlyB = [...capsB].filter(cap => !capsA.has(cap));

    if (onlyA.length || onlyB.length) {
      const parts = [];

      if (onlyA.length) {
        parts.push(`A-only: ${onlyA.join(', ')}`);
      }
      if (onlyB.length) {
        parts.push(`B-only: ${onlyB.join(', ')}`);
      }

      warnings.push(`Capability mismatch. ${parts.join(' | ')}`);
    }
  }

  if (onlyAStreaming) {
    warnings.push(`Only board A is actively streaming ${activeProto} data.`);
  } else if (onlyBStreaming) {
    warnings.push(`Only board B is actively streaming ${activeProto} data.`);
  }

  return warnings;
}

export function getDualCommandDisabledReason(protoId, command, boardA, boardB) {
  const profileA = boardA?.profile ?? null;
  const profileB = boardB?.profile ?? null;
  const sharedCaps = computeSharedCaps(profileA, profileB);
  const proto = PROTOCOLS[protoId];

  if (!boardA?.connected || !boardB?.connected) {
    return 'Connect both boards first.';
  }

  if (!profileA?.available || !profileB?.available) {
    return 'Waiting for both board profiles.';
  }

  if (boardA?.mode === 'legacy' || boardB?.mode === 'legacy') {
    return 'Exit legacy mode on both boards before using shared controls.';
  }

  if (!proto || !sharedCaps.has(proto.domainCap)) {
    return 'Protocol is not supported by both connected boards.';
  }

  if (command.requiredCap && !sharedCaps.has(command.requiredCap)) {
    return 'Feature is not supported by both connected boards.';
  }

  return '';
}
