import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planCoreDiagram, scalePath } from './coreDiagram.js'

/** Yolun son noktası — H/V komutlarında eksik koordinat bir öncekinden gelir. */
function endPoint(segments) {
  let x = 0
  let y = 0
  for (const [command, ...values] of segments) {
    if (command === 'H') x = values[0]
    else if (command === 'V') y = values[0]
    else {
      x = values[values.length - 2]
      y = values[values.length - 1]
    }
  }
  return { x, y }
}

test('sekiz sektör iki yana dörder dörder ayrılır', () => {
  const plan = planCoreDiagram(8)
  assert.deepEqual(
    plan.map((node) => node.side),
    ['left', 'left', 'left', 'left', 'right', 'right', 'right', 'right']
  )
  assert.deepEqual(
    plan.filter((node) => node.side === 'left').map((node) => node.wide.y),
    plan.filter((node) => node.side === 'right').map((node) => node.wide.y)
  )
})

test('satırlar üstten alta eşit aralıkla dizilir', () => {
  const ys = planCoreDiagram(8)
    .slice(0, 4)
    .map((node) => node.wide.y)
  assert.deepEqual(ys, [14, 38, 62, 86])
})

test('her çizgi çekirdekten başlar, kendi kutusunun ortasında biter', () => {
  for (const node of planCoreDiagram(8)) {
    assert.deepEqual(node.wide.segments[0], ['M', 50, 50])
    assert.deepEqual(endPoint(node.wide.segments), { x: node.wide.x, y: node.wide.y })

    assert.deepEqual(node.narrow.segments[0], ['M', 50, 15])
    assert.deepEqual(endPoint(node.narrow.segments), { x: node.narrow.x, y: node.narrow.y })
  }
})

test('ışık sırası iki yan arasında gidip gelir ve her sektöre bir kez uğrar', () => {
  const plan = planCoreDiagram(8)
  assert.deepEqual(
    plan.map((node) => node.slot),
    [0, 2, 4, 6, 1, 3, 5, 7]
  )
})

test('tek sayıda sektörde fazlası solda, sağ sütun ortalanır', () => {
  const plan = planCoreDiagram(3)
  assert.deepEqual(
    plan.map((node) => node.side),
    ['left', 'left', 'right']
  )
  assert.equal(plan[2].wide.y, 50)
  assert.deepEqual(
    [...plan.map((node) => node.slot)].sort(),
    [0, 1, 2]
  )
})

test('geçersiz sektör sayısı hata verir', () => {
  assert.throws(() => planCoreDiagram(0))
  assert.throws(() => planCoreDiagram(2.5))
  assert.throws(() => planCoreDiagram(undefined))
})

test('yol, x değerleri genişliğe, y değerleri yüksekliğe göre ölçeklenir', () => {
  const segments = [
    ['M', 50, 15],
    ['V', 41.5],
    ['Q', 50, 44, 47.5, 44],
    ['H', 25],
  ]
  assert.equal(scalePath(segments, 100, 100), 'M50 15 V41.5 Q50 44 47.5 44 H25')
  assert.equal(scalePath(segments, 400, 200), 'M200 30 V83 Q200 88 190 88 H100')
})

test('eğri komutunda koordinat çiftleri karışmaz', () => {
  assert.equal(scalePath([['C', 32, 50, 30, 14, 12, 14]], 1000, 440), 'C320 220 300 61.6 120 61.6')
})
