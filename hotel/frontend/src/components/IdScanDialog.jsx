import { useEffect, useRef, useState } from 'react';
import { ID_DOCUMENT_TYPE_LABELS, mrzProblems, readMrz } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Icon, Spinner, Textarea } from '@hotelos/ui';
import { apiBlob, apiPost } from '../lib/api.js';
import { formatDate } from '../lib/format.js';
import { COUNTRY_OPTIONS } from '../lib/front-desk.js';
import { applyScan, compareScan } from '../lib/idScan.js';
import { readMrzFromImage } from '../lib/mrzReader.js';
import { Modal } from './Modal.jsx';

const FIELD_LABELS = {
  lastName: 'Soyad',
  firstName: 'Ad',
  idType: 'Belge türü',
  idNumber: 'Belge / TC no',
  nationality: 'Uyruk',
  birthDate: 'Doğum tarihi',
};
const countryName = (code) => COUNTRY_OPTIONS.find((option) => option.value === code)?.label ?? code;
/** Alan değerinin ekrandaki hali. */
function display(key, value) {
  if (!value) return '—';
  if (key === 'idType') return ID_DOCUMENT_TYPE_LABELS[value] ?? value;
  if (key === 'nationality') return countryName(value);
  if (key === 'birthDate') return formatDate(value);
  return value;
}
const STATUS_TEXT = {
  'loading tesseract core': 'Okuyucu yükleniyor',
  'initializing tesseract': 'Okuyucu hazırlanıyor',
  'loading language traineddata': 'Dil verisi yükleniyor (ilk seferde)',
  'initializing api': 'Okuyucu hazırlanıyor',
  'recognizing text': 'Belge okunuyor',
};

/**
 * Kimlik / pasaport tarama (modül 59): kamera, dosya ya da online check-in'de misafirin yüklediği fotoğraf →
 * cihazda MRZ okuma → okunanla kayıttakinin alan alan karşılaştırması → personelin seçimi → forma yazılır.
 *
 * Görüntü bu sekmeden çıkmaz ve saklanmaz; forma ve sunucuya yalnız seçilen değerler ile MRZ satırları gider
 * (sunucu satırları yeniden sağlar).
 *
 * @param {{
 *   title: string,
 *   current: import('../lib/idScan.js').PersonValues,
 *   today: string,
 *   onlineDocuments?: Array<{ id: string, label: string, path: string }>,
 *   matchEndpoint?: string | null,
 *   excludeGuestIds?: string[],
 *   onApply: (result: ReturnType<typeof applyScan>) => void,
 *   onClose: () => void,
 * }} props
 */
