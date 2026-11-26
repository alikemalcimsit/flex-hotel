import {
  REVIEW_DEPARTMENT_LABELS,
  REVIEW_DEPARTMENTS,
  REVIEW_REPLY_STATUS_LABELS,
  REVIEW_REPLY_STATUSES,
  REVIEW_SOURCE_LABELS,
  REVIEW_SOURCES,
  SURVEY_SENTIMENT_LABELS,
  SURVEY_SENTIMENTS,
  SURVEY_TOPIC_LABELS,
  SURVEY_TOPICS,
} from '@hotelos/hotel-contracts';
import { Input, Select } from '@hotelos/ui';
import { Toolbar } from '../../components/Toolbar.jsx';

const all = (label = 'Hepsi') => ({ value: '', label });
const optionsOf = (values, labels) => [all(), ...values.map((value) => ({ value, label: labels[value] ?? value }))];

const SOURCE_OPTIONS = optionsOf(REVIEW_SOURCES, REVIEW_SOURCE_LABELS);
const SENTIMENT_OPTIONS = optionsOf(SURVEY_SENTIMENTS, SURVEY_SENTIMENT_LABELS);
const TOPIC_OPTIONS = optionsOf(SURVEY_TOPICS, SURVEY_TOPIC_LABELS);
const DEPARTMENT_OPTIONS = optionsOf(REVIEW_DEPARTMENTS, REVIEW_DEPARTMENT_LABELS);
const REPLY_OPTIONS = optionsOf(REVIEW_REPLY_STATUSES, REVIEW_REPLY_STATUS_LABELS);
const SORT_OPTIONS = [
  { value: 'recent', label: 'En yeni' },
  { value: 'lowest', label: 'En düşük puan' },
  { value: 'highest', label: 'En yüksek puan' },
];

/** Süzgeç anahtarları (adres satırında tutulur; `analysisStatus` özet kutusundan). */
export const REVIEW_FILTER_KEYS = Object.freeze(['source', 'sentiment', 'topic', 'department', 'replyStatus', 'analysisStatus', 'from', 'to', 'sort']);

/**
 * Yorum listesi süzgeçleri.
 * @param {{ values: Record<string, string>, onChange: (key: string, value: string) => void, searchText: string, onSearch: (text: string) => void, actions?: React.ReactNode }} props
 */
export function ReviewsToolbar({ values, onChange, searchText, onSearch, actions }) {
  const select = (key, label, options, width = 'sm:w-40') => (
    <Select label={label} name={`reviews-${key}`} options={options} value={values[key] ?? ''} onChange={(event) => onChange(key, event.target.value)} className={`w-full ${width}`} />
  );
  return (
    <Toolbar actions={actions}>
      {select('source', 'Kaynak', SOURCE_OPTIONS)}
      {select('sentiment', 'Duygu', SENTIMENT_OPTIONS, 'sm:w-36')}
      {select('topic', 'Konu', TOPIC_OPTIONS)}
      {select('department', 'Departman', DEPARTMENT_OPTIONS, 'sm:w-44')}
      {select('replyStatus', 'Cevap', REPLY_OPTIONS)}
      <Input label="Başlangıç" name="reviews-from" type="date" value={values.from ?? ''} onChange={(event) => onChange('from', event.target.value)} className="w-full sm:w-40" />
      <Input label="Bitiş" name="reviews-to" type="date" value={values.to ?? ''} onChange={(event) => onChange('to', event.target.value)} className="w-full sm:w-40" />
      <Input label="Ara" name="reviews-search" placeholder="Metin, başlık, yazan" value={searchText} onChange={(event) => onSearch(event.target.value)} className="w-full sm:w-56" />
      <Select label="Sıralama" name="reviews-sort" options={SORT_OPTIONS} value={values.sort || 'recent'} onChange={(event) => onChange('sort', event.target.value)} className="w-full sm:w-40" />
    </Toolbar>
  );
}
