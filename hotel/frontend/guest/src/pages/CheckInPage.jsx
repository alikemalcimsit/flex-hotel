import { useMemo, useRef, useState } from 'react';
import { Alert, Badge, Button, Checkbox, Icon, Input, Select, Spinner, Textarea } from '@hotelos/ui';
import { guestApi, portalPath } from '../api.js';
import { usePortal } from '../App.jsx';
import { errorText, useI18n } from '../i18n.jsx';
import { ID_TYPES, MAX_PHOTOS_PER_PERSON, PAYMENT_PREFERENCES, idNumberProblem } from '../limits.js';
import { preparePhoto } from '../photo.js';
import { SignaturePad } from '../SignaturePad.jsx';
import { useLoad } from '../useLoad.js';

const STEPS = Object.freeze(['people', 'arrival', 'consent']);
const newKey = () => globalThis.crypto.randomUUID();
const defaultIdType = (nationality) => (nationality ? (nationality === 'TR' ? 'NATIONAL_ID' : 'PASSPORT') : '');

/** @param {{ kind: 'primary' | 'adult' | 'child', firstName?: string, lastName?: string, nationality?: string | null, idType?: string | null }} seed */
const newPerson = (seed) => ({
  key: newKey(),
  kind: seed.kind,
  firstName: seed.firstName ?? '',
  lastName: seed.lastName ?? '',
  idType: seed.idType ?? defaultIdType(seed.nationality ?? ''),
  idNumber: '',
  nationality: seed.nationality ?? '',
  birthDate: '',
  photos: [],
});

/**
 * Online check-in (modül 53). Rezervasyondaki kişi sayısı kadar satır açılır (eksik kişi kaldırılabilir); her
 * yetişkine kimlik bilgisi ve en az bir belge fotoğrafı zorunlu, çocuğa isteğe bağlı. Fotoğraf seçilince küçültülüp
 * hemen yüklenir; gönderim fotoğrafları kimlikleriyle bağlar. Gönderilmişse özet maskeli görünür; pencere açıksa
 * değiştirip yeniden gönderilir (fotoğraflar yeniden çekilir).
 */
export function CheckInPage() {
  const { token, reload: reloadOverview } = usePortal();
  const { t } = useI18n();
  const form = useLoad(portalPath(token, '/check-in'));
  const [editing, setEditing] = useState(false);
  const [done, setDone] = useState(false);

  if (form.loading && !form.data) return <Spinner label={t('common.loading')} className="py-10" />;
  if (form.error && !form.data) {
    return (
      <Alert tone="danger" action={<Button type="button" size="sm" variant="outline" onClick={() => form.reload()}>{t('common.retry')}</Button>}>
        {errorText(t, form.error)}
      </Alert>
    );
  }
  const data = form.data;
  const submission = data.submission;
  if (submission && !editing) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="font-brand text-2xl font-bold text-ink">{t('checkin.title')}</h1>
        {done && <Alert tone="success">{t('checkin.done')}</Alert>}
        <Summary submission={submission} />
        {data.window.open && submission.status !== 'COMPLETED' && (
          <Button type="button" variant={submission.status === 'REJECTED' ? 'primary' : 'outline'} icon="pencil" onClick={() => { setEditing(true); setDone(false); }}>
            {t('checkin.resubmit')}
          </Button>
        )}
      </div>
    );
  }
  if (!data.window.open) return <Alert tone="info">{t(`checkinCard.${data.window.reason}`)}</Alert>;
  return (
    <Wizard
      data={data}
      onSubmitted={(next) => {
        form.setData(next);
        setEditing(false);
        setDone(true);
        reloadOverview();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }}
    />
  );
}

