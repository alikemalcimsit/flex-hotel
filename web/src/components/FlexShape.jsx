import { useEffect, useRef } from 'react'
import { BRAND, SECTORS } from '../data/sectors.js'
import { CHANNELS_PER_TEXTURE, streamWordmarkFields } from '../lib/flexWordmark.js'

/** Bir sektörün ekranda durma ve bir sonrakine akma süresi. */
const HOLD_MS = 1500
const MORPH_MS = 850
const STAGE_MS = HOLD_MS + MORPH_MS

/**
 * Ölçüler büyük harf yüksekliğine göredir (1 birim = büyük harf yüksekliği).
 * Kilit geniş ve alçak olduğu için kalınlık ve pah, tek harfli sahnedekine
 * göre oransal olarak daha küçük tutuldu; kalın bir pah bu boyutta harfleri
 * yuvarlatıp okunurluğu düşürüyor.
 */
const HALF_DEPTH = 0.075
const EDGE_ROUND = 0.01

const COLOR_SPEC = '#FFF3F3'
const QUARTER_TURN = Math.PI / 2

/** Yarım kayan noktaya çevrimde bir görevde işlenecek değer sayısı. */
const CONVERT_SLICE = 500000
const FOV = 34

/*
 * Dönüş genlikleri bilinçli olarak küçük. Kilit çok geniş olduğu için küçük
 * bir Y dönüşü bile uçlarını kameraya doğru epey yaklaştırıyor; perspektif
 * onları büyütüp çerçeveden taşırıyor. Ayrıca uzun bir yazının salınması
 * okunurluğu bozuyor.
 */
const ROTATION_SPEED = 0.00017
const ROTATION_AMPLITUDE = 0.045
const BASE_TILT_X = -0.02
const TUMBLE_SPEED = 0.00023
const TUMBLE_AMPLITUDE = 0.03
const POINTER_INFLUENCE = 0.05
const POINTER_EASING = 0.05

