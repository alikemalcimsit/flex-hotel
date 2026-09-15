import { test } from 'node:test'
import assert from 'node:assert/strict'
import { iconForLink } from './brand.js'

test('tanınan platform etiketi kendi ikonunu alır', () => {
  assert.equal(iconForLink({ label: 'GitHub' }), 'github')
  assert.equal(iconForLink({ label: ' LinkedIn ' }), 'linkedin')
  assert.equal(iconForLink({ label: 'Instagram' }), 'instagram')
})

test('tanınmayan platform genel bağlantı ikonuna düşer', () => {
  assert.equal(iconForLink({ label: 'Kaggle' }), 'link')
  assert.equal(iconForLink({}), 'link')
  assert.equal(iconForLink(undefined), 'link')
})

test('açıkça verilen ikon etiketin önüne geçer', () => {
  assert.equal(iconForLink({ label: 'GitHub', icon: 'code' }), 'code')
})