/** Gönderilenlerin maskeli özeti. */
function Summary({ submission }) {
  const { t, fmt } = useI18n();
  const tone = { SUBMITTED: 'info', APPROVED: 'success', REJECTED: 'warning', COMPLETED: 'success' }[submission.status];
  return (
    <section className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-bold text-ink">{t('checkin.summary')}</h2>
        <Badge tone={tone}>{fmt.dateTime(submission.submittedAt)}</Badge>
      </div>
      <p className="text-sm text-ink-soft">{t(`checkinCard.${submission.status}`)}{submission.status === 'REJECTED' && submission.rejectReason ? ` ${submission.rejectReason}` : ''}</p>
      <ul className="divide-y divide-line text-sm">
        {submission.people.map((person, index) => (
          <li key={index} className="flex flex-wrap justify-between gap-2 py-2">
            <span className="font-semibold">{[person.firstName, person.lastName].filter(Boolean).join(' ') || t('checkin.primary')}</span>
            <span className="text-ink-soft">
              {person.idType ? `${t(`idType.${person.idType}`)} ${person.idNumber ?? ''} · ${fmt.country(person.nationality)}` : t('checkin.child')} · {t('checkin.photos', { count: person.photos })}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-ink-muted">{t('checkin.masked')}</p>
    </section>
  );
}

/** Üç adımlı form. */
function Wizard({ data, onSubmitted }) {
  const { token } = usePortal();
  const { t, fmt, language } = useI18n();
  const previous = data.submission;
  const [step, setStep] = useState(0);
  const [people, setPeople] = useState(() => {
    if (previous?.people?.length) {
      return previous.people.map((person, index) =>
        newPerson({ kind: index === 0 ? 'primary' : person.isChild ? 'child' : 'adult', firstName: person.firstName ?? '', lastName: person.lastName ?? '', nationality: person.nationality, idType: person.idType }),
      );
    }
    return [
      newPerson({ kind: 'primary', firstName: data.primary.firstName, lastName: data.primary.lastName, nationality: data.primary.nationality }),
      ...Array.from({ length: Math.max(0, data.party.adults - 1) }, () => newPerson({ kind: 'adult' })),
      ...Array.from({ length: data.party.children }, () => newPerson({ kind: 'child' })),
    ];
  });
  const [arrival, setArrival] = useState({ arrivalTime: previous?.arrivalTime ?? '', vehiclePlate: previous?.vehiclePlate ?? '', paymentPreference: previous?.paymentPreference ?? '', note: '' });
  const [consents, setConsents] = useState({ privacy: false, rules: false, documentPhotos: false, marketing: false });
  const [signed, setSigned] = useState(false);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [sending, setSending] = useState(false);
  const signature = useRef(null);

  // Misafirin kendi uyruğu ve Türkiye başta, gerisi misafirin dilinde alfabetik.
  const countries = useMemo(() => {
    const first = [...new Set([data.primary.nationality, 'TR'].filter((code) => code && data.countries.includes(code)))];
    const rest = data.countries.filter((code) => !first.includes(code)).map((code) => ({ value: code, label: fmt.country(code) })).sort((a, b) => a.label.localeCompare(b.label, language));
    return [...first.map((code) => ({ value: code, label: fmt.country(code) })), ...rest];
  }, [data.countries, data.primary.nationality, fmt, language]);
  const adults = people.filter((person) => person.kind !== 'child').length;
  const children = people.filter((person) => person.kind === 'child').length;
  const update = (key, patch) => setPeople((current) => current.map((person) => (person.key === key ? { ...person, ...patch } : person)));
  const updatePhotos = (key, fn) => setPeople((current) => current.map((person) => (person.key === key ? { ...person, photos: fn(person.photos) } : person)));

  const addPhoto = async (person, file) => {
    const local = newKey();
    updatePhotos(person.key, (photos) => [...photos, { key: local, status: 'uploading', previewUrl: null, id: null }]);
    try {
      const prepared = await preparePhoto(file);
      updatePhotos(person.key, (photos) => photos.map((photo) => (photo.key === local ? { ...photo, previewUrl: prepared.previewUrl } : photo)));
      const { id } = await guestApi(portalPath(token, '/check-in/photos'), { method: 'POST', body: { contentType: prepared.contentType, image: prepared.image, thumbnail: prepared.thumbnail } });
      updatePhotos(person.key, (photos) => photos.map((photo) => (photo.key === local ? { ...photo, id, status: 'done' } : photo)));
      setErrors((current) => ({ ...current, [`${person.key}.photos`]: undefined }));
    } catch (error) {
      const message = error instanceof Error && ['not-image', 'unreadable'].includes(error.message) ? t('error.photoRead') : error.message === 'too-large' ? t('error.photoLarge') : errorText(t, error);
      updatePhotos(person.key, (photos) => photos.map((photo) => (photo.key === local ? { ...photo, status: 'error', message } : photo)));
    }
  };

  /** Adımın denetimi (sunucu yeniden denetler; burada misafire erken ve kendi dilinde söylemek için). */
  const validate = (index) => {
    const next = {};
    if (STEPS[index] === 'people') {
      const today = new Date().toISOString().slice(0, 10);
      for (const person of people) {
        const child = person.kind === 'child';
        if (person.kind !== 'primary') {
          if (!person.firstName.trim()) next[`${person.key}.firstName`] = t('error.required');
          if (!person.lastName.trim()) next[`${person.key}.lastName`] = t('error.required');
        }
        const any = person.idType || person.idNumber.trim() || person.birthDate;
        if (child && !any) continue;
        if (!person.idType) next[`${person.key}.idType`] = t('error.required');
        if (!person.nationality) next[`${person.key}.nationality`] = t('error.required');
        if (!person.idNumber.trim()) next[`${person.key}.idNumber`] = t('error.required');
        else if (person.idType && person.nationality) {
          const problem = idNumberProblem(person);
          if (problem) next[`${person.key}.idNumber`] = t(`error.${problem}`);
        }
        if (!person.birthDate || person.birthDate > today || person.birthDate < '1900-01-01') next[`${person.key}.birthDate`] = t('error.birthDate');
        const uploaded = person.photos.filter((photo) => photo.status === 'done').length;
        if (!child && uploaded === 0) next[`${person.key}.photos`] = t('error.photo');
        if (person.photos.some((photo) => photo.status === 'uploading')) next[`${person.key}.photos`] = t('photo.uploading');
      }
    } else if (STEPS[index] === 'arrival') {
      if (arrival.arrivalTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(arrival.arrivalTime)) next.arrivalTime = t('error.time');
      if (!arrival.paymentPreference) next.paymentPreference = t('error.required');
    } else {
      for (const key of ['privacy', 'rules', 'documentPhotos']) if (!consents[key]) next[`consent.${key}`] = t('error.consent');
      if (!signed) next.signature = t('error.signature');
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const goNext = () => {
    if (!validate(step)) return;
    setStep((value) => value + 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const submit = async () => {
    if (!validate(step)) return;
    const image = signature.current?.toPng();
    if (!image) {
      setErrors({ signature: t('error.signature') });
      return;
    }
    const identity = (person) =>
      person.idType || person.idNumber.trim() ? { idType: person.idType || null, idNumber: person.idNumber.trim() || null, nationality: person.nationality || null, birthDate: person.birthDate || null } : { idType: null, idNumber: null, nationality: null, birthDate: null };
    const ids = (person) => person.photos.filter((photo) => photo.status === 'done').map((photo) => photo.id);
    const [primary, ...companions] = people;
    setSending(true);
    setServerError(null);
    try {
      const next = await guestApi(portalPath(token, '/check-in'), {
        method: 'POST',
        body: {
          primary: { identity: identity(primary), documentIds: ids(primary) },
          companions: companions.map((person) => ({ person: { firstName: person.firstName.trim(), lastName: person.lastName.trim(), isChild: person.kind === 'child', ...identity(person) }, documentIds: ids(person) })),
          vehiclePlate: arrival.vehiclePlate.trim() || null,
          arrivalTime: arrival.arrivalTime || null,
          paymentPreference: arrival.paymentPreference,
          note: arrival.note.trim() || null,
          consents,
          signature: { contentType: 'image/png', image },
          language,
        },
      });
      onSubmitted(next);
    } catch (error) {
      setServerError(error.code === 'VALIDATION' ? t('error.fixFields') : errorText(t, error));
    } finally {
      setSending(false);
    }
  };

  const fieldError = (person, field) => errors[`${person.key}.${field}`];
  const textOf = (key) => data.texts[language]?.[key] ?? data.texts.en?.[key] ?? '';

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-brand text-2xl font-bold text-ink">{t('checkin.title')}</h1>
        <p className="mt-1 text-sm text-ink-soft">{t('checkin.intro')}</p>
      </div>
      <ol className="flex gap-2" aria-label={t('checkin.stepOf', { step: step + 1, total: STEPS.length })}>
        {STEPS.map((name, index) => (
          <li key={name} className={`flex-1 rounded-item px-2 py-2 text-center text-xs font-semibold ${index === step ? 'bg-ink text-white' : index < step ? 'bg-success-soft text-success-ink' : 'bg-surface-muted text-ink-muted'}`}>
            {t(`checkin.step.${name}`)}
          </li>
        ))}
      </ol>
      {previous && <Alert tone="info">{t('photo.previous', { count: previous.people.reduce((sum, person) => sum + person.photos, 0) })}</Alert>}

      {STEPS[step] === 'people' && (
        <>
          {people.map((person, index) => (
            <section key={person.key} className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-bold text-ink">
                  {person.kind === 'primary' ? t('checkin.primary') : person.kind === 'child' ? `${t('checkin.child')} · ${t('checkin.companion', { number: index + 1 })}` : t('checkin.companion', { number: index + 1 })}
                </h2>
                {person.kind !== 'primary' && (
                  <Button type="button" size="sm" variant="ghost" icon="close" onClick={() => setPeople((current) => current.filter((row) => row.key !== person.key))}>
                    {t('checkin.remove')}
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input label={t('field.firstName')} value={person.firstName} onChange={(event) => update(person.key, { firstName: event.target.value })} error={fieldError(person, 'firstName')} disabled={person.kind === 'primary'} autoComplete="given-name" />
                <Input label={t('field.lastName')} value={person.lastName} onChange={(event) => update(person.key, { lastName: event.target.value })} error={fieldError(person, 'lastName')} disabled={person.kind === 'primary'} autoComplete="family-name" />
              </div>
              <Select
                label={t('field.nationality')}
                value={person.nationality}
                onChange={(event) => update(person.key, { nationality: event.target.value, idType: person.idType || defaultIdType(event.target.value) })}
                error={fieldError(person, 'nationality')}
                options={[{ value: '', label: t('field.choose') }, ...countries]}
              />
              <div className="grid grid-cols-2 gap-3">
                <Select label={t('field.idType')} value={person.idType} onChange={(event) => update(person.key, { idType: event.target.value })} error={fieldError(person, 'idType')} options={[{ value: '', label: t('field.choose') }, ...ID_TYPES.map((value) => ({ value, label: t(`idType.${value}`) }))]} />
                <Input label={t('field.birthDate')} type="date" value={person.birthDate} max={new Date().toISOString().slice(0, 10)} onChange={(event) => update(person.key, { birthDate: event.target.value })} error={fieldError(person, 'birthDate')} />
              </div>
              <Input label={t('field.idNumber')} value={person.idNumber} onChange={(event) => update(person.key, { idNumber: event.target.value })} error={fieldError(person, 'idNumber')} autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={30} />
              <PhotoField person={person} error={fieldError(person, 'photos')} onAdd={(file) => addPhoto(person, file)} onRemove={(key) => updatePhotos(person.key, (photos) => photos.filter((photo) => photo.key !== key))} />
            </section>
          ))}
          <p className="text-xs text-ink-muted">{t('checkin.partyLimit', { adults: data.party.adults, children: data.party.children })}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" icon="plus" disabled={adults >= data.party.adults} onClick={() => setPeople((current) => [...current, newPerson({ kind: 'adult' })])}>
              {t('checkin.addAdult')}
            </Button>
            <Button type="button" size="sm" variant="outline" icon="plus" disabled={children >= data.party.children} onClick={() => setPeople((current) => [...current, newPerson({ kind: 'child' })])}>
              {t('checkin.addChild')}
            </Button>
          </div>
        </>
      )}

      {STEPS[step] === 'arrival' && (
        <section className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('arrival.time')} type="time" value={arrival.arrivalTime} onChange={(event) => setArrival({ ...arrival, arrivalTime: event.target.value })} error={errors.arrivalTime} />
            <Input label={`${t('arrival.plate')} (${t('common.optional')})`} value={arrival.vehiclePlate} onChange={(event) => setArrival({ ...arrival, vehiclePlate: event.target.value })} autoCapitalize="characters" maxLength={20} />
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-semibold text-ink">{t('arrival.payment')}</legend>
            {PAYMENT_PREFERENCES.map((value) => (
              <label key={value} className={`flex items-center gap-3 rounded-item border px-3 py-2.5 text-sm ${arrival.paymentPreference === value ? 'border-ink' : 'border-line'}`}>
                <input type="radio" name="payment" value={value} checked={arrival.paymentPreference === value} onChange={() => setArrival({ ...arrival, paymentPreference: value })} className="accent-ink" />
                {t(`payment.${value}`)}
              </label>
            ))}
            <span className="flex items-center gap-3 rounded-item border border-dashed border-line px-3 py-2.5 text-sm text-ink-muted" aria-disabled="true">
              <Icon name="creditCard" className="size-4" /> {t('arrival.payOnline')} · {t('common.soon')}
            </span>
            {errors.paymentPreference && <p className="text-xs font-semibold text-sec-strong">{errors.paymentPreference}</p>}
          </fieldset>
          <Textarea label={`${t('arrival.note')} (${t('common.optional')})`} rows={3} maxLength={500} value={arrival.note} onChange={(event) => setArrival({ ...arrival, note: event.target.value })} />
        </section>
      )}

      {STEPS[step] === 'consent' && (
        <section className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4">
          <ConsentText title={t('consent.rulesTitle')} text={textOf('houseRules')} />
          <ConsentText title={t('consent.privacyTitle')} text={textOf('privacyNotice')} />
          {[
            ['rules', t('consent.rules')],
            ['privacy', t('consent.privacy')],
            ['documentPhotos', t('consent.photos')],
            ['marketing', `${t('consent.marketing')} (${t('common.optional')})`],
          ].map(([key, label]) => (
            <div key={key}>
              <Checkbox label={label} checked={consents[key]} onChange={(event) => setConsents({ ...consents, [key]: event.target.checked })} />
              {errors[`consent.${key}`] && <p className="ml-7 text-xs font-semibold text-sec-strong">{errors[`consent.${key}`]}</p>}
            </div>
          ))}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-ink">{t('signature.title')}</span>
              <Button type="button" size="sm" variant="ghost" icon="rotateCcw" onClick={() => signature.current?.clear()}>
                {t('signature.clear')}
              </Button>
            </div>
            <SignaturePad ref={signature} label={t('signature.title')} onChange={(empty) => setSigned(!empty)} />
            <p className="text-xs text-ink-muted">{t('signature.hint')}</p>
            {errors.signature && <p className="text-xs font-semibold text-sec-strong">{errors.signature}</p>}
          </div>
        </section>
      )}

      {Object.values(errors).some(Boolean) && <Alert tone="warning">{t('error.fixFields')}</Alert>}
      {serverError && <Alert tone="danger">{serverError}</Alert>}
      <div className="flex justify-between gap-3">
        <Button type="button" variant="outline" icon="arrowLeft" disabled={step === 0 || sending} onClick={() => setStep((value) => value - 1)}>
          {t('common.back')}
        </Button>
        {step < STEPS.length - 1 ? (
          <Button type="button" onClick={goNext}>
            {t('common.next')}
          </Button>
        ) : (
          <Button type="button" icon="send" onClick={submit} disabled={sending}>
            {sending ? t('checkin.submitting') : t('checkin.submit')}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Kurallar / aydınlatma metni (açılır). */
function ConsentText({ title, text }) {
  const { t } = useI18n();
  return (
    <details className="rounded-item border border-line bg-surface-muted px-3 py-2 text-sm">
      <summary className="cursor-pointer font-semibold text-ink">
        {title} · <span className="font-normal text-ink-soft">{t('consent.read')}</span>
      </summary>
      <p className="mt-2 whitespace-pre-line text-ink-soft">{text}</p>
    </details>
  );
}

/** Kişinin belge fotoğrafları: çek / seç (arka kamera), önizleme, kaldır. */
function PhotoField({ person, error, onAdd, onRemove }) {
  const { t } = useI18n();
  const input = useRef(null);
  const canAdd = person.photos.length < MAX_PHOTOS_PER_PERSON;
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-semibold text-ink">
        {t('photo.title')}
        {person.kind === 'child' ? ` (${t('common.optional')})` : ''}
      </span>
      <p className="text-xs text-ink-muted">{t('photo.hint')}</p>
      <div className="flex flex-wrap gap-2">
        {person.photos.map((photo) => (
          <div key={photo.key} className="relative h-24 w-32 overflow-hidden rounded-item border border-line bg-surface-muted">
            {photo.previewUrl && <img src={photo.previewUrl} alt={t('photo.title')} className="h-full w-full object-cover" />}
            {photo.status === 'uploading' && <span className="absolute inset-0 grid place-items-center bg-white/70 text-xs font-semibold">{t('photo.uploading')}</span>}
            {photo.status === 'error' && <span className="absolute inset-0 grid place-items-center bg-danger-soft p-1 text-center text-xs font-semibold text-danger-ink">{photo.message}</span>}
            {photo.status !== 'uploading' && (
              <button type="button" onClick={() => onRemove(photo.key)} className="absolute right-1 top-1 rounded-full bg-white/90 p-1" aria-label={t('photo.remove')}>
                <Icon name="close" className="size-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
      {canAdd && (
        <>
          <input
            ref={input}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) onAdd(file);
            }}
          />
          <Button type="button" size="sm" variant={person.photos.length ? 'outline' : 'primary'} icon="camera" onClick={() => input.current?.click()} className="self-start">
            {person.photos.length ? t('photo.addBack') : t('photo.take')}
          </Button>
        </>
      )}
      {error && <p className="text-xs font-semibold text-sec-strong">{error}</p>}
    </div>
  );
}
