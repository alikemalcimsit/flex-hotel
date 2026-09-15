import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildContactMailto } from './contactMail.js'

const TO = 'iletisim@flexai.tr'

function parse(href) {
  const url = new URL(href)
  return {
    to: url.pathname,
    subject: url.searchParams.get('subject'),
    body: url.searchParams.get('body'),
  }
}

test('işletme adı konuya, ad ve işletme imzaya yazılır', () => {
  const mail = parse(
    buildContactMailto({ name: 'Ayşe', company: 'Deniz Otel', message: 'Ön büro yükü' }, TO)
  )
  assert.equal(mail.to, TO)
  assert.equal(mail.subject, 'FlexAI proje görüşmesi — Deniz Otel')
  assert.equal(mail.body, 'Ön büro yükü\n\nAyşe · Deniz Otel')
})

test('işletme yoksa konu genel kalır, imza yalnızca ad olur', () => {
  const mail = parse(buildContactMailto({ name: 'Ayşe', message: 'Merhaba' }, TO))
  assert.equal(mail.subject, 'FlexAI proje görüşmesi')
  assert.equal(mail.body, 'Merhaba\n\nAyşe')
})

test('boş alanlar imza satırı üretmez, baştaki ve sondaki boşluk kırpılır', () => {
  const mail = parse(buildContactMailto({ name: '  ', company: '', message: '  Merhaba  ' }, TO))
  assert.equal(mail.body, 'Merhaba')
})

test('özel karakterler adresi bozmaz', () => {
  const href = buildContactMailto({ message: 'Fiyat & kapsam? %100 #otel' }, TO)
  assert.equal(parse(href).body, 'Fiyat & kapsam? %100 #otel')
})
