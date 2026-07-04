// frontend/port-select.js
// Pure auto-selection rule for port dropdowns: keep whatever the user picked
// if it still exists; otherwise offer the first ST-Link (the NUCLEO's own
// VCP) and never auto-pick an arbitrary non-ST-Link port.

export function choosePortSelection(ports, currentValue) {
  const list = Array.isArray(ports) ? ports : [];

  if (currentValue && list.some(port => port.path === currentValue)) {
    return currentValue;
  }

  const stLink = list.find(port => port.isStLink);
  return stLink ? stLink.path : '';
}
