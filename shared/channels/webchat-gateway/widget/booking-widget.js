/*
 * HotelOS online rezervasyon widget'ı (modül 32).
 *
 * Otelin sitesine gömülür:
 *   <script src="https://API_ADRESI/public/booking/widget.js" data-key="GENEL_ANAHTAR" async></script>
 *
 * Web chat balonuyla (modül 8) aynı anahtarı kullanır ve varsayılan olarak
 * balonu da sayfaya ekler (`data-chat="off"` kapatır). Bağımlılığı yok; arayüz
 * Shadow DOM içinde, bütün metinler `textContent` ile basılır (HTML
 * yorumlanmaz). Akış: tarih + kişi → oda tipi + fiyat → misafir bilgileri →
 * özet → onay kodu. Rezervasyon isteği idempotenttir (requestId): ağ hatasında
 * tekrar gönderim ikinci rezervasyon açmaz.
 */
(function hotelosBooking() {
  'use strict';

  var script = document.currentScript;
  if (!script || !script.dataset || !script.dataset.key) return;
  if (window.__hotelosBooking) return; // aynı sayfaya iki kez gömülürse
  window.__hotelosBooking = true;

  var KEY = script.dataset.key;
  var API = new URL(script.src, window.location.href).origin;
  var BASE = API + '/public/booking/' + KEY;
  var tr = /^tr\b/i.test(navigator.language || '');
  // Çoklu dil hazırlığı: bütün metinler tek nesnede (tarayıcı diline göre tr/en).
  var TEXT = tr
    ? {
        open: 'Rezervasyon yap', close: 'Kapat', title: 'Online Rezervasyon',
        checkIn: 'Giriş', checkOut: 'Çıkış', adults: 'Yetişkin', children: 'Çocuk',
        board: 'Pansiyon', coupon: 'Kupon kodu (varsa)', seePrices: 'Fiyatları gör',
        loading: 'Yükleniyor…', night: 'gece', from: 'itibaren', full: 'Bu tarihlerde yer yok',
        notFits: 'Kişi sayısına uygun değil', lastRooms: 'Son', select: 'Seç',
        back: 'Geri', guestTitle: 'Misafir bilgileri', firstName: 'Ad', lastName: 'Soyad',
        email: 'E-posta', phone: 'Telefon (isteğe bağlı)', notes: 'Not (isteğe bağlı)',
        summary: 'Özet', total: 'Toplam', discount: 'İndirim', book: 'Rezervasyonu tamamla',
        booking: 'Gönderiliyor…', successTitle: 'Rezervasyon isteğiniz alındı',
        currency: 'Para birimi', approx: 'yaklaşık', payNow: 'Ön ödemeye geç', payNote: 'Rezervasyonunuzu güvenceye almak için ön ödemeyi kartla yapabilirsiniz.',
        successCode: 'Onay kodunuz', successNote: 'Resepsiyon onayladığında e-posta adresinize bilgi verilecek. Bu kodu not alın.',
        error: 'Bir şeyler ters gitti. Lütfen tekrar deneyin.', retry: 'Tekrar dene', newSearch: 'Yeni arama',
      }
    : {
        open: 'Book now', close: 'Close', title: 'Online Booking',
        checkIn: 'Check-in', checkOut: 'Check-out', adults: 'Adults', children: 'Children',
        board: 'Board', coupon: 'Coupon code (optional)', seePrices: 'See prices',
        loading: 'Loading…', night: 'night(s)', from: 'from', full: 'No availability for these dates',
        notFits: 'Does not fit your party', lastRooms: 'Only', select: 'Select',
        back: 'Back', guestTitle: 'Guest details', firstName: 'First name', lastName: 'Last name',
        email: 'E-mail', phone: 'Phone (optional)', notes: 'Notes (optional)',
        summary: 'Summary', total: 'Total', discount: 'Discount', book: 'Complete booking',
        booking: 'Sending…', successTitle: 'Your booking request has been received',
        currency: 'Currency', approx: 'approx.', payNow: 'Go to prepayment', payNote: 'You can secure your reservation by paying the prepayment by card.',
        successCode: 'Your confirmation code', successNote: 'You will be notified by e-mail once the hotel confirms. Please note this code.',
        error: 'Something went wrong. Please try again.', retry: 'Retry', newSearch: 'New search',
      };

  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    var bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    var hex = Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }

  function api(path, body) {
    return window
      .fetch(BASE + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined)
      .then(function (response) {
        return response.json().then(function (data) {
          if (!response.ok || data.success === false) {
            var err = new Error((data && data.error) || TEXT.error);
            err.code = data && data.code;
            throw err;
          }
          return data.data;
        });
      });
  }

  /* ─────────────── Chat balonu (modül 8, aynı anahtar) ─────────────── */

  if (script.dataset.chat !== 'off' && !window.__hotelosWebchat) {
    var chat = document.createElement('script');
    chat.src = API + '/webchat/widget.js';
    chat.async = true;
    chat.dataset.key = KEY;
    document.body.appendChild(chat);
  }

  /* ─────────────── Arayüz iskeleti ─────────────── */

  var host = document.createElement('div');
  host.setAttribute('data-hotelos-booking', '');
  // Chat balonu sağ altta (20px); rezervasyon düğmesi onun solunda durur.
  host.style.cssText = 'position:fixed;right:90px;bottom:20px;z-index:2147483000;';
  document.body.appendChild(host);
  var root = host.attachShadow({ mode: 'open' });

  var style = document.createElement('style');
  style.textContent = [
    ':host{all:initial}',
    '*{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
    '.btn{height:58px;border-radius:29px;border:0;cursor:pointer;background:var(--accent,#0f766e);color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.2);display:flex;align-items:center;gap:8px;padding:0 20px;font-size:15px;font-weight:700}',
    '.btn:focus-visible,button:focus-visible{outline:3px solid #fff;outline-offset:2px;box-shadow:0 0 0 5px var(--accent,#0f766e)}',
    '.panel{position:absolute;right:0;bottom:72px;width:400px;max-width:calc(100vw - 32px);max-height:calc(100vh - 110px);background:#fff;border-radius:16px;box-shadow:0 16px 48px rgba(0,0,0,.25);display:none;flex-direction:column;overflow:hidden;color:#111}',
    '.panel.open{display:flex}',
    '.head{background:var(--accent,#0f766e);color:#fff;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;gap:8px}',
    '.title{font-weight:700;font-size:15px;margin:0}',
    '.x{background:transparent;border:0;color:#fff;font-size:22px;line-height:1;cursor:pointer;padding:4px 8px;border-radius:8px}',
    '.body{overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px}',
    'label{font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:4px}',
    'input,select,textarea{width:100%;border:1px solid #d1d5db;border-radius:10px;padding:9px 10px;font-size:14px;background:#fff;color:#111}',
    'input:focus,select:focus,textarea:focus{outline:2px solid var(--accent,#0f766e);border-color:transparent}',
    '.row{display:flex;gap:10px}.row>div{flex:1}',
    '.cta{border:0;border-radius:10px;background:var(--accent,#0f766e);color:#fff;font-weight:700;padding:12px;cursor:pointer;font-size:15px}',
    '.cta:disabled{opacity:.5;cursor:default}',
    'a.cta{display:block;text-align:center;text-decoration:none}',
    '.ghost{border:1px solid #d1d5db;border-radius:10px;background:#fff;color:#374151;font-weight:600;padding:10px;cursor:pointer;font-size:14px}',
    '.card{border:1px solid #e5e7eb;border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:6px}',
    '.card.dim{opacity:.55}',
    '.card .name{font-weight:700;font-size:14px}',
    '.card .cap{font-size:12px;color:#6b7280}',
    '.card .price{font-size:16px;font-weight:700}',
    '.card .strike{font-size:13px;color:#9ca3af;text-decoration:line-through;font-weight:400;margin-right:6px}',
    '.tag{display:inline-block;font-size:11px;font-weight:700;border-radius:6px;padding:2px 6px;background:#fef3c7;color:#92400e}',
    '.tag.ok{background:#dcfce7;color:#166534}',
    '.err{font-size:13px;color:#b91c1c;background:#fef2f2;border-radius:10px;padding:9px 12px;display:none;white-space:pre-wrap}',
    '.muted{font-size:12px;color:#6b7280}',
    '.sum{border:1px solid #e5e7eb;border-radius:12px;padding:12px;font-size:14px;display:flex;flex-direction:column;gap:4px}',
    '.sum .line{display:flex;justify-content:space-between}',
    '.big{font-size:22px;font-weight:800;letter-spacing:2px;text-align:center;padding:10px;border:2px dashed var(--accent,#0f766e);border-radius:12px}',
    '@media (max-width:480px){.panel{position:fixed;inset:0;width:100vw;max-width:100vw;height:100%;max-height:100%;border-radius:0;bottom:0}}',
  ].join('\n');
  root.appendChild(style);

  var button = document.createElement('button');
  button.className = 'btn';
  button.type = 'button';
  button.setAttribute('aria-expanded', 'false');
  button.textContent = TEXT.open;

  var panel = document.createElement('div');
  panel.className = 'panel';
  panel.setAttribute('role', 'dialog');
  var head = document.createElement('div');
  head.className = 'head';
  var title = document.createElement('p');
  title.className = 'title';
  title.textContent = TEXT.title;
  var close = document.createElement('button');
  close.className = 'x';
  close.type = 'button';
  close.setAttribute('aria-label', TEXT.close);
  close.textContent = '×';
  head.appendChild(title);
  head.appendChild(close);
  var body = document.createElement('div');
  body.className = 'body';
  panel.appendChild(head);
  panel.appendChild(body);
  root.appendChild(panel);
  root.appendChild(button);

  button.addEventListener('click', function () {
    var open = !panel.classList.contains('open');
    panel.classList.toggle('open', open);
    button.setAttribute('aria-expanded', String(open));
    if (open && !state.options) boot();
  });
  close.addEventListener('click', function () {
    panel.classList.remove('open');
    button.setAttribute('aria-expanded', 'false');
  });

  /* ─────────────── Durum ve yardımcılar ─────────────── */

  var state = {
    displayCurrency: null,
    options: null,
    search: null, // { checkIn, checkOut, adults, children, boardType, couponCode }
    quote: null,
    selected: null, // { roomTypeId, name, total, discount }
    requestId: uuid(), // akış başına bir kez: tekrar denemede aynı istek
  };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function field(labelText, input) {
    var wrap = el('div');
    var label = el('label', null, labelText);
    wrap.appendChild(label);
    wrap.appendChild(input);
    return wrap;
  }
  function numberSelect(max, value) {
    var select = document.createElement('select');
    for (var i = 0; i <= max; i += 1) {
      var option = document.createElement('option');
      option.value = String(i);
      option.textContent = String(i);
      if (i === value) option.selected = true;
      select.appendChild(option);
    }
    return select;
  }
  // Tutar otelin para biriminde; misafir başka bir para birimi seçtiyse günün kuruyla yaklaşık karşılık (modül 60).
  function money(value, currency) {
    var text = value + ' ' + currency;
    var chosen = state.displayCurrency;
    var rates = (state.options && state.options.currencies) || [];
    for (var i = 0; i < rates.length; i += 1) {
      if (rates[i].code === chosen && chosen !== currency && Number(rates[i].rate) > 0) {
        text += ' (' + TEXT.approx + ' ' + (Number(value) / Number(rates[i].rate)).toFixed(2) + ' ' + chosen + ')';
      }
    }
    return text;
  }
  function isoToday(offsetDays) {
    var date = new Date(Date.now() + (offsetDays || 0) * 86400000);
    return date.toISOString().slice(0, 10);
  }
  function showError(box, error) {
    box.textContent = (error && error.message) || TEXT.error;
    box.style.display = 'block';
  }

  function boot() {
    body.textContent = '';
    body.appendChild(el('p', 'muted', TEXT.loading));
    api('/options')
      .then(function (options) {
        state.options = options;
        if (options.widget && options.widget.accentColor) host.style.setProperty('--accent', options.widget.accentColor);
        if (options.widget && options.widget.title) title.textContent = options.widget.title + ' — ' + TEXT.title;
        renderSearch();
      })
      .catch(function () {
        body.textContent = '';
        body.appendChild(el('p', 'muted', TEXT.error));
      });
  }

  /* ─────────────── Adım 1: tarih + kişi ─────────────── */

  function renderSearch() {
    body.textContent = '';
    var previous = state.search;

    var checkIn = document.createElement('input');
    checkIn.type = 'date';
    checkIn.min = isoToday(0);
    checkIn.value = previous ? previous.checkIn : isoToday(1);
    var checkOut = document.createElement('input');
    checkOut.type = 'date';
    checkOut.value = previous ? previous.checkOut : isoToday(2);

    var adults = numberSelect(6, previous ? previous.adults : 2);
    adults.removeChild(adults.firstChild); // 0 yetişkin olmaz
    var children = numberSelect(4, previous ? previous.children : 0);

    var board = document.createElement('select');
    state.options.boardTypes.forEach(function (item) {
      var option = document.createElement('option');
      option.value = item.value;
      option.textContent = item.label;
      if (item.value === (previous ? previous.boardType : state.options.defaultBoardType)) option.selected = true;
      board.appendChild(option);
    });

    var coupon = document.createElement('input');
    coupon.type = 'text';
    coupon.maxLength = 40;
    coupon.value = previous && previous.couponCode ? previous.couponCode : '';

    var error = el('div', 'err');
    var submit = el('button', 'cta', TEXT.seePrices);
    submit.type = 'button';
    submit.addEventListener('click', function () {
      checkIn.min = isoToday(0);
      state.search = {
        checkIn: checkIn.value,
        checkOut: checkOut.value,
        adults: Number(adults.value),
        children: Number(children.value),
        boardType: board.value,
        couponCode: coupon.value.trim() || null,
      };
      submit.disabled = true;
      error.style.display = 'none';
      api('/quote', state.search)
        .then(function (quote) {
          state.quote = quote;
          renderTypes();
        })
        .catch(function (err) { showError(error, err); })
        .then(function () { submit.disabled = false; });
    });

    var dates = el('div', 'row');
    dates.appendChild(field(TEXT.checkIn, checkIn));
    dates.appendChild(field(TEXT.checkOut, checkOut));
    var party = el('div', 'row');
    party.appendChild(field(TEXT.adults, adults));
    party.appendChild(field(TEXT.children, children));
    body.appendChild(dates);
    body.appendChild(party);
    body.appendChild(field(TEXT.board, board));
    var currencies = state.options.currencies || [];
    if (currencies.length) {
      var currency = document.createElement('select');
      [{ code: state.options.hotel.currency }].concat(currencies).forEach(function (item) {
        var option = document.createElement('option');
        option.value = item.code;
        option.textContent = item.code;
        if (item.code === (state.displayCurrency || state.options.hotel.currency)) option.selected = true;
        currency.appendChild(option);
      });
      currency.addEventListener('change', function () {
        state.displayCurrency = currency.value === state.options.hotel.currency ? null : currency.value;
      });
      body.appendChild(field(TEXT.currency, currency));
    }
    body.appendChild(field(TEXT.coupon, coupon));
    body.appendChild(error);
    body.appendChild(submit);
  }

  /* ─────────────── Adım 2: oda tipi + fiyat ─────────────── */

  function renderTypes() {
    body.textContent = '';
    var quote = state.quote;
    body.appendChild(el('p', 'muted', quote.checkIn + ' → ' + quote.checkOut + ' · ' + quote.nights + ' ' + TEXT.night));
    if (quote.coupon && quote.coupon.message) body.appendChild(el('p', 'muted', quote.coupon.message));

    var sellable = 0;
    var error = el('div', 'err');
    quote.roomTypes.forEach(function (type) {
      var usable = type.fits && type.available > 0;
      var card = el('div', usable ? 'card' : 'card dim');
      card.appendChild(el('div', 'name', type.name));
      card.appendChild(el('div', 'cap', type.capacityAdults + '+' + type.capacityChildren));
      var price = el('div', 'price');
      if (type.listTotal) {
        price.appendChild(el('span', 'strike', money(type.listTotal, quote.currency)));
      }
      price.appendChild(document.createTextNode(money(type.total, quote.currency)));
      card.appendChild(price);
      if (type.discount && type.discount.label) card.appendChild(el('span', 'tag ok', type.discount.label));
      if (!type.fits) {
        card.appendChild(el('span', 'tag', TEXT.notFits));
      } else if (type.available === 0) {
        card.appendChild(el('span', 'tag', TEXT.full));
      } else {
        sellable += 1;
        if (type.available < 5) card.appendChild(el('span', 'tag', TEXT.lastRooms + ' ' + type.available));
        var pick = el('button', 'cta', TEXT.select);
        pick.type = 'button';
        pick.addEventListener('click', function () {
          pick.disabled = true;
          error.style.display = 'none';
          api('/quote', Object.assign({}, state.search, { roomTypeId: type.id }))
            .then(function (detailed) {
              var selection = detailed.selection || { roomTypeId: type.id, total: type.total, discount: type.discount || null };
              state.selected = { roomTypeId: type.id, name: type.name, total: selection.total, discount: selection.discount || null };
              renderGuest();
            })
            .catch(function (err) { showError(error, err); })
            .then(function () { pick.disabled = false; });
        });
        card.appendChild(pick);
      }
      body.appendChild(card);
    });
    if (sellable === 0) body.appendChild(el('p', 'muted', TEXT.full));
    body.appendChild(error);

    var back = el('button', 'ghost', TEXT.back);
    back.type = 'button';
    back.addEventListener('click', renderSearch);
    body.appendChild(back);
  }

  /* ─────────────── Adım 3: misafir + özet + gönder ─────────────── */

  function renderGuest() {
    body.textContent = '';
    var search = state.search;
    var selected = state.selected;
    body.appendChild(el('p', 'name', TEXT.guestTitle));

    var firstName = document.createElement('input');
    firstName.maxLength = 100;
    var lastName = document.createElement('input');
    lastName.maxLength = 100;
    var email = document.createElement('input');
    email.type = 'email';
    email.maxLength = 200;
    var phone = document.createElement('input');
    phone.type = 'tel';
    phone.maxLength = 40;
    var notes = document.createElement('textarea');
    notes.rows = 2;
    notes.maxLength = 500;

    var names = el('div', 'row');
    names.appendChild(field(TEXT.firstName, firstName));
    names.appendChild(field(TEXT.lastName, lastName));
    body.appendChild(names);
    body.appendChild(field(TEXT.email, email));
    body.appendChild(field(TEXT.phone, phone));
    body.appendChild(field(TEXT.notes, notes));

    var summary = el('div', 'sum');
    summary.appendChild(el('div', 'name', TEXT.summary));
    var stay = el('div', 'line');
    stay.appendChild(el('span', null, selected.name));
    stay.appendChild(el('span', null, search.checkIn + ' → ' + search.checkOut));
    summary.appendChild(stay);
    if (selected.discount && selected.discount.amount) {
      var discount = el('div', 'line');
      discount.appendChild(el('span', null, TEXT.discount + (selected.discount.label ? ' · ' + selected.discount.label : '')));
      discount.appendChild(el('span', null, '−' + money(selected.discount.amount, state.quote.currency)));
      summary.appendChild(discount);
    }
    var total = el('div', 'line');
    total.appendChild(el('span', 'name', TEXT.total));
    total.appendChild(el('span', 'name', money(selected.total, state.quote.currency)));
    summary.appendChild(total);
    body.appendChild(summary);

    var error = el('div', 'err');
    body.appendChild(error);

    var submit = el('button', 'cta', TEXT.book);
    submit.type = 'button';
    submit.addEventListener('click', function () {
      if (!firstName.value.trim() || !lastName.value.trim() || !email.value.trim()) {
        showError(error, { message: TEXT.firstName + ' / ' + TEXT.lastName + ' / ' + TEXT.email });
        return;
      }
      submit.disabled = true;
      submit.textContent = TEXT.booking;
      error.style.display = 'none';
      api('/reserve', {
        checkIn: search.checkIn,
        checkOut: search.checkOut,
        adults: search.adults,
        children: search.children,
        boardType: search.boardType,
        couponCode: search.couponCode,
        roomTypeId: selected.roomTypeId,
        guest: { firstName: firstName.value.trim(), lastName: lastName.value.trim(), email: email.value.trim(), phone: phone.value.trim() || null },
        notes: notes.value.trim() || null,
        requestId: state.requestId,
      })
        .then(function (result) { renderSuccess(result); })
        .catch(function (err) {
          showError(error, err);
          submit.disabled = false;
          submit.textContent = TEXT.book;
        });
    });
    body.appendChild(submit);

    var back = el('button', 'ghost', TEXT.back);
    back.type = 'button';
    back.addEventListener('click', renderTypes);
    body.appendChild(back);
  }

  function renderSuccess(result) {
    body.textContent = '';
    body.appendChild(el('p', 'name', TEXT.successTitle));
    body.appendChild(el('p', 'muted', TEXT.successCode));
    body.appendChild(el('div', 'big', result.confirmationCode));
    body.appendChild(el('p', 'muted', TEXT.successNote));
    // Sanal POS (modül 50): ayarda ön ödeme açıksa ödeme sayfasına bağlantı.
    if (result.payment && result.payment.url && /^https?:\/\//.test(result.payment.url)) {
      body.appendChild(el('p', 'muted', TEXT.payNote));
      var pay = el('a', 'cta',  TEXT.payNow + ' · ' + money(result.payment.amount, result.payment.currency));
      pay.href = result.payment.url;
      pay.target = '_top';
      pay.rel = 'noopener';
      body.appendChild(pay);
    }
    var again = el('button', 'ghost', TEXT.newSearch);
    again.type = 'button';
    again.addEventListener('click', function () {
      state.search = null;
      state.quote = null;
      state.selected = null;
      state.requestId = uuid(); // yeni akış = yeni idempotens anahtarı
      renderSearch();
    });
    body.appendChild(again);
  }
})();