const VERTEX_SHADER = `
  varying vec3 vObjectPos;

  void main() {
    vObjectPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const FRAGMENT_SHADER = `
  precision highp float;

  uniform sampler2D uBrandField;
  uniform sampler2D uSectorFieldA;
  uniform sampler2D uSectorFieldB;
  uniform vec4 uSelA;
  uniform vec4 uSelB;
  uniform float uFlip;
  uniform float uPivotY;
  uniform float uFieldMargin;
  uniform vec3 uCameraObject;
  uniform vec2 uHalfExtent;
  uniform float uHalfDepth;
  uniform float uBoxDepth;
  uniform float uRound;
  uniform float uPixel;
  uniform vec3 uBrandColor;
  uniform vec3 uSectorColor;
  uniform vec3 uSpecColor;
  uniform vec3 uKeyDir;
  uniform vec3 uFillDir;

  varying vec3 vObjectPos;

  vec2 fieldUv(vec2 xy) {
    return vec2(0.5 + xy.x / (2.0 * uHalfExtent.x), 0.5 - xy.y / (2.0 * uHalfExtent.y));
  }

  // Alanin disina dusen ornekleme noktalari icin guvenli alt sinir: kutuya
  // uzaklik arti murekkebin kenardan garanti uzakligi. Kenar degerini
  // kelepcelemek mesafeyi oldugundan KUCUK gosterip isinin yuzeyi asmasina
  // yol acardi.
  float awayFromField(vec2 xy) {
    return length(max(abs(xy) - uHalfExtent, vec2(0.0)));
  }

  float brandField(vec2 xy) {
    float away = awayFromField(xy);
    if (away > 0.0) return away + uFieldMargin;
    return texture2D(uBrandField, fieldUv(xy)).r;
  }

  float sectorField(vec2 xy) {
    float away = awayFromField(xy);
    if (away > 0.0) return away + uFieldMargin;
    vec2 uv = fieldUv(xy);
    return dot(texture2D(uSectorFieldA, uv), uSelA) + dot(texture2D(uSectorFieldB, uv), uSelB);
  }

  // 2B alani z ekseninde kalinlastirir; pah payi once asindirilip sonunda
  // geri eklenir, boylece govde ozgun boyutunda kalir.
  float extrude(float plane2d, float z) {
    float plane = plane2d + uRound;
    float slab = abs(z) - (uHalfDepth - uRound);
    return min(max(plane, slab), 0.0) + length(max(vec2(plane, slab), 0.0)) - uRound;
  }

  // x: sabit "Flex", y: sektor. Ayri tutuluyorlar cunku renkleri farkli.
  //
  // Sektor kendi yatay ekseninde doner ve donusun ortasinda, tam profilden
  // gorunmezken bir sonraki sektore gecilir. Iki KELIMENIN mesafe alanlarini
  // birbirine karistirmak denendi ve calismiyor: harfleri ayni yerlere
  // dusmedigi icin ara karelerde yalnizca ortustukleri parcalar kaliyor,
  // kelime dagiliyor. Kati cisim donusu ise mesafeyi hic bozmaz.
  vec2 solidParts(vec3 p) {
    float brand = extrude(brandField(p.xy), p.z);

    float dy = p.y - uPivotY;
    float c = cos(uFlip);
    float s = sin(uFlip);
    float localY = c * dy + s * p.z;
    float localZ = c * p.z - s * dy;
    float sector = extrude(sectorField(vec2(p.x, localY + uPivotY)), localZ);

    return vec2(brand, sector);
  }

  float mapSolid(vec3 p) {
    vec2 both = solidParts(p);
    return min(both.x, both.y);
  }

  vec3 surfaceNormal(vec3 p) {
    vec2 eps = vec2(NORMAL_EPS, 0.0);
    return normalize(vec3(
      mapSolid(p + eps.xyy) - mapSolid(p - eps.xyy),
      mapSolid(p + eps.yxy) - mapSolid(p - eps.yxy),
      mapSolid(p + eps.yyx) - mapSolid(p - eps.yyx)
    ));
  }

  // Eksene tam paralel isinlarda 1/0 = sonsuz cikip dilim testini NaN'a
  // dusurur; buyukluk tabanlanir, isaret korunur.
  vec3 safeInverse(vec3 dir) {
    vec3 magnitude = max(abs(dir), vec3(1e-6));
    vec3 signs = vec3(
      dir.x < 0.0 ? -1.0 : 1.0,
      dir.y < 0.0 ? -1.0 : 1.0,
      dir.z < 0.0 ? -1.0 : 1.0
    );
    return signs / magnitude;
  }

  void main() {
    vec3 origin = uCameraObject;
    vec3 dir = normalize(vObjectPos - origin);

    // Kutu, sektorun donerken suepurdugu hacmi de kapsayacak kadar derin
    vec3 bounds = vec3(uHalfExtent, uBoxDepth);
    vec3 invDir = safeInverse(dir);
    vec3 cornerA = (-bounds - origin) * invDir;
    vec3 cornerB = (bounds - origin) * invDir;
    vec3 slabNear = min(cornerA, cornerB);
    vec3 slabFar = max(cornerA, cornerB);
    float enterAt = max(max(slabNear.x, slabNear.y), slabNear.z);
    float exitAt = min(min(slabFar.x, slabFar.y), slabFar.z);
    if (exitAt <= max(enterAt, 0.0)) discard;

    float travel = max(enterAt, 0.0);
    float nearest = 1e9;
    vec3 nearestPoint = origin + dir * travel;
    float hit = 0.0;
    for (int index = 0; index < MAX_STEPS; index += 1) {
      vec3 point = origin + dir * travel;
      float reach = mapSolid(point);
      if (reach < nearest) {
        nearest = reach;
        nearestPoint = point;
      }
      if (reach < SURFACE_EPS) {
        hit = 1.0;
        break;
      }
      travel += reach;
      if (travel > exitAt) break;
    }

    // Siluette kenar yumusatma: isin yuzeye degmediyse en yakin gectigi
    // mesafe piksel boyuna vurulup kismi kapama olarak kullanilir.
    float coverage = hit > 0.5 ? 1.0 : 1.0 - smoothstep(0.0, uPixel * 1.5, nearest);
    if (coverage < 0.004) discard;

    vec3 point = hit > 0.5 ? origin + dir * travel : nearestPoint;
    vec3 normal = surfaceNormal(point);
    vec3 view = -dir;

    // Renk, o noktada hangi kelimenin daha yakin oldugundan gelir; sinir iki
    // kelimenin arasindaki bosluga dustugu icin yuzeyde kesik olusmaz.
    vec2 both = solidParts(point);
    vec3 tone = both.x < both.y ? uBrandColor : uSectorColor;

    float key = max(dot(normal, uKeyDir), 0.0);
    float fill = max(dot(normal, uFillDir), 0.0);
    float spec = pow(max(dot(normal, normalize(uKeyDir + view)), 0.0), 64.0);
    float fresnel = pow(1.0 - max(dot(normal, view), 0.0), 4.0);

    // Renk KARISTIRILMAZ, yalnizca olceklenir: her yuzey sektorun kendi
    // tonunda kalir, yan duvarlar ayni tonun koyusu olur.
    float shade = 0.46 + 0.60 * key + 0.14 * fill + 0.10 * fresnel;
    vec3 color = tone * min(shade, 1.0) + uSpecColor * spec * 0.22;

    gl_FragColor = vec4(color, coverage);
  }
