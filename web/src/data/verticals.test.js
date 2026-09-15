import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { VERTICALS } from './verticals.js'

/**
 * Mobil karttaki satıra kesilmeden sığan en uzun etiket. 390 piksellik
 * ekranda ölçüldü: 22 karakterlik etiketler üç noktayla kesiliyordu.
 */
const MAX_HIGHLIGHT_LENGTH = 21

// Icon.jsx JSX olduğu için node doğrudan içe aktaramıyor; ikon adları
// kaynaktaki PATHS anahtarlarından okunuyor. Yanlış yazılmış bir ad hata
// vermiyor, kartta ikon sessizce boş kalıyordu.
const ICON_SOURCE = readFileSync(new URL('../components/Icon.jsx', import.meta.url), 'utf8')
const ICON_NAMES = new Set(
  [...ICON_SOURCE.matchAll(/^ {2}([a-zA-Z]+): /gm)].map((match) => match[1])
)

test('her sektörün tanımlı bir ikonu var', () => {
  for (const vertical of VERTICALS) {
    assert.ok(ICON_NAMES.has(vertical.icon), `${vertical.name}: "${vertical.icon}" ikonu yok`)
  }
})

test('her sektörün önizlemesinde üç satır var', () => {
  for (const vertical of VERTICALS) {
    assert.equal(vertical.highlights?.length, 3, `${vertical.name}: satır sayısı`)
  }
})

test('önizleme satırları geçerli ikon ve kısa etiket taşıyor', () => {
  for (const vertical of VERTICALS) {
    const labels = new Set()
    for (const item of vertical.highlights) {
      assert.ok(ICON_NAMES.has(item.icon), `${vertical.name}: "${item.icon}" ikonu yok`)
      assert.ok(item.label.trim().length > 0, `${vertical.name}: boş etiket`)
      assert.ok(
        item.label.length <= MAX_HIGHLIGHT_LENGTH,
        `${vertical.name}: "${item.label}" ${MAX_HIGHLIGHT_LENGTH} karakterden uzun`
      )
      assert.ok(!labels.has(item.label), `${vertical.name}: "${item.label}" tekrar ediyor`)
      labels.add(item.label)
    }
  }
})
