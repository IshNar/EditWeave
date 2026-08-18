import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ffprobePath from 'ffprobe-static';
import {
  firstVideoStream,
  hasVariablePacketDurations,
  isHdrStream,
  isProfessionalCameraStream,
  summarizeGate,
  validateMeasurementReceipt,
} from './commercial-readiness-lib.mjs';

const argv = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
};
const manifestPath = resolve(valueAfter('--manifest') ?? process.env.EDITWEAVE_COMMERCIAL_EVIDENCE ?? 'release/commercial-evidence.json');
const reportPath = resolve(valueAfter('--report') ?? 'release/commercial-readiness-report.json');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

function probe(path, packets = false) {
  const args = ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format'];
  if (packets) args.push('-select_streams', 'v:0', '-read_intervals', '%+#240', '-show_packets', '-show_entries', 'stream:format:packet=stream_index,duration_time');
  args.push(path);
  return JSON.parse(execFileSync(ffprobePath.path, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
}

function fileGate(id, path, validate, description) {
  if (!path) return { id, status: 'blocked', detail: `${description}: evidence path missing` };
  const absolute = resolve(path);
  if (!existsSync(absolute)) return { id, status: 'blocked', detail: `${description}: file not found (${absolute})` };
  try {
    const detail = validate(absolute);
    return detail === true ? { id, status: 'pass', detail: absolute } : { id, status: 'blocked', detail: String(detail) };
  } catch (error) {
    return { id, status: 'blocked', detail: `${description}: ${error.message}` };
  }
}

function receiptGate(id, path, kind) {
  return fileGate(id, path, (absolute) => {
    const failures = validateMeasurementReceipt(readJson(absolute), kind);
    return failures.length === 0 || failures.join('; ');
  }, kind);
}

function windowsSignatureGate(path, expectedSubject) {
  if (process.platform !== 'win32') return 'Windows Authenticode must be checked on Windows';
  if (!expectedSubject) return 'expected Windows signer subject missing';
  const script = [
    '$s=Get-AuthenticodeSignature -LiteralPath $args[0]',
    'if($s.Status -ne "Valid"){throw "Authenticode status: $($s.Status)"}',
    'if($s.SignerCertificate.Subject -ne $args[1]){throw "Signer mismatch: $($s.SignerCertificate.Subject)"}',
  ].join(';');
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script, path, expectedSubject], { encoding: 'utf8' });
  return true;
}

const results = [];
let manifest = {};
if (!existsSync(manifestPath)) {
  results.push({ id: 'evidence-manifest', status: 'blocked', detail: `manifest not found (${manifestPath})` });
} else {
  try {
    manifest = readJson(manifestPath);
    results.push(manifest.schema === 1
      ? { id: 'evidence-manifest', status: 'pass', detail: manifestPath }
      : { id: 'evidence-manifest', status: 'blocked', detail: 'manifest schema must be 1' });
  } catch (error) {
    results.push({ id: 'evidence-manifest', status: 'blocked', detail: `invalid JSON: ${error.message}` });
  }
}

results.push(fileGate('camera-pq', manifest.media?.pq, (path) => isHdrStream(firstVideoStream(probe(path)), 'smpte2084') || 'requires real 10-bit BT.2020 PQ video', 'camera PQ'));
results.push(fileGate('camera-hlg', manifest.media?.hlg, (path) => isHdrStream(firstVideoStream(probe(path)), 'arib-std-b67') || 'requires real 10-bit BT.2020 HLG video', 'camera HLG'));
results.push(fileGate('device-vfr', manifest.media?.vfr, (path) => hasVariablePacketDurations(probe(path, true)) || 'requires at least 12 video packets with genuinely variable durations', 'device VFR'));
results.push(fileGate('professional-codec', manifest.media?.professional, (path) => isProfessionalCameraStream(firstVideoStream(probe(path))) || 'requires ProRes, DNxHR/DNxHD, or 10-bit 4:2:2 professional video', 'professional camera codec'));
results.push(fileGate('windows-signed-installer', manifest.windows?.installer, (path) => windowsSignatureGate(path, manifest.windows?.expectedSignerSubject), 'signed Windows installer'));
results.push(receiptGate('macos-signed-notarized-install', manifest.receipts?.macos, 'macos-signed-notarized-install'));
results.push(receiptGate('hdr-reference-monitor', manifest.receipts?.hdrMonitor, 'hdr-reference-monitor'));
results.push(receiptGate('user-task-validation', manifest.receipts?.userValidation, 'user-task-validation'));
results.push(receiptGate('production-operations', manifest.receipts?.operations, 'production-operations'));

const summary = summarizeGate(results);
const report = {
  schema: 1,
  generatedAt: new Date().toISOString(),
  manifestPath,
  manifestSha256: existsSync(manifestPath) ? createHash('sha256').update(readFileSync(manifestPath)).digest('hex') : null,
  ...summary,
};
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
if (summary.status !== 'pass') process.exitCode = 1;
