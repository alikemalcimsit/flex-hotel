import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withAlpha } from './color.js'

test('altı haneli renge saydamlık kanalı eklenir', () => {
  assert.equal(withAlpha('#EF4444', 0.2), '#EF444433')
  assert.equal(withAlpha('#22d3ee', 1), '#22D3EEFF')
  assert.equal(withAlpha('#22D3EE', 0), '#22D3EE00')
})

test('üç haneli renk açılarak yazılır', () => {
  assert.equal(withAlpha('#f80', 0.5), '#FF880080')
})

test('aralık dışı saydamlık sıkıştırılır', () => {
  assert.equal(withAlpha('#101010', 1.7), '#101010FF')
  assert.equal(withAlpha('#101010', -1), '#10101000')
})

test('geçersiz renk hata verir', () => {
  assert.throws(() => withAlpha('EF4444', 0.2))
  assert.throws(() => withAlpha('rgb(0, 0, 0)', 0.2))
  assert.throws(() => withAlpha(undefined, 0.2))
})
