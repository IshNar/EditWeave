const VIDEO_CODEC_TAGS = new Set(['prores', 'dnxhd', 'dnxhr']);

export function firstVideoStream(probe) {
  return probe?.streams?.find((stream) => stream.codec_type === 'video') ?? null;
}

export function bitDepth(stream) {
  const explicit = Number(stream?.bits_per_raw_sample || stream?.bits_per_sample || 0);
  if (explicit > 0) return explicit;
  const match = String(stream?.pix_fmt ?? '').match(/(?:p|yuv\d*p)(\d{2})(?:le|be)?$/i);
  return match ? Number(match[1]) : /p10|10le|10be/i.test(String(stream?.pix_fmt ?? '')) ? 10 : 8;
}

export function isHdrStream(stream, transfer) {
  return Boolean(
    stream &&
      bitDepth(stream) >= 10 &&
      stream.color_primaries === 'bt2020' &&
      stream.color_transfer === transfer,
  );
}

export function hasVariablePacketDurations(probe) {
  const durations = (probe?.packets ?? [])
    .filter((packet) => packet.stream_index === 0 || packet.codec_type === 'video')
    .map((packet) => Number(packet.duration_time))
    .filter((duration) => Number.isFinite(duration) && duration > 0);
  if (durations.length < 12) return false;
  const rounded = new Set(durations.map((duration) => duration.toFixed(6)));
  if (rounded.size < 2) return false;
  const min = Math.min(...durations);
  const max = Math.max(...durations);
  return max - min > Math.max(0.00001, min * 0.01);
}

export function isProfessionalCameraStream(stream) {
  const codec = String(stream?.codec_name ?? '').toLowerCase();
  const profile = String(stream?.profile ?? '').toLowerCase();
  return Boolean(
    VIDEO_CODEC_TAGS.has(codec) ||
      (['hevc', 'h265', 'av1'].includes(codec) && bitDepth(stream) >= 10 && /422|4:2:2/.test(`${stream.pix_fmt} ${profile}`)),
  );
}

export function validateMeasurementReceipt(receipt, kind) {
  const failures = [];
  if (receipt?.schema !== 1) failures.push('schema must be 1');
  if (receipt?.kind !== kind) failures.push(`kind must be ${kind}`);
  if (receipt?.result !== 'pass') failures.push('result must be pass');
  if (!/^\d{4}-\d{2}-\d{2}T/.test(String(receipt?.measuredAt ?? ''))) failures.push('measuredAt must be ISO-8601');
  if (!String(receipt?.operator ?? '').trim()) failures.push('operator is required');
  if (!String(receipt?.equipment ?? '').trim()) failures.push('equipment is required');
  if (!Array.isArray(receipt?.checks) || receipt.checks.length === 0) failures.push('checks must be a non-empty array');
  if (receipt?.checks?.some((check) => check?.result !== 'pass' || !String(check?.name ?? '').trim())) {
    failures.push('every check must have a name and pass result');
  }
  return failures;
}

export function summarizeGate(results) {
  const passed = results.filter((result) => result.status === 'pass').length;
  return {
    status: passed === results.length ? 'pass' : 'blocked',
    passed,
    total: results.length,
    completionPercent: Math.round((passed / Math.max(1, results.length)) * 100),
    results,
  };
}