export function IdScanDialog({ title, current, today, onlineDocuments = [], matchEndpoint = null, excludeGuestIds = [], onApply, onClose }) {
  const [step, setStep] = useState('source');
  const [via, setVia] = useState('STAFF_SCAN');
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [lines, setLines] = useState('');
  const [rows, setRows] = useState(null);
  const [matches, setMatches] = useState([]);
  const abortRef = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const parsed = lines ? readMrz(lines, { today }) : null;
  const problems = parsed ? mrzProblems(parsed) : [];

  async function read(blob, source) {
    setVia(source);
    setError(null);
    setStep('reading');
    setProgress({ status: 'Okuyucu hazırlanıyor', progress: 0 });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await readMrzFromImage(blob, {
        today,
        signal: controller.signal,
        onProgress: ({ status, progress: value }) => setProgress({ status: STATUS_TEXT[status] ?? 'Okunuyor', progress: value }),
      });
      if (controller.signal.aborted) return;
      if (!result) {
        setError('Belgede makine okunur satır (MRZ) bulunamadı. Pasaportun fotoğraflı sayfasını ya da kimlik kartının arka yüzünü, alttaki <<< satırları net görünecek şekilde çekin.');
        setStep('source');
        return;
      }
      setLines(result.text);
      setStep('result');
    } catch (cause) {
      if (cause?.name === 'AbortError') return;
      setError(`Okuyucu çalışmadı: ${cause?.message ?? cause}. Sayfayı yenileyip yeniden deneyin ya da bilgileri elle girin.`);
      setStep('source');
    } finally {
      setProgress(null);
    }
  }

  async function readOnline(doc) {
    try {
      await read(await apiBlob(doc.path), 'ONLINE_PHOTO');
    } catch (cause) {
      setError(cause.message);
      setStep('source');
    }
  }

  async function compare() {
    if (!parsed) return;
    setRows(compareScan(current, parsed));
    setStep('compare');
    setMatches([]);
    const idNumber = parsed.nationality === 'TR' && parsed.turkishIdNumber ? parsed.turkishIdNumber : parsed.documentNumber;
    if (matchEndpoint && idNumber) {
      try {
        const found = await apiPost(matchEndpoint, { idNumber, nationality: parsed.nationality, excludeGuestIds });
        setMatches(found.items);
      } catch {
        // Uyarı amaçlı; okumayı engellemez.
      }
    }
  }

  const choose = (key, choice) => setRows((list) => list.map((row) => (row.key === key ? { ...row, choice } : row)));
  const outcome = rows ? applyScan(rows, lines, via) : null;

  const footer =
    step === 'result' ? (
      <>
        <Button variant="outline" onClick={() => { setLines(''); setStep('source'); }}>Yeniden tara</Button>
        <Button icon="arrowRight" onClick={compare} disabled={!parsed || problems.length > 0}>Karşılaştır</Button>
      </>
    ) : step === 'compare' ? (
      <>
        <Button variant="outline" onClick={() => setStep('result')}>Geri</Button>
        <Button icon="check" onClick={() => { onApply(outcome); onClose(); }}>Forma yaz</Button>
      </>
    ) : step === 'reading' ? (
      <Button variant="outline" onClick={() => { abortRef.current?.abort(); setStep('source'); }}>Vazgeç</Button>
    ) : (
      <Button variant="outline" onClick={onClose}>Kapat</Button>
    );

  return (
    <Modal open size="lg" title={title} onClose={step === 'reading' ? () => {} : onClose} footer={footer}>
      <div className="flex flex-col gap-4 text-sm">
        {step === 'source' && (
          <>
            <p className="text-ink-soft">
              Pasaportun fotoğraflı sayfası ya da kimlik kartının <strong>arka yüzü</strong>: alttaki makine okunur satırlar (&lt;&lt;&lt;) net ve
              parlamasız görünsün. Görüntü bu cihazda okunur; sunucuya gönderilmez ve saklanmaz.
            </p>
            {error && <Alert tone="warning" title="Okunamadı">{error}</Alert>}
            <CameraCapture onCapture={(blob) => read(blob, 'STAFF_SCAN')} />
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" icon="upload" onClick={() => fileRef.current?.click()}>Fotoğraf / tarama dosyası seç</Button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) read(file, 'STAFF_SCAN');
                }}
              />
              <Button variant="ghost" icon="pencil" onClick={() => { setError(null); setLines(''); setStep('result'); }}>Satırları elle yaz</Button>
            </div>
            {onlineDocuments.length > 0 && (
              <div className="flex flex-col gap-2 rounded-panel border border-line bg-surface-muted p-3">
                <p className="text-xs font-bold text-ink-muted">Misafirin online check-in'de yüklediği belge</p>
                <div className="flex flex-wrap gap-2">
                  {onlineDocuments.map((doc) => (
                    <Button key={doc.id} size="sm" variant="outline" icon="fileText" onClick={() => readOnline(doc)}>
                      {doc.label}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {step === 'reading' && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Spinner label={progress?.status ?? 'Okunuyor…'} />
            {progress?.progress > 0 && progress.progress < 1 && (
              <div className="h-1.5 w-56 overflow-hidden rounded-full bg-surface-muted" role="progressbar" aria-valuenow={Math.round(progress.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full bg-ink transition-all" style={{ width: `${Math.round(progress.progress * 100)}%` }} />
              </div>
            )}
          </div>
        )}

        {step === 'result' && (
          <>
            <Textarea
              name="mrz-lines"
              label="Okunan satırlar (gerekirse belgeye bakarak düzeltin)"
              rows={3}
              value={lines}
              onChange={(event) => setLines(event.target.value.toUpperCase())}
              className="font-mono text-xs tracking-wider"
              spellCheck={false}
              autoComplete="off"
              placeholder={'P<TURYILMAZ<<AYSE<<<<<<<<<<<<<<<<<<<<<<<<<<<\nU123456784TUR8503161F3301102<<<<<<<<<<<<<<06'}
            />
            {lines && !parsed && <Alert tone="warning">Satırlar MRZ biçiminde değil (pasaport 2 × 44, kimlik kartı 3 × 30 karakter).</Alert>}
            {parsed && <ReadSummary parsed={parsed} problems={problems} />}
          </>
        )}

        {step === 'compare' && rows && (
          <>
            <p className="text-ink-soft">Her alan için forma yazılacak değeri seçin. Kimlik alanları sağlama haneleriyle doğrulandı, varsayılan belgedeki. Adın sağlaması yok: kayıttaki seçili, farklıysa belgedekini seçebilirsiniz (Türkçe harf farkı fark sayılmaz).</p>
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-ink-muted">
                <tr>
                  <th className="py-1 pr-2 font-semibold">Alan</th>
                  <th className="py-1 pr-2 font-semibold">Kayıttaki</th>
                  <th className="py-1 font-semibold">Belgeden okunan</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} className="border-t border-line">
                    <td className="py-2 pr-2 font-semibold text-ink">
                      {FIELD_LABELS[row.key]}
                      {row.same ? <Badge tone="success" className="ml-2">aynı</Badge> : row.current && row.read ? <Badge tone="warning" className="ml-2">farklı</Badge> : null}
                    </td>
                    <td className="py-2 pr-2">
                      <Choice name={row.key} checked={row.choice === 'current'} disabled={!row.current && !row.read} onChange={() => choose(row.key, 'current')} label={display(row.key, row.current)} />
                    </td>
                    <td className="py-2">
                      <Choice name={row.key} checked={row.choice === 'read'} disabled={!row.read} onChange={() => choose(row.key, 'read')} label={display(row.key, row.read)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {outcome && !outcome.documentRead && (
              <Alert tone="info">Kimlik alanlarından biri kayıttakinden seçildi: kimlik "elle girilmiş" sayılır, "kimlikten okundu" işareti konmaz.</Alert>
            )}
            {outcome?.nameChanged && <Alert tone="info">Ad belgedeki gibi değişecek. MRZ'de Türkçe harf yoktur (Ç, Ş, Ğ, İ, Ö, Ü); gerekiyorsa formda düzeltin.</Alert>}
            {matches.length > 0 && (
              <Alert tone="warning" title="Bu belge başka kartta da kayıtlı">
                {matches.map((match) => `${match.name} (${match.idNumber})`).join(', ')}. Aynı kişiyse kartları Misafirler ekranından birleştirin.
              </Alert>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

/** @param {{ name: string, checked: boolean, disabled: boolean, onChange: () => void, label: string }} props */
function Choice({ name, checked, disabled, onChange, label }) {
  return (
    <label className={`flex items-center gap-2 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <input type="radio" name={`scan-${name}`} checked={checked} disabled={disabled} onChange={onChange} className="accent-ink" />
      <span className="[overflow-wrap:anywhere]">{label}</span>
    </label>
  );
}

/** Okunanın özeti ve sağlamalar. */
function ReadSummary({ parsed, problems }) {
  const turkish = parsed.nationality === 'TR' && parsed.turkishIdNumber;
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-3">
        <Item label="Belge">{parsed.documentType === 'PASSPORT' ? 'Pasaport' : parsed.documentType === 'NATIONAL_ID' ? 'Kimlik kartı' : 'Diğer'} ({parsed.format})</Item>
        <Item label="Ad soyad">{`${parsed.givenNames} ${parsed.surname}`.trim() || '—'}</Item>
        <Item label="Uyruk">{parsed.nationality ? countryName(parsed.nationality) : parsed.nationalityCode || '—'}</Item>
        <Item label="Belge no"><span className="font-mono">{parsed.documentNumber || '—'}</span></Item>
        {turkish && <Item label="TC kimlik no"><span className="font-mono">{parsed.turkishIdNumber}</span></Item>}
        <Item label="Doğum tarihi">{parsed.birthDate ? formatDate(parsed.birthDate) : '—'}</Item>
        <Item label="Son kullanma">{parsed.expiryDate ? formatDate(parsed.expiryDate) : '—'}</Item>
      </dl>
      {problems.length === 0 ? (
        <Alert tone="success" title="Sağlama haneleri tuttu">
          Okuma doğrulandı{parsed.corrected ? ' (belge numarasındaki benzer karakterler sağlamaya göre düzeltildi)' : ''}. Adın sağlaması yoktur; belgeyle karşılaştırın.
        </Alert>
      ) : (
        <Alert tone="warning" title="Okuma doğrulanamadı">
          {problems.join('; ')}. Satırları belgeye bakarak düzeltin ya da yeniden tarayın.
        </Alert>
      )}
      {parsed.expired && <Alert tone="danger" title="Belgenin süresi dolmuş">Son kullanma {formatDate(parsed.expiryDate)}. Geçerli bir belge isteyin.</Alert>}
      {parsed.nameTruncated && <Alert tone="info">Ad, belgedeki satıra sığmadığı için kısaltılmış olabilir.</Alert>}
    </div>
  );
}

function Item({ label, children }) {
  return (
    <div>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}

/**
 * Canlı kamera: arka kamera, belge çerçevesi, "Çek". Kamera yoksa ya da izin verilmezse dosya seçimine yönlendirir.
 * Kapanınca kamera bırakılır.
 * @param {{ onCapture: (blob: Blob) => void }} props
 */
function CameraCapture({ onCapture }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [state, setState] = useState('idle');
  const [message, setMessage] = useState(null);

  useEffect(() => () => stop(), []);

  function stop() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState('unavailable');
      setMessage('Bu tarayıcı kameraya erişemiyor (güvenli bağlantı gerekir). Fotoğraf dosyası seçin.');
      return;
    }
    setState('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      streamRef.current = stream;
      setState('live');
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      });
    } catch (cause) {
      setState('unavailable');
      setMessage(cause?.name === 'NotAllowedError' ? 'Kamera izni verilmedi. Tarayıcının adres çubuğundan izin verin ya da fotoğraf dosyası seçin.' : 'Kamera açılamadı. Fotoğraf dosyası seçin.');
    }
  }

  function capture() {
    const video = videoRef.current;
    if (!video?.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        canvas.width = 0;
        canvas.height = 0;
        stop();
        setState('idle');
        if (blob) onCapture(blob);
      },
      'image/jpeg',
      0.92,
    );
  }

  if (state === 'live' || state === 'starting') {
    return (
      <div className="flex flex-col gap-2">
        <div className="relative overflow-hidden rounded-panel bg-black">
          <video ref={videoRef} playsInline muted className="block max-h-[50vh] w-full object-contain" />
          {/* Belge çerçevesi: MRZ alt bantta. */}
          <div className="pointer-events-none absolute inset-[8%] rounded-item border-2 border-white/80">
            <div className="absolute inset-x-[4%] bottom-[6%] h-[24%] rounded border border-dashed border-white/80" />
            <span className="absolute bottom-[32%] left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-black/60 px-2 py-0.5 text-xs text-white">
              &lt;&lt;&lt; satırları kesikli alana
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          <Button icon="camera" onClick={capture} disabled={state !== 'live'}>Çek ve oku</Button>
          <Button variant="outline" onClick={() => { stop(); setState('idle'); }}>Kamerayı kapat</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {message && <Alert tone="info">{message}</Alert>}
      <div>
        <Button icon="camera" onClick={start}>
          <span>Kamerayla tara</span>
        </Button>
      </div>
    </div>
  );
}

/** Kişinin kimliği belgeden okunduysa küçük rozet. */
export function IdReadBadge({ read }) {
  if (!read) return null;
  return (
    <Badge tone="success">
      <Icon name="checkCircle" className="inline size-3.5" />
      Kimlikten okundu{read.at ? ` · ${formatDate(read.at.slice(0, 10))}` : ''}
    </Badge>
  );
}
