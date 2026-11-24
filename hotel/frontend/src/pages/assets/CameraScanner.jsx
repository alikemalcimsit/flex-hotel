import { useEffect, useRef, useState } from 'react';
import { Alert, Button } from '@hotelos/ui';

/**
 * Kamerayla QR okuma (modül 46 sayımı): tarayıcının `BarcodeDetector`'ı varsa (Chrome / Android) arka kamera açılır,
 * okunan her yeni kod `onDetected`'a gider. Aynı kod kısa süre içinde tekrar bildirilmez (etiket kamerada dururken
 * yüzlerce okutma olmasın). Desteklemeyen tarayıcıda düğme hiç gösterilmez — el okuyucusu ya da elle yazma kalır.
 */

/** Kare tarama aralığı. */
const SCAN_INTERVAL_MS = 350;
/** Aynı kodun yeniden bildirilmesi için en kısa ara. */
const REPEAT_MS = 2_500;

/** Kamerayla okuma bu tarayıcıda var mı? */
export function cameraScanSupported() {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window && Boolean(navigator.mediaDevices?.getUserMedia);
}

/**
 * @param {{ onDetected: (text: string) => void, onClose: () => void }} props
 */
export function CameraScanner({ onDetected, onClose }) {
  const videoRef = useRef(null);
  const onDetectedRef = useRef(onDetected);
  const [error, setError] = useState(null);
  onDetectedRef.current = onDetected;

  useEffect(() => {
    let stream = null;
    let timer = null;
    let stopped = false;
    let last = { value: '', at: 0 };

    const stop = () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };

    (async () => {
      try {
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (stopped) return stop();
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play();
        const tick = async () => {
          if (stopped) return;
          try {
            const [code] = await detector.detect(video);
            const now = Date.now();
            if (code?.rawValue && (code.rawValue !== last.value || now - last.at > REPEAT_MS)) {
              last = { value: code.rawValue, at: now };
              onDetectedRef.current(code.rawValue);
            }
          } catch {
            // Kare henüz hazır değil; bir sonraki turda yeniden denenir.
          }
          timer = setTimeout(tick, SCAN_INTERVAL_MS);
        };
        tick();
      } catch (failure) {
        if (!stopped) setError(failure?.name === 'NotAllowedError' ? 'Kamera izni verilmedi; tarayıcı ayarlarından izin verin.' : 'Kamera açılamadı; el okuyucusunu ya da elle yazmayı kullanın.');
      }
    })();

    return stop;
  }, []);

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <Alert tone="danger" title="Kamera">
          {error}
        </Alert>
      ) : (
        <video ref={videoRef} muted playsInline className="aspect-video w-full rounded-card bg-black object-cover" aria-label="Kamera görüntüsü" />
      )}
      <Button type="button" variant="outline" icon="close" onClick={onClose}>
        Kamerayı kapat
      </Button>
    </div>
  );
}