`

function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * Ana iş parçacığını tarayıcıya bırakır.
 *
 * `setTimeout(0)` bilinçli: makro görev kuyruğuna düştüğü için arada bekleyen
 * tıklama, kaydırma ve düzen işleri sıraya girebilir. `requestAnimationFrame`
 * bunu garanti etmez, `requestIdleCallback` ise meşgul bir sayfada uzun süre
 * ertelenebilir.
 */
function yieldToBrowser() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

/** Sitede yüklü webfont'lar gelmeden örnekleme yapılırsa yedek font kalıba girer. */
async function waitForFonts() {
  if (!document.fonts?.load) return
  try {
    await Promise.all(
      [BRAND, ...SECTORS].map((spec) =>
        document.fonts.load(`${spec.weight} 100px ${spec.family}`, spec.label)
      )
    )
    await document.fonts.ready
  } catch {
    // Font gelmezse yedek fontla devam — animasyon yine çalışır
  }
}

/**
 * Marka animasyonu — sabit "Flex" ve yanında değişen sektör adı, tek parça
 * katı 3B gövde olarak.
 *
 * "Flex" sitedeki logodan birebir alınır (Space Grotesk 700, accent kırmızısı,
 * -6 derece eğim). Sektör adları kendi fontlarını ve renklerini taşır ve
 * birbirine akarak dönüşür: FlexHotel -> FlexClinic -> FlexDental -> ...
 *
 * Yüzey ekranda ışın yürütmesiyle çözülür; üçgen ağı yoktur. Sektörler arası
 * geçiş mesafe alanı karışımıdır, dolayısıyla harf sayısı ve tipografi tamamen
 * değişse bile her ara karede geçerli ve kapalı bir gövde kalır.
 *
 * three.js yalnızca bileşen ekrana girdiğinde dinamik yüklenir; ana pakete
 * girmez. Dekoratiftir (`aria-hidden`): görünür alandan çıkınca çizim durur,
 * `prefers-reduced-motion` açıkken tek kare çizilir ve hiç hareket etmez.
 */
export default function FlexShape({ className = '' }) {
  const mountRef = useRef(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return undefined

    let disposed = false
    let cleanup = () => {}

    async function init() {
      await waitForFonts()

      // Adı adına içe aktarım ŞART: `import * as THREE` bir ad alanı nesnesi
      // üretir ve paketleyici hiçbir şeyi eleyemez.
      const {
        BackSide,
        BoxGeometry,
        ClampToEdgeWrapping,
        DataTexture,
        DataUtils,
        HalfFloatType,
        LinearFilter,
        Mesh,
        PerspectiveCamera,
        RGBAFormat,
        RedFormat,
        SRGBColorSpace,
        Scene,
        ShaderMaterial,
        Vector2,
        Vector3,
        Vector4,
        WebGLRenderer,
      } = await import('three')
      if (disposed || !mountRef.current) return

      // Kelimeler tek tek üretilir ve her kelimeden sonra tarayıcıya dönülür;
      // dokuz alanı tek görevde üretmek sayfayı yarım saniye kilitlerdi.
      let frame = null
      for (const partial of streamWordmarkFields(BRAND, SECTORS)) {
        frame = partial
        await yieldToBrowser()
        if (disposed || !mountRef.current) return
      }
      if (!frame) return

      const reduceMotion = prefersReducedMotion()

      const renderer = new WebGLRenderer({ antialias: false, alpha: true })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
      renderer.outputColorSpace = SRGBColorSpace
      mount.appendChild(renderer.domElement)
      renderer.domElement.style.width = '100%'
      renderer.domElement.style.height = '100%'
      renderer.domElement.style.display = 'block'

      const scene = new Scene()
      const camera = new PerspectiveCamera(FOV, 1, 0.1, 100)

      // Yarim kayan noktali doku: sifira yakin degerlerde cok hassas, dogrusal
      // suzulmesi WebGL2'de cekirdek — kenarlar bu yuzden keskin cikiyor.
      //
      // Cevrim dilimlenerek yapiliyor: dort kanalli bir alan iki milyondan
      // fazla deger tutuyor ve tek seferde cevirmek ana is parcacigini yuz
      // milisaniyeden uzun kilitliyordu.
      async function createField(values, format) {
        const half = new Uint16Array(values.length)
        for (let start = 0; start < half.length; start += CONVERT_SLICE) {
          const end = Math.min(start + CONVERT_SLICE, half.length)
          for (let index = start; index < end; index += 1) {
            half[index] = DataUtils.toHalfFloat(values[index])
          }
          if (end < half.length) await yieldToBrowser()
          if (disposed || !mountRef.current) return null
        }
        const texture = new DataTexture(half, frame.width, frame.height, format, HalfFloatType)
        texture.minFilter = LinearFilter
        texture.magFilter = LinearFilter
        texture.wrapS = ClampToEdgeWrapping
        texture.wrapT = ClampToEdgeWrapping
        texture.generateMipmaps = false
        texture.needsUpdate = true
        return texture
      }

      const brandTexture = await createField(frame.brand, RedFormat)
      if (!brandTexture) return
      const sectorTextures = []
      for (const values of frame.sectors) {
        const texture = await createField(values, RGBAFormat)
        if (!texture) return
        sectorTextures.push(texture)
      }
      // Kabuk iki sektor dokusu bekliyor; tek doku yetiyorsa ikincisi ilkin
      // kopyasi olur ve secici vektoru sifir kaldigi icin katki vermez
      while (sectorTextures.length < 2) sectorTextures.push(sectorTextures[0])

      const toColor = (hex) => {
        const value = Number.parseInt(hex.slice(1), 16)
        return new Vector3(
          ((value >> 16) & 255) / 255,
          ((value >> 8) & 255) / 255,
          (value & 255) / 255
        )
      }
      const sectorColors = SECTORS.map((sector) => toColor(sector.color))

      // Vekil kutu, sektorun donerken supurdugu hacmi de icermek zorunda:
      // yatay eksende donen kelime z ekseninde kendi yariyuksekligi kadar
      // one ve arkaya tasiyor.
      const boxDepth = HALF_DEPTH + frame.sectorSweep + 0.02

      const uniforms = {
        uBrandField: { value: brandTexture },
        uSectorFieldA: { value: sectorTextures[0] },
        uSectorFieldB: { value: sectorTextures[1] },
        uSelA: { value: new Vector4() },
        uSelB: { value: new Vector4() },
        uFlip: { value: 0 },
        uPivotY: { value: frame.sectorPivotY },
        uFieldMargin: { value: frame.fieldMargin },
        uCameraObject: { value: new Vector3() },
        uHalfExtent: { value: new Vector2(frame.halfExtentX, frame.halfExtentY) },
        uHalfDepth: { value: HALF_DEPTH },
        uBoxDepth: { value: boxDepth },
        uRound: { value: EDGE_ROUND },
        uPixel: { value: 0.004 },
        uBrandColor: { value: toColor(BRAND.color) },
        uSectorColor: { value: sectorColors[0].clone() },
        uSpecColor: { value: toColor(COLOR_SPEC) },
        uKeyDir: { value: new Vector3(-0.32, 0.46, 0.83).normalize() },
        uFillDir: { value: new Vector3(0.78, -0.22, 0.58).normalize() },
      }

      const material = new ShaderMaterial({
        uniforms,
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        defines: { MAX_STEPS: 72, SURFACE_EPS: '0.0006', NORMAL_EPS: '0.008' },
        transparent: true,
        depthWrite: false,
        side: BackSide,
      })

      // Vekil kutu yalnizca isinlari baslatir: arka plan pikselleri hic
      // yurutulmeden elenir, maliyet kilidin kapladigi alanla sinirli kalir.
      const geometry = new BoxGeometry(2 * frame.halfExtentX, 2 * frame.halfExtentY, 2 * boxDepth)
      const mesh = new Mesh(geometry, material)
      scene.add(mesh)

      const cameraLocal = new Vector3()
      let elapsed = 0
      let lastTime = 0
      let frameId = 0
      let isVisible = true
      const pointer = { targetX: 0, targetY: 0, x: 0, y: 0 }

      /** Sektör indeksini iki dokuya yayılmış tek sıcak kanala çevirir. */
      function selectSector(index, first, second) {
        const texture = Math.floor(index / CHANNELS_PER_TEXTURE)
        const channel = index % CHANNELS_PER_TEXTURE
        first.set(
          texture === 0 && channel === 0 ? 1 : 0,
          texture === 0 && channel === 1 ? 1 : 0,
          texture === 0 && channel === 2 ? 1 : 0,
          texture === 0 && channel === 3 ? 1 : 0
        )
        second.set(
          texture === 1 && channel === 0 ? 1 : 0,
          texture === 1 && channel === 1 ? 1 : 0,
          texture === 1 && channel === 2 ? 1 : 0,
          texture === 1 && channel === 3 ? 1 : 0
        )
      }

      /**
       * Zaman → hangi sektör, hangi çevirme açısı.
       *
       * İlk yarıda mevcut sektör profile dönene kadar döner, ikinci yarıda
       * sıradaki sektör profilden açılır. Takas tam profilde, kelime
       * görünmezken yapılır; bu yüzden geçişte hiç bozuk ara şekil oluşmaz.
       */
      function applyStage() {
        const index = Math.floor(elapsed / STAGE_MS) % SECTORS.length
        const within = (elapsed % STAGE_MS) - HOLD_MS
        const raw = within <= 0 ? 0 : Math.min(1, within / MORPH_MS)
        const eased = easeInOut(raw)
        // Son sektörden ilkine dönerek döngü kapanır
        const next = (index + 1) % SECTORS.length
        const showing = eased < 0.5 ? index : next

        uniforms.uFlip.value =
          eased < 0.5 ? eased * 2 * QUARTER_TURN : (eased - 0.5) * 2 * QUARTER_TURN - QUARTER_TURN
        selectSector(showing, uniforms.uSelA.value, uniforms.uSelB.value)
        uniforms.uSectorColor.value.copy(sectorColors[showing])
      }

      function resize() {
        const rect = mount.getBoundingClientRect()
        const width = Math.max(1, rect.width)
        const height = Math.max(1, rect.height)
        renderer.setSize(width, height, false)
        camera.aspect = width / height
        // Kilit hem dar hem geniş kutuda tam sığsın: iki eksenden gerekli olan
        // uzaklıkların büyüğü seçilir
        const spread = 2 * Math.tan((FOV * Math.PI) / 360)
        const byHeight = (2 * frame.halfExtentY) / spread
        const byWidth = (2 * frame.halfExtentX) / (spread * camera.aspect)
        // Kamera, kilidin kameraya EN ÇOK yaklaştığı düzleme göre kurulur:
        // salınım uçları öne getiriyor, perspektif de onları büyütüyor. Bu
        // pay olmadan uçlar çerçeveden taşıyor.
        const swing =
          frame.halfExtentX * Math.sin(ROTATION_AMPLITUDE + POINTER_INFLUENCE / 2) +
          frame.halfExtentY * Math.sin(Math.abs(BASE_TILT_X) + TUMBLE_AMPLITUDE) +
          HALF_DEPTH
        camera.position.set(0, 0, Math.max(byHeight, byWidth) + swing)
        camera.updateProjectionMatrix()
        // Aygıt pikseli başına dünya birimi: kenar yumuşatma bandı CSS
        // pikseline göre hesaplanırsa yüksek yoğunluklu ekranlarda iki katı
        // geniş çıkıp silueti yumuşatıyor
        uniforms.uPixel.value = (spread * camera.position.z) / (height * renderer.getPixelRatio())
      }

      function render() {
        applyStage()
        mesh.updateMatrixWorld(true)
        cameraLocal.copy(camera.position)
        mesh.worldToLocal(cameraLocal)
        uniforms.uCameraObject.value.copy(cameraLocal)
        renderer.render(scene, camera)
      }

      function loop(time) {
        if (!isVisible) {
          frameId = 0
          return
        }
        const delta = lastTime ? Math.min(time - lastTime, 64) : 16
        lastTime = time
        elapsed += delta

        pointer.x += (pointer.targetX - pointer.x) * POINTER_EASING
        pointer.y += (pointer.targetY - pointer.y) * POINTER_EASING

        // Kilit okunur kalmalı: dönüş yavaş ve dar açılı
        mesh.rotation.y = Math.sin(elapsed * ROTATION_SPEED) * ROTATION_AMPLITUDE + pointer.x
        mesh.rotation.x =
          BASE_TILT_X + Math.sin(elapsed * TUMBLE_SPEED) * TUMBLE_AMPLITUDE + pointer.y

        render()
        frameId = window.requestAnimationFrame(loop)
      }

      function start() {
        if (reduceMotion || frameId) return
        lastTime = 0
        frameId = window.requestAnimationFrame(loop)
      }

      function stop() {
        if (!frameId) return
        window.cancelAnimationFrame(frameId)
        frameId = 0
      }

      function onPointerMove(event) {
        const rect = mount.getBoundingClientRect()
        pointer.targetX = ((event.clientX - rect.left) / rect.width - 0.5) * POINTER_INFLUENCE
        pointer.targetY = ((event.clientY - rect.top) / rect.height - 0.5) * POINTER_INFLUENCE * 0.6
      }

      function onResize() {
        resize()
        render()
      }

      mesh.rotation.set(BASE_TILT_X, 0, 0)
      resize()
      render()

      const observer =
        typeof IntersectionObserver === 'undefined'
          ? null
          : new IntersectionObserver(
              ([entry]) => {
                isVisible = entry.isIntersecting
                if (isVisible) start()
                else stop()
              },
              { threshold: 0 }
            )

      if (observer) observer.observe(mount)
      else start()

      window.addEventListener('resize', onResize)
      const isCoarsePointer = window.matchMedia('(pointer: coarse)').matches
      if (!isCoarsePointer && !reduceMotion) {
        window.addEventListener('pointermove', onPointerMove, { passive: true })
      }

      cleanup = () => {
        stop()
        if (observer) observer.disconnect()
        window.removeEventListener('resize', onResize)
        window.removeEventListener('pointermove', onPointerMove)
        brandTexture.dispose()
        for (const texture of new Set(sectorTextures)) texture.dispose()
        geometry.dispose()
        material.dispose()
        renderer.dispose()
        if (renderer.domElement.parentNode === mount) {
          mount.removeChild(renderer.domElement)
        }
      }
    }

    // Katman tamamen dekoratif: WebGL kapalıysa, sürücü bağlamı vermiyorsa ya
    // da gölgelendirici derlenmezse sayfa çalışmaya devam etmeli, alan boş
    // kalmalı. Yakalanmazsa bu, ele alınmamış bir promise reddi olurdu.
    init().catch((error) => {
      console.warn('FlexShape çizilemedi:', error)
    })

    return () => {
      disposed = true
      cleanup()
    }
  }, [])

  return <div ref={mountRef} aria-hidden="true" className={className} />
}
