import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

/**
 * İmza alanı: parmak / fare / kalemle çizim (pointer olayları), ekran yoğunluğuna göre keskin. `toPng()` boşsa
 * `null`, değilse base64 PNG (saydam zemin) döner; `clear()` siler. Kaydırma, çizim sırasında sayfayı oynatmaz.
 *
 * @type {React.ForwardRefExoticComponent<{ label: string, onChange?: (empty: boolean) => void } & React.RefAttributes<{ toPng: () => string | null, clear: () => void }>>}
 */
export const SignaturePad = forwardRef(function SignaturePad({ label, onChange }, ref) {
  const canvas = useRef(null);
  const drawn = useRef(false);
  const last = useRef(null);

  useEffect(() => {
    const element = canvas.current;
    const ratio = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const { width, height } = element.getBoundingClientRect();
    element.width = Math.round(width * ratio);
    element.height = Math.round(height * ratio);
    const context = element.getContext('2d');
    context.scale(ratio, ratio);
    context.lineWidth = 2.2;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = '#101010';
  }, []);

  const point = (event) => {
    const rect = canvas.current.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const down = (event) => {
    event.preventDefault();
    canvas.current.setPointerCapture?.(event.pointerId);
    last.current = point(event);
  };
  const move = (event) => {
    if (!last.current) return;
    event.preventDefault();
    const next = point(event);
    const context = canvas.current.getContext('2d');
    context.beginPath();
    context.moveTo(last.current.x, last.current.y);
    context.lineTo(next.x, next.y);
    context.stroke();
    last.current = next;
    if (!drawn.current) {
      drawn.current = true;
      onChange?.(false);
    }
  };
  const up = () => {
    last.current = null;
  };

  useImperativeHandle(ref, () => ({
    toPng: () => (drawn.current ? canvas.current.toDataURL('image/png').replace(/^data:[^,]*,/, '') : null),
    clear: () => {
      const element = canvas.current;
      element.getContext('2d').clearRect(0, 0, element.width, element.height);
      drawn.current = false;
      onChange?.(true);
    },
  }));

  return (
    <canvas
      ref={canvas}
      role="img"
      aria-label={label}
      className="h-40 w-full touch-none rounded-panel border-2 border-dashed border-line-strong bg-white"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onPointerLeave={up}
    />
  );
});
