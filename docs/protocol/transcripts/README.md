# Transcript Fixtures

This folder contains replayable serial-session fixtures for Phase 5.

## Purpose

These fixtures are used by the desktop replay test suite to verify that:

- protocol frames still parse correctly
- handshake identity stays stable
- stream events remain distinct from terminal responses
- firmware-emitted `TIMEOUT` frames remain distinct from GUI-local timeouts
- legacy-mode entry and recovery stay represented in the wire contract

## Format

Each fixture is a JSON file with:

- `name`: stable transcript identifier
- `steps`: ordered serial events
- `expect`: expected replay summary

Each step uses one of:

- `tx`: command sent by the GUI
- `rx`: line received from firmware
- `local-timeout`: GUI-local timeout synthesized because no terminal frame arrived

## Current Fixture Set

- `handshake-success.json`
- `handshake-timeout.json`
- `uart-loopback.json`
- `spi-burst-success.json`
- `canfd-monitor.json`
- `i2c-read-success.json`
- `firmware-timeout.json`
- `gui-host-timeout.json`
- `legacy-mode-enter-exit.json`

These are not a replacement for hardware validation. They are a stable regression
layer for parser and session-behavior changes.
