import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { kbsExtrasBody, kbsExtrasForm, kbsRequiredExtras, kbsRoomText, kbsStateTone } from './kbsFormat.js';

const KBS = { isEnabled: true, citizenIdOnly: true, requireGender: true, requireBirthDate: true, requireParentNames: true, requireBirthPlace: false };

describe('KBS yazımı', () => {
  it('durum rozet tonu', () => {
    assert.equal(kbsStateTone('SENT'), 'success');
    assert.equal(kbsStateTone('FAILED'), 'danger');
    assert.equal(kbsStateTone('MANUAL'), 'violet');
    assert.equal(kbsStateTone('XYZ'), 'neutral');
  });

  it('oda metni değişiklikte ok işaretli', () => {
    assert.equal(kbsRoomText({ roomNumber: '103', previousRoomNumber: '101' }), '101 → 103');
    assert.equal(kbsRoomText({ roomNumber: '101', previousRoomNumber: null }), '101');
    assert.equal(kbsRoomText({ roomNumber: '101', previousRoomNumber: '101' }), '101');
    assert.equal(kbsRoomText({ roomNumber: null }), '—');
  });

  it('girişte zorunlu ek alanlar ayara ve TC kimliğe göre', () => {
    const foreigner = { idType: 'PASSPORT', nationality: 'DE' };
    const citizen = { idType: 'NATIONAL_ID', nationality: 'TR' };
    assert.deepEqual(kbsRequiredExtras(foreigner, KBS), ['gender', 'birthDate', 'fatherName', 'motherName']);
    assert.deepEqual(kbsRequiredExtras(citizen, KBS), []);
    assert.deepEqual(kbsRequiredExtras(citizen, { ...KBS, citizenIdOnly: false }), ['gender', 'birthDate', 'fatherName', 'motherName']);
    assert.deepEqual(kbsRequiredExtras(foreigner, { ...KBS, isEnabled: false }), []);
    assert.deepEqual(kbsRequiredExtras(foreigner, null), []);
  });

  it('ek alan formu ve gövdesi: boş null olur', () => {
    assert.deepEqual(kbsExtrasForm({ gender: 'MALE', fatherName: null }), { gender: 'MALE', fatherName: '', motherName: '', birthPlace: '' });
    assert.deepEqual(kbsExtrasBody({ gender: '', fatherName: ' Ali ', motherName: '', birthPlace: 'İzmir' }), { gender: null, fatherName: 'Ali', motherName: null, birthPlace: 'İzmir' });
  });
});
