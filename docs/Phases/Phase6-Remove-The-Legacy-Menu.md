# Phase 6 - Remove The Legacy Menu

**Parent document:** [OfficialRoadmap.md](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/docs/OfficialRoadmap.md)  
**Goal:** Remove the old menu-driven control path once the protocol-driven GUI workflow is proven stable and complete.

## Purpose

The legacy menu is useful only as a temporary safety net during migration. Once
the protocol path is validated, keeping the menu indefinitely increases
maintenance cost and creates two competing control planes.

Phase 6 removes that duplication.

## Preconditions

Do not begin Phase 6 until all of the following are true:

- Phase 5 hardware acceptance matrix is complete
- no operator workflow depends on menu navigation
- raw/manual debugging still works via GUI terminal and direct command entry
- `SYS:RESET` and legacy mode behavior have been tested thoroughly during soak

## Scope

### In Scope

- removing menu-first control path from firmware default logic
- removing legacy-mode UI entry points if appropriate
- deleting dead code and obsolete docs
- updating operator documentation

### Out Of Scope

- removal of raw command entry from GUI
- removal of protocol logs from terminal view

## Detailed Task Breakdown

### Task 6.1: Audit Remaining Legacy Dependencies

Search for:

- menu text strings
- menu-mode enums
- `SYS:MODE:LEGACY`
- legacy UI toggles in Electron app
- documentation that still tells users to use PuTTY/menu navigation

Create a checklist of:

- code that must be deleted
- code that must remain temporarily
- docs that must be rewritten

### Task 6.2: Remove Legacy Entry From UI

Once the fallback is no longer needed:

- remove or hide advanced settings entry for legacy mode
- remove any state or IPC plumbing used only for legacy transition

### Task 6.3: Remove Legacy Runtime Path From Firmware

In firmware:

- remove legacy menu boot path
- remove legacy menu handlers if no longer needed
- remove fallback-specific mode transitions
- keep protocol mode as the sole control path

### Task 6.4: Retain Raw Debugging Through Protocol Path

Before deleting legacy code, verify that operators still have:

- raw command entry in GUI
- log visibility
- ability to test individual commands directly

### Task 6.5: Update Documentation

Revise docs so they no longer describe the menu as part of normal operation.

Update:

- official roadmap if needed
- bringup guides
- operator instructions
- any test procedures that reference manual menu navigation

### Task 6.6: Run Final Smoke Tests

After removal:

- re-run handshake
- re-run one command per transport
- re-run stream/monitor paths
- verify GUI raw/manual path still works

## File-Level Plan

Likely files to touch:

- [DevBoard/Core/Src/dev.c](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/DevBoard/Core/Src/dev.c)
- [frontend/app.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/frontend/app.js)
- [preload.js](C:/Users/aayus/Desktop/UBC%20Sailbot/polaris-debug-tools/preload.js)
- docs that reference legacy mode

## Exit Criteria

Phase 6 is complete only when:

- the firmware has one control plane: the protocol
- the GUI no longer depends on or exposes legacy mode
- all required operator/debug workflows still work without the menu
