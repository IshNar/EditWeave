import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bitDepth,
  hasVariablePacketDurations,
  isHdrStream,
  isProfessionalCameraStream,
  summarizeGate,
  validateMeasurementReceipt,
} from './commercial-readiness-lib.mjs';

test('classifies real HDR stream metadata without accepting 8-bit or wrong primaries', () => {
  const pq = { pix_fmt: 'yuv420p10le', color_primaries: 'bt2020', color_transfer: 'smpte2084' };
  assert.equal(bitDepth(pq), 10);
  assert.equal(isHdrStream(pq, 'smpte2084'), true);
  assert.equal(isHdrStream({ ...pq, pix_fmt: 'yuv420p', bits_per_raw_sample: '8' }, 'smpte2084'), false);
  assert.equal(isHdrStream({ ...pq, color_primaries: 'bt709' }, 'smpte2084'), false);
});

test('requires packet-level timing variation for VFR evidence', () => {
  const packets = Array.from({ length: 20 }, (_, index) => ({ stream_index: 0, duration_time: index % 2 ? '0.033367' : '0.050000' }));
  assert.equal(hasVariablePacketDurations({ packets }), true);
  assert.equal(hasVariablePacketDurations({ packets: packets.map(() => ({ stream_index: 0, duration_time: '0.033367' })) }), false);
});

test('accepts professional mezzanine or 10-bit 422 streams', () => {
  assert.equal(isProfessionalCameraStream({ codec_name: 'prores', pix_fmt: 'yuv422p10le' }), true);
  assert.equal(isProfessionalCameraStream({ codec_name: 'hevc', pix_fmt: 'yuv422p10le' }), true);
  assert.equal(isProfessionalCameraStream({ codec_name: 'h264', pix_fmt: 'yuv420p' }), false);
});

test('fails closed on incomplete physical measurement receipts and reports exact percentage', () => {
  const valid = {
    schema: 1,
    kind: 'hdr-reference-monitor',
    result: 'pass',
    measuredAt: '2026-08-15T10:00:00+09:00',
    operator: 'QA',
    equipment: 'reference monitor and probe',
    checks: [{ name: 'PQ peak luminance', result: 'pass' }],
  };
  assert.deepEqual(validateMeasurementReceipt(valid, 'hdr-reference-monitor'), []);
  assert.ok(validateMeasurementReceipt({ ...valid, checks: [] }, 'hdr-reference-monitor').length > 0);
  assert.deepEqual(summarizeGate([{ status: 'pass' }, { status: 'blocked' }]).completionPercent, 50);
});
