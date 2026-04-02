# Phase 0 Gap Analysis

This document records the protocol and architecture mismatches that exist in
the codebase before Phase 1 implementation starts. It is the factual bridge
between the current implementation and the frozen Phase 0 protocol spec.

---

## Current-State Summary

The desktop app already assumes a structured serial protocol, but only for a
subset of domains and without handshake, capability discovery, or proper
streaming semantics. The firmware is still largely menu-driven and does not yet
behave as a structured protocol endpoint.

---

## Desktop Gaps

### `main.js`

Current behavior:

- parses only `UART`, `SPI`, `CANFD`, and `I2C`
- treats everything else as raw text
- does not recognize `SYS:*`
- does not recognize `LOG:*`
- does not distinguish stream events from direct terminal responses
- tracks round-trip time with `lastSentAt`, but not true per-command in-flight
  state

Evidence:

- `main.js` uses `line.trim().match(/^(UART|SPI|CANFD|I2C):([A-Z]+):(.*)$/)`

Phase 0 implication:

- the parser contract must expand to include `SYS` and `LOG`
- in-flight tracking must be a formal state model, not just RTT timing

### `frontend/protocols.js`

Current behavior:

- defines command presets for `UART`, `SPI`, `CANFD`, and `I2C`
- still emits `CAN:*` commands inside the `CANFD` section
- assumes `SPI:XFER` is effectively single-byte
- exposes an outdated `UART:BAUD` concept not present in the frozen v1 spec
- exposes `I2C:INIT` plus a single-byte custom path instead of register reads
- local `parseLine()` recognizes only `UART`, `SPI`, `CANFD`, and `I2C`

Evidence:

- `CANFD` preset commands currently use `CAN:INIT`, `CAN:SEND`, `CAN:STATUS`
- `parseLine()` currently matches only `^(UART|SPI|CANFD|I2C):([A-Z]+):(.*)$`

Phase 0 implication:

- the canonical v1 command catalog cannot be inferred from this file
- this file must become a UI description derived from the spec, not the spec
  itself

### `frontend/app.js`

Current behavior:

- imports `parseLine` from `frontend/protocols.js`
- assumes parser output is shaped like `{ proto, status, data }`
- has no board-profile handshake layer
- has no capability-driven UI gating model yet

Phase 0 implication:

- parser API must be frozen before UI logic is rewritten
- board identity and capability support must become first-class concepts

---

## Firmware Gaps

### `DevBoard/Core/Src/dev.c`

Current behavior:

- largely menu-driven
- processes bytes from the UART receive ring buffer as immediate user input
- assumes interactive mode selection rather than line-oriented command parsing

Phase 0 implication:

- Phase 1 needs a line accumulator and command dispatcher layered on top of the
  existing UART plumbing

### `DevBoard/Core/Src/can.c`

Current behavior:

- contains reusable low-level CAN support
- not yet wrapped in a structured `CANFD:*` protocol surface

Phase 0 implication:

- the frozen protocol should preserve reuse of low-level CAN code while moving
  command semantics into dedicated protocol handlers

---

## Protocol-Spec Gaps Closed By Phase 0

The frozen spec now resolves these previously ambiguous areas:

- `CANFD` is the canonical domain name across all layers
- `SYS:HELLO` and `SYS:CAPS` define handshake and capability discovery
- `LOG:*` is separated from result frames
- one in-flight command per board is the desktop rule
- GUI-local timeout and firmware `TIMEOUT` are distinct
- `SPI:XFER` is variable-length, not single-byte only
- `I2C:READ` and `I2C:WRITE` use an explicit register-style v1 model
- `UART:STREAM` and `CANFD:MONITOR` define streaming event semantics
- legacy mode entry and exit are explicit

---

## Phase 1 Entry Condition

Phase 1 should not invent new wire behavior beyond what is frozen in
`serial-protocol-v1.md`. Any deviation discovered during implementation should
be treated as a spec issue and resolved in documentation before becoming code.

