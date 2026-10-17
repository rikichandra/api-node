import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCustomer, nameSimilarity } from '../lib/customer-match.js';

const place = (name, extras = {}) => ({ name, address: 'Palembang, South Sumatra', lat: -3, lng: 104, ...extras });
test('equal business name and province remains an unverified customer candidate', () => {
  const r = classifyCustomer('PT. Bupala Alam Perkasa', [place('PT Bupala Alam Perkasa')]);
  assert.equal(r.status, 'Nama dan provinsi cocok');
  assert.match(r.reason, /belum terverifikasi/);
});
test('branches and conflicting legal entities are not silently accepted', () => {
  assert.equal(classifyCustomer('PT Cakra Indo Pratama', [place('PT Cakra Indo Pratama'), place('PT Cakra Indo Pratama')]).status, 'Beberapa lokasi; pilih cabang');
  assert.equal(classifyCustomer('PT Mekar Abadi', [place('CV Mekar Abadi')]).status, 'Perlu verifikasi nama');
  const r = classifyCustomer('PT Cipta Maju Mandiri', [place('CV Cipta Maju Mandiri'), place('PT Cipta Maju Mandiri')]);
  assert.equal(r.best.name, 'PT Cipta Maju Mandiri');
  assert.equal(r.status, 'Nama dan provinsi cocok');
});
test('outside-region and unrelated results remain distinct from matches', () => {
  assert.equal(classifyCustomer('PT Contoh Usaha', [place('PT Contoh Usaha', { address: 'Jakarta' })]).status, 'Provinsi belum sesuai');
  assert.equal(classifyCustomer('PT Contoh Usaha', [place('PT XYZ')]).best, null);
  assert.equal(nameSimilarity('', 'PT XYZ'), 0);
});
