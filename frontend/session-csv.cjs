// frontend/session-csv.cjs
// CSV building for session exports. Used by main.js (log:export-csv) and
// unit tested from tests/electron.
'use strict';

const CSV_HEADER = 'timestamp_ms,proto,status,rtt_ms,late,data,raw\n';

function csvEscape(val) {
  const str = val == null ? '' : String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Build the full CSV document for a session.
 * The `late` column is 1 when the row is the delayed reply to a command that
 * already produced a HOST_TIMEOUT row, empty otherwise — so the pair of rows
 * for one command can be correlated in post-processing.
 *
 * @param {Array<{ts:number, proto:string, status:string, rtt:number|null, late?:boolean, data:string, raw:string}>} rows
 */
function buildSessionCsv(rows) {
  const body = rows.map(r => [
    r.ts,
    csvEscape(r.proto),
    csvEscape(r.status),
    r.rtt != null ? r.rtt : '',
    r.late ? 1 : '',
    csvEscape(r.data),
    csvEscape(r.raw),
  ].join(',')).join('\n');

  return CSV_HEADER + body;
}

module.exports = { csvEscape, buildSessionCsv, CSV_HEADER };
