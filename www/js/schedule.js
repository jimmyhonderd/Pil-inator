/* Pil-inator — schema-logica (los te testen, geen DOM) */
(function (root) {
  'use strict';

  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  const DAY_NAMES = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
  const DAY_NAMES_LONG = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
  const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  const MONTHS_LONG = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];

  const pad = (n) => String(n).padStart(2, '0');

  /** Date → 'YYYY-MM-DD' (lokale tijd) */
  function ymd(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  /** Date → 'HH:MM' */
  function hm(d) {
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  /** 'YYYY-MM-DD' (+ optioneel 'HH:MM') → lokale Date */
  function parseDate(s, time) {
    if (!s) return null;
    const [y, m, d] = s.split('-').map(Number);
    let h = 0, mi = 0;
    if (time) [h, mi] = time.split(':').map(Number);
    return new Date(y, m - 1, d, h, mi, 0, 0);
  }
  /** 'YYYY-MM-DDTHH:MM' → lokale Date */
  function parseDateTime(s) {
    if (!s) return null;
    const [d, t] = s.split('T');
    return parseDate(d, t || '00:00');
  }
  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  function addDays(d, n) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
  }
  /** ISO-weekdag: 1 = maandag … 7 = zondag */
  function isoDay(d) {
    return ((d.getDay() + 6) % 7) + 1;
  }

  /** Unieke sleutel van één dosis: medicijn + geplande tijd */
  function doseKey(medId, due) {
    return medId + '@' + ymd(due) + 'T' + hm(due);
  }
  function parseDoseKey(key) {
    const i = key.lastIndexOf('@');
    return { medId: key.slice(0, i), due: parseDateTime(key.slice(i + 1)) };
  }

  function sortedTimes(times) {
    return [...new Set((times || []).filter(Boolean))].sort();
  }

  /**
   * Alle geplande innamemomenten van een medicijn in [from, to).
   * Geeft een gesorteerde lijst Dates terug.
   */
  function dosesBetween(med, from, to) {
    const s = med.schedule || {};
    const out = [];
    if (med.active === false) return out;
    const push = (d) => { if (d >= from && d < to) out.push(d); };

    if (s.kind === 'once') {
      const at = parseDateTime(s.onceAt);
      if (at) push(at);
      return out;
    }

    const startDay = parseDate(s.startDate) || startOfDay(new Date(med.createdAt || Date.now()));
    const endDay = s.endDate ? parseDate(s.endDate) : null; // inclusief
    const endLimit = endDay ? addDays(endDay, 1) : null;

    if (s.kind === 'interval') {
      const every = Math.max(1, Number(s.everyHours) || 8) * HOUR;
      const anchor = parseDate(s.startDate || ymd(startDay), s.startTime || '08:00');
      const hardEnd = endLimit && endLimit < to ? endLimit : to;
      let k = Math.max(0, Math.ceil((from - anchor) / every));
      // Bescherming tegen eindeloze lussen
      for (let guard = 0; guard < 5000; guard++, k++) {
        const t = new Date(anchor.getTime() + k * every);
        if (t >= hardEnd) break;
        push(t);
      }
      return out;
    }

    // daily / weekdays / course
    const times = sortedTimes(s.times);
    if (!times.length) return out;
    let day = startOfDay(from) < startDay ? new Date(startDay) : startOfDay(from);
    const lastDay = startOfDay(new Date(to.getTime() - 1));
    for (let guard = 0; day <= lastDay && guard < 4000; guard++, day = addDays(day, 1)) {
      if (endDay && day > endDay) break;
      if (s.kind === 'weekdays') {
        const days = s.days || [];
        if (!days.includes(isoDay(day))) continue;
      }
      for (const t of times) push(parseDate(ymd(day), t));
    }
    out.sort((a, b) => a - b);
    return out;
  }

  /** Na hoeveel minuten zonder reactie een dosis als gemist geldt */
  function missedAfterMin(med) {
    const r = med.remind || {};
    const every = Number(r.every) || 10;
    const count = Number(r.count) || 0;
    return Math.max(60, every * count + 30);
  }

  /**
   * Status van een dosis.
   * 'taken' | 'skipped' | 'planned' (nog niet aan de beurt) | 'due' (nu innemen) | 'missed'
   */
  function statusOf(med, due, logEntry, now) {
    if (logEntry && logEntry.s) return logEntry.s;
    if (now < due) return 'planned';
    if (now - due < missedAfterMin(med) * MIN) return 'due';
    return 'missed';
  }

  /** Leesbare omschrijving van een schema */
  function describe(med) {
    const s = med.schedule || {};
    const times = sortedTimes(s.times);
    const tList = (arr) => arr.length <= 1 ? (arr[0] || '–') : arr.slice(0, -1).join(', ') + ' en ' + arr[arr.length - 1];
    const dateShort = (str) => { const d = parseDate(str); return d ? d.getDate() + ' ' + MONTHS[d.getMonth()] : ''; };
    switch (s.kind) {
      case 'once': {
        const d = parseDateTime(s.onceAt);
        return d ? 'Eenmalig op ' + DAY_NAMES[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' om ' + hm(d) : 'Eenmalig';
      }
      case 'interval':
        return 'Elke ' + (s.everyHours || 8) + ' uur vanaf ' + (s.startTime || '08:00') + (s.endDate ? ' t/m ' + dateShort(s.endDate) : '');
      case 'weekdays': {
        const days = (s.days || []).slice().sort();
        const names = days.map((d) => DAY_NAMES[d % 7]).join(', ');
        return (names || 'Geen dagen') + ' om ' + tList(times);
      }
      case 'course':
        return 'Kuur: dagelijks om ' + tList(times) + (s.startDate ? ' van ' + dateShort(s.startDate) : '') + (s.endDate ? ' t/m ' + dateShort(s.endDate) : '');
      default:
        return 'Elke dag om ' + tList(times) + (s.endDate ? ' t/m ' + dateShort(s.endDate) : '');
    }
  }

  /** Is het schema afgelopen (geen innames meer na nu)? */
  function isFinished(med, now) {
    const s = med.schedule || {};
    if (s.kind === 'once') { const at = parseDateTime(s.onceAt); return !!at && at < now; }
    if (s.endDate) return addDays(parseDate(s.endDate), 1) <= now;
    return false;
  }

  /** Gemiddeld aantal innames per dag over de komende 14 dagen */
  function dosesPerDay(med, now) {
    const n = dosesBetween(med, now, addDays(now, 14)).length;
    return n / 14;
  }

  /** Controle van een medicijn-object; geeft een lijst met fouten terug */
  function validate(med) {
    const errs = [];
    const s = med.schedule || {};
    if (!med.name || !med.name.trim()) errs.push('Geef het medicijn een naam.');
    if (s.kind === 'once') {
      if (!parseDateTime(s.onceAt)) errs.push('Kies een datum en tijd.');
    } else if (s.kind === 'interval') {
      if (!(Number(s.everyHours) >= 1 && Number(s.everyHours) <= 72)) errs.push('Interval moet tussen 1 en 72 uur liggen.');
      if (!s.startTime) errs.push('Kies een starttijd.');
    } else {
      if (!sortedTimes(s.times).length) errs.push('Voeg minstens één tijd toe.');
      if (s.kind === 'weekdays' && !(s.days || []).length) errs.push('Kies minstens één dag.');
      if (s.kind === 'course' && !s.endDate) errs.push('Een kuur heeft een einddatum nodig.');
    }
    if (s.startDate && s.endDate && parseDate(s.endDate) < parseDate(s.startDate)) errs.push('De einddatum ligt vóór de startdatum.');
    return errs;
  }

  const api = {
    MIN, HOUR, DAY_NAMES, DAY_NAMES_LONG, MONTHS, MONTHS_LONG,
    pad, ymd, hm, parseDate, parseDateTime, startOfDay, addDays, isoDay,
    doseKey, parseDoseKey, dosesBetween, statusOf, missedAfterMin,
    describe, isFinished, dosesPerDay, validate, sortedTimes,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PilSchedule = api;
})(typeof window !== 'undefined' ? window : globalThis);
