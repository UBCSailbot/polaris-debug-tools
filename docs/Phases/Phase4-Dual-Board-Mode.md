# Phase 4 - Dual-Board Mode

**Parent document:** [OfficialRoadmap.md](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/docs/OfficialRoadmap.md)  
**Goal:** Turn dual-board mode into a true two-board comparison workflow for two independent STM32-plus-breakout stacks.

## Purpose

The current dual-board view is conceptually useful, but Phase 4 makes it
protocol-aware and safe. The GUI must understand that it is managing two
separate smart bridge boards, each with its own capabilities, firmware version,
and attached hardware.

## Scope

### In Scope

- per-board handshake on connect
- per-board board-profile state
- capability intersection logic
- protocol-version mismatch warnings
- safe dual-command execution
- side-by-side presentation improvements driven by actual board state

### Out Of Scope

- deep automated diffing of every sensor payload
- board-to-board synchronization beyond the needs of shared operator actions

## Design Principles

1. Each board remains independent.
2. Dual mode compares, but does not merge, board state.
3. Commands available in dual mode must be safe on both boards.
4. Warnings must be explicit when versions or capabilities differ.

## Detailed Task Breakdown

### Task 4.1: Add Per-Board Handshake State

For each board connection in dual mode, store:

- connection state
- board profile
- in-flight state
- active stream flags
- latest direct command result

Do not reuse single-board state objects in ways that risk cross-contamination.

### Task 4.2: Compute Capability Intersection

When both boards are connected:

- compute domain cap intersection
- compute feature cap intersection
- only enable dual-mode preset actions that are supported by both boards

UI requirements:

- if a command is unavailable because one board lacks a cap, the reason should
  be visible

### Task 4.3: Compare Protocol Versions

When both board profiles are known:

- compare `proto`
- compare `fw`
- compare relevant caps

Surface warnings for:

- protocol version mismatch
- feature mismatch
- one board still in legacy mode

### Task 4.4: Make Shared Preset Execution Predictable

For dual-mode preset clicks:

- send command A to board A
- send command B to board B
- track each board independently
- render results side by side

Do not assume both responses arrive in the same order or at the same speed.

### Task 4.5: Improve Side-By-Side Result Presentation

Dual mode should show:

- command sent
- per-board result
- firmware/version info
- stream state where relevant

For readable comparison, expose:

- timestamp
- board label
- direct result
- last stream status if active

### Task 4.6: Handle Stream Controls Safely

If dual mode supports stream/monitor toggles:

- stream state must be per-board
- stop/start should not assume both boards are in identical states
- UI should clearly show if only one board is actively streaming

## File-Level Plan

Likely files involved:

- [main.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/main.js)
- [preload.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/preload.js)
- [frontend/app.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/frontend/app.js)
- possibly [frontend/visual.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/frontend/visual.js)

## Verification Plan

Test these scenarios:

1. same protocol version, same caps
2. same protocol version, different feature caps
3. different protocol versions
4. one board disconnected
5. one board in legacy mode
6. one board streaming, one idle

Expected outcomes:

- UI warns explicitly on mismatch
- only safe shared commands are available
- one board's failure does not corrupt the other board's state

## Exit Criteria

Phase 4 is complete only when:

- both boards handshake independently
- cap intersection gates shared controls
- mismatch conditions are surfaced clearly
- side-by-side commands execute without operator guesswork
