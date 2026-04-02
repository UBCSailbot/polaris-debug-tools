const views = document.querySelectorAll(".workflow-btn");
const panels = document.querySelectorAll(".view-panel");
const dockToggle = document.getElementById("dock-toggle");
const dock = document.getElementById("log-dock");
const dockState = dockToggle.querySelector(".dock-state");
const dockLog = document.getElementById("dock-log");
const activityList = document.getElementById("activity-list");
const stageChart = document.getElementById("stage-chart");
const commandStack = document.getElementById("command-stack");
const observeTitle = document.getElementById("observe-title");
const observeCopy = document.getElementById("observe-copy");
const stageHeading = document.getElementById("stage-heading");
const dataPreview = document.getElementById("data-preview");
const metricEvents = document.getElementById("metric-events");
const metricRtt = document.getElementById("metric-rtt");
const kvList = document.getElementById("kv-list");
const inspectorList = document.getElementById("inspector-list");
const compareVerdict = document.getElementById("compare-verdict");
const sharedActions = document.getElementById("shared-actions");

const observeButtons = document.querySelectorAll("#observe-protocols .segment");
const compareButtons = document.querySelectorAll("#compare-protocols .segment");

const activitySeed = [
  "SYS handshake complete, caps confirmed for UART, SPI, CANFD, I2C.",
  "UART loop test passed in 18 ms.",
  "SPI WHO_AM_I returned device signature 0x68.",
  "I2C scan found devices at 0x50 and 0x6A.",
  "CANFD monitor captured 12 frames without bus errors.",
];

const observeContent = {
  UART: {
    title: "UART Command Stack",
    copy: "Fast loopback and stream controls for bench bring-up.",
    stage: "UART Throughput",
    preview: "UART:DATA:244750524D432C313731...",
    metrics: [["status", "PASS"], ["streaming", "1"], ["last burst", "32 bytes"]],
    inspector: [["Protocol", "UART"], ["Command", "STREAM:START"], ["Status", "PASS"], ["RTT", "18 ms"], ["Event cadence", "steady"]],
    commands: [["Init", "Reset the UART bridge state.", "Arm"], ["Loop Test", "Send one byte and verify the echo path.", "Run"], ["Start Stream", "Forward unsolicited UART RX data.", "Start"], ["Stop Stream", "Stop forwarding UART RX data.", "Stop"]],
    bars: [34, 42, 55, 38, 62, 58, 66, 60, 72, 68, 58, 44, 48, 54, 51, 62, 70, 64],
  },
  SPI: {
    title: "SPI Command Stack",
    copy: "Identity reads and custom bursts tuned for bench verification.",
    stage: "SPI Burst Response",
    preview: "SPI:PASS:tx=75FF;rx=0068",
    metrics: [["status", "PASS"], ["latest tx", "75FF"], ["device id", "0x68"]],
    inspector: [["Protocol", "SPI"], ["Command", "XFER"], ["Status", "PASS"], ["RTT", "9 ms"], ["Frame pair", "tx / rx aligned"]],
    commands: [["Init", "Prepare CS and transfer counters.", "Arm"], ["WHO_AM_I", "Read a known identity register.", "Read"], ["Transfer", "Send a custom burst in uppercase hex.", "Open"], ["Status", "Inspect transfer totals and timing.", "Check"]],
    bars: [22, 18, 26, 21, 30, 26, 34, 28, 37, 33, 40, 35, 32, 29, 24, 26, 20, 18],
  },
  CANFD: {
    title: "CANFD Command Stack",
    copy: "Bus send, monitor, and controller state for live network verification.",
    stage: "CANFD Frame Density",
    preview: "CANFD:FRAME:130:8:DEADBEEF01020304",
    metrics: [["status", "PASS"], ["monitoring", "1"], ["frames", "44"]],
    inspector: [["Protocol", "CANFD"], ["Command", "MONITOR:START"], ["Status", "PASS"], ["RTT", "14 ms"], ["Bus state", "error active"]],
    commands: [["Init", "Bring the controller online.", "Arm"], ["Monitor", "Forward all received frames.", "Start"], ["Send Frame", "Transmit a custom standard ID frame.", "Send"], ["Status", "Inspect PSR and error state.", "Check"]],
    bars: [10, 24, 18, 36, 22, 42, 30, 50, 24, 55, 28, 48, 20, 39, 32, 46, 30, 40],
  },
  I2C: {
    title: "I2C Command Stack",
    copy: "Register reads and scans centered on real device bring-up.",
    stage: "I2C Device Activity",
    preview: "I2C:PASS:addr=0x6A;reg=0x28;bytes=A102B300C501",
    metrics: [["status", "PASS"], ["devices", "2"], ["last read", "6 bytes"]],
    inspector: [["Protocol", "I2C"], ["Command", "READ"], ["Status", "PASS"], ["RTT", "12 ms"], ["Last target", "0x6A / reg 0x28"]],
    commands: [["Init", "Prepare the bridge and clear errors.", "Arm"], ["Scan", "Probe the 7-bit address space.", "Run"], ["Read Register", "Read bytes from a register-addressed target.", "Open"], ["Write Bytes", "Write arbitrary bytes to a device.", "Open"]],
    bars: [14, 12, 19, 17, 23, 20, 26, 22, 28, 31, 25, 29, 21, 24, 18, 20, 17, 22],
  },
};

