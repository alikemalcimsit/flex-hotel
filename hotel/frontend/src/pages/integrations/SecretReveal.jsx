import { useState } from 'react';
import { Alert, Button } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { toastError, toastSuccess } from '../../store/toast.js';

/**
 * Bir kez gösterilen sır (API anahtarı, webhook imza sırrı). Pencere kapanınca bir daha hiçbir yerden okunamaz;
 * kopyalanmadan kapatmak için ayrıca onay istenir.
 *
 * @param {{ title: string, label: string, value: string, hint: string, onClose: () => void }} props
 */
export function SecretReveal({ title, label, value, hint, onClose }) {
  const [copied, setCopied] = useState(false);
  const [warned, setWarned] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toastSuccess('Kopyalandı');
    } catch {
      toastError('Kopyalanamadı; metni seçip elle kopyalayın.');
    }
  }

  function close() {
    if (!copied && !warned) {
      setWarned(true);
      return;
    }
    onClose();
  }

  return (
    <Modal
      open
      title={title}
      onClose={close}
      footer={
        <>
          <Button variant="outline" icon="clipboard" onClick={copy}>
            {copied ? 'Yeniden kopyala' : 'Kopyala'}
          </Button>
          <Button icon="check" onClick={close}>
            {warned && !copied ? 'Kopyalamadan kapat' : 'Kaydettim, kapat'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Alert tone="warning" title="Yalnız şimdi görünür">
          {hint}
        </Alert>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">{label}</span>
          <code
            className="block select-all break-all rounded-control border border-line bg-surface-muted px-3 py-2 font-mono text-sm text-ink [overflow-wrap:anywhere]"
            data-testid="secret-value"
          >
            {value}
          </code>
        </div>
        {warned && !copied && <p className="text-sm font-semibold text-danger-ink">Kopyalamadınız: kapatınca bu değer bir daha gösterilmez, yenisini oluşturmanız gerekir.</p>}
      </div>
    </Modal>
  );
}
