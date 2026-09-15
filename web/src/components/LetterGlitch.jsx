import { useEffect, useRef } from 'react'

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ!@#$&*()-_+=/[]{};:<>,0123456789'
const FONT_SIZE = 16
const CHAR_WIDTH = 10
const CHAR_HEIGHT = 20
/** Her tikte değişen harf oranı. */
const UPDATE_RATIO = 0.05
/** Renk geçişinin kare başına ilerlemesi. */
const FADE_STEP = 0.05

function randomItem(list) {
  return list[Math.floor(Math.random() * list.length)]
}

function hexToRgb(hex) {
  const full = hex.replace(/^#?([a-f\d])([a-f\d])([a-f\d])$/i, (_, r, g, b) => r + r + g + g + b + b)
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(full)
  return match
    ? { r: parseInt(match[1], 16), g: parseInt(match[2], 16), b: parseInt(match[3], 16) }
    : { r: 0, g: 0, b: 0 }
}

function mix(from, to, t) {
  const r = Math.round(from.r + (to.r - from.r) * t)
  const g = Math.round(from.g + (to.g - from.g) * t)
  const b = Math.round(from.b + (to.b - from.b) * t)
  return `rgb(${r}, ${g}, ${b})`
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Harf yağmuru — DarkMinimal şablonundaki LetterGlitch (MIT), JavaScript'e
 * çevrildi.
 *
 * Şablondan üç fark:
 * - Renk geçişi çalışıyor. Şablonda ara renk "rgb(...)" metni olarak
 *   saklanıyor, bir sonraki karede hex diye okunamayınca geçiş ilk adımda
 *   donuyordu. Burada başlangıç ve hedef renk ayrı tutuluyor.
 * - Görünür alandan çıkınca çizim duruyor.
 * - Hareket azaltma tercihi açıksa tek kare çiziliyor.
 *
 * Tamamen dekoratif: `aria-hidden`.
 *
 * @param {{
 *   colors: string[],
 *   speed?: number,
 *   centerVignette?: boolean,
 *   outerVignette?: boolean,
 *   className?: string,
 * }} props
 */
export default function LetterGlitch({
  colors,
  speed = 33,
  centerVignette = false,
  outerVignette = true,
  className = '',
}) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return undefined

    const palette = colors.map(hexToRgb)
    let letters = []
    let columns = 0
    let frameId = 0
    let lastTick = 0
    let isVisible = true

    const makeLetter = () => {
      const color = randomItem(palette)
      return { char: randomItem(CHARS), from: color, to: color, progress: 1 }
    }

    function resize() {
      const parent = canvas.parentElement
      if (!parent) return
      const rect = parent.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
      context.setTransform(dpr, 0, 0, dpr, 0, 0)

      columns = Math.ceil(rect.width / CHAR_WIDTH)
      const rows = Math.ceil(rect.height / CHAR_HEIGHT)
      letters = Array.from({ length: columns * rows }, makeLetter)
      draw()
    }

    function draw() {
      const { width, height } = canvas.getBoundingClientRect()
      context.clearRect(0, 0, width, height)
      context.font = `${FONT_SIZE}px monospace`
      context.textBaseline = 'top'
      letters.forEach((letter, index) => {
        context.fillStyle = mix(letter.from, letter.to, letter.progress)
        context.fillText(
          letter.char,
          (index % columns) * CHAR_WIDTH,
          Math.floor(index / columns) * CHAR_HEIGHT
        )
      })
    }

    function glitch() {
      const count = Math.max(1, Math.floor(letters.length * UPDATE_RATIO))
      for (let i = 0; i < count; i += 1) {
        const letter = letters[Math.floor(Math.random() * letters.length)]
        if (!letter) continue
        letter.from = letter.progress >= 1 ? letter.to : letter.from
        letter.char = randomItem(CHARS)
        letter.to = randomItem(palette)
        letter.progress = 0
      }
    }

    function fade() {
      letters.forEach((letter) => {
        if (letter.progress >= 1) return
        letter.progress = Math.min(1, letter.progress + FADE_STEP)
        if (letter.progress === 1) letter.from = letter.to
      })
    }

    function loop(time) {
      if (!isVisible) {
        frameId = 0
        return
      }
      if (time - lastTick >= speed) {
        glitch()
        lastTick = time
      }
      fade()
      draw()
      frameId = window.requestAnimationFrame(loop)
    }

    function start() {
      if (frameId || prefersReducedMotion()) return
      frameId = window.requestAnimationFrame(loop)
    }

    function stop() {
      if (!frameId) return
      window.cancelAnimationFrame(frameId)
      frameId = 0
    }

    resize()

    const observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(([entry]) => {
            isVisible = entry.isIntersecting
            if (isVisible) start()
            else stop()
          })
    if (observer) observer.observe(canvas)
    else start()

    // Kapsayıcının boyu yalnızca pencereyle değişmiyor: yanındaki açılır liste
    // açılıp kapandıkça kutu uzayıp kısalıyor. Pencere olayını dinlemek
    // kanvası eski boyunda bırakıyordu.
    let resizeTimer = 0
    const onResize = () => {
      window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(resize, 100)
    }
    const sizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onResize)
    if (sizeObserver && canvas.parentElement) sizeObserver.observe(canvas.parentElement)
    else window.addEventListener('resize', onResize)

    return () => {
      stop()
      observer?.disconnect()
      sizeObserver?.disconnect()
      window.clearTimeout(resizeTimer)
      window.removeEventListener('resize', onResize)
    }
  }, [colors, speed])

  return (
    <div aria-hidden="true" className={`relative h-full w-full overflow-hidden bg-background ${className}`.trim()}>
      {/* Mutlak konumda: kanvasa piksel boyu yazılıyor, akışta kalırsa
          kapsayıcıyı içeriden ayakta tutup kısalmasını engelliyordu. */}
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" />
      {outerVignette ? (
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle,_rgba(16,16,16,0)_60%,_rgba(16,16,16,1)_100%)]" />
      ) : null}
      {centerVignette ? (
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle,_rgba(0,0,0,0.8)_0%,_rgba(0,0,0,0)_60%)]" />
      ) : null}
    </div>
  )
}