const compareContent = {
  UART: { verdict: "Aligned for UART link validation", actions: ["Loop Test", "Start Stream", "Stop Stream", "Status"] },
  SPI: { verdict: "Aligned for SPI burst parity checks", actions: ["WHO_AM_I", "Status", "Trigger Burst"] },
  CANFD: { verdict: "Aligned for CANFD bus send and passive monitor checks", actions: ["Monitor Start", "Monitor Stop", "Status"] },
  I2C: { verdict: "Aligned for I2C scan and register read comparisons", actions: ["Scan", "Read Register", "Status"] },
};

function timestamp() {
  const now = new Date();
  return now.toTimeString().slice(0, 8);
}

function setView(name) {
  views.forEach((button) => {
    button.classList.toggle("active", button.dataset.view === name);
  });
  panels.forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.panel === name);
  });
  appendDockLog(`view switched to ${name}.`);
}

function appendDockLog(message) {
  const entry = document.createElement("div");
  entry.textContent = `[${timestamp()}] ${message}`;
  dockLog.prepend(entry);
  while (dockLog.children.length > 8) {
    dockLog.removeChild(dockLog.lastElementChild);
  }
}

function appendActivity(message) {
  const item = document.createElement("div");
  const time = document.createElement("span");
  const copy = document.createElement("span");

  item.className = "activity-item";
  time.className = "activity-time";
  copy.className = "activity-copy";
  time.textContent = timestamp();
  copy.textContent = message;
  item.append(time, copy);
  activityList.prepend(item);

  while (activityList.children.length > 5) {
    activityList.removeChild(activityList.lastElementChild);
  }
}

function renderBars(values) {
  stageChart.innerHTML = "";
  values.forEach((value) => {
    const bar = document.createElement("div");
    bar.className = "chart-bar";
    bar.style.height = `${Math.max(12, value)}%`;
    stageChart.appendChild(bar);
  });
}

function renderObserve(proto) {
  const model = observeContent[proto];
  if (!model) {
    return;
  }

  observeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.proto === proto);
  });

  observeTitle.textContent = model.title;
  observeCopy.textContent = model.copy;
  stageHeading.textContent = model.stage;
  dataPreview.textContent = model.preview;
  metricEvents.textContent = String(90 + Math.floor(Math.random() * 40));
  metricRtt.textContent = `${8 + Math.floor(Math.random() * 14)} ms`;

  kvList.innerHTML = "";
  model.metrics.forEach(([label, value]) => {
    const span = document.createElement("span");
    span.innerHTML = `${label} <strong>${value}</strong>`;
    kvList.appendChild(span);
  });

  inspectorList.innerHTML = "";
  model.inspector.forEach(([label, value]) => {
    const row = document.createElement("div");
    const left = document.createElement("span");
    const right = document.createElement("strong");
    left.textContent = label;
    right.textContent = value;
    if (value === "PASS") {
      right.classList.add("ok-text");
    }
    row.append(left, right);
    inspectorList.appendChild(row);
  });

  commandStack.innerHTML = "";
  model.commands.forEach(([title, copy, cta]) => {
    const chip = document.createElement("div");
    chip.className = "command-chip";
    chip.innerHTML = `
      <div>
        <strong>${title}</strong>
        <span>${copy}</span>
      </div>
      <button class="chip-action" type="button">${cta}</button>
    `;
    chip.querySelector("button").addEventListener("click", () => {
      appendDockLog(`${proto.toLowerCase()} action "${title}" triggered from observe workspace.`);
    });
    commandStack.appendChild(chip);
  });

  renderBars(model.bars);
}

function renderCompare(proto) {
  const model = compareContent[proto];
  if (!model) {
    return;
  }

  compareButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.compare === proto);
  });

  compareVerdict.textContent = model.verdict;
  sharedActions.innerHTML = "";
  model.actions.forEach((action) => {
    const button = document.createElement("button");
    button.className = action.toLowerCase().includes("start") ? "accent-btn" : "line-btn";
    button.type = "button";
    button.textContent = action;
    button.addEventListener("click", () => {
      appendDockLog(`shared ${proto.toLowerCase()} action "${action}" sent to board A and board B.`);
    });
    sharedActions.appendChild(button);
  });
}

views.forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});

observeButtons.forEach((button) => {
  button.addEventListener("click", () => renderObserve(button.dataset.proto));
});

compareButtons.forEach((button) => {
  button.addEventListener("click", () => renderCompare(button.dataset.compare));
});

dockToggle.addEventListener("click", () => {
  dock.classList.toggle("collapsed");
  dockState.textContent = dock.classList.contains("collapsed") ? "Expand" : "Collapse";
});

document.querySelectorAll(".quick-action").forEach((button) => {
  button.addEventListener("click", () => {
    const message = button.dataset.log || "operator action queued";
    appendDockLog(message);
    appendActivity(message.charAt(0).toUpperCase() + message.slice(1) + ".");
  });
});

setInterval(() => {
  const message = activitySeed[Math.floor(Math.random() * activitySeed.length)];
  appendDockLog(`mock bench update: ${message.toLowerCase()}`);
}, 9000);

renderObserve("UART");
renderCompare("UART");
setView("bringup");
