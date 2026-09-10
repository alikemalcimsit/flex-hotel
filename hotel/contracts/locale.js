import { z } from 'zod';

/**
 * Zod'un varsayılan hata mesajlarını Türkçeye çevirir.
 *
 * Neden global ayar, alan alan mesaj değil: her alana elle mesaj yazmak
 * kaçınılmaz olarak eksik kalır — özellikle alan hiç gönderilmediğinde devreye
 * giren *tip* hatalarında. Böyle bir eksik, kullanıcıya "Invalid input: expected
 * string, received undefined" göstermek demektir. Global yerel ayar tabanı
 * kapatıyor; alanlara yazdığımız özel mesajlar yine üstüne geçiyor.
 *
 * Bu dosya şema tanımlayan her modülden önce yüklenmeli; `fields.js` ve
 * `settings.js` bunu ilk satırda import ediyor.
 */
z.config(z.locales.tr());

export { z };
