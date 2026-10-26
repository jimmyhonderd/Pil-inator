/* Pil-inator — app */
(() => {
  'use strict';

  const S = window.PilSchedule;
  const { MIN, ymd, hm, startOfDay, addDays, doseKey, parseDoseKey, dosesBetween, statusOf } = S;

  // ---------- Native koppeling ----------
  const Cap = window.Capacitor;
  const native = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  const plug = (name) => (native ? Cap.registerPlugin(name) : null);
  const LN = plug('LocalNotifications');
  const Prefs = plug('Preferences');
  const FS = plug('Filesystem');
  const Share = plug('Share');
  const AppP = plug('App');

  const STORE_KEY = 'pilinator.v1';
  const CHANNEL = 'doses';
  const HORIZON_DAYS = 4;          // zoveel dagen vooruit worden meldingen ingepland
  const MAX_PENDING = 400;         // Android staat ~500 wekkers per app toe
  const WINDOW_NOTICE_ID = 7;      // vaste id: "open de app even"

  const COLORS = ['#3B6A47', '#7E9C5E', '#B5562F', '#7C6AA8', '#C49A2E', '#B4607A', '#4F8AA0'];
  const GLYPH_NAMES = { blad: 'Blad', varen: 'Varen', bloem: 'Bloem', bes: 'Bessen', tak: 'Takje', zaad: 'Zaad' };

  // ---------- Status ----------
  let state = defaultState();
  let view = 'today';
  let draft = null;          // medicijn dat in het formulier wordt bewerkt
  let formErrors = [];
  let justTaken = null;      // dosissleutel die net is afgevinkt (voor groei-animatie)
  let notif = { display: native ? 'unknown' : 'web', exact: 'unknown' };
  let lastBackgroundAt = 0;
  const bootAt = Date.now();

  function defaultState() {
    return { v: 1, meds: [], log: {}, snoozes: {}, idMap: {}, nextId: 1000, settings: { snoozeMin: 10 } };
  }

  async function load() {
    let raw = null;
    try {
      raw = Prefs ? (await Prefs.get({ key: STORE_KEY })).value : localStorage.getItem(STORE_KEY);
    } catch (e) { console.error(e); }
    if (raw) {
      try { state = Object.assign(defaultState(), JSON.parse(raw)); } catch (e) { console.error('Opslag onleesbaar', e); }
    }
    state.settings = Object.assign({ snoozeMin: 10 }, state.settings);
  }

  async function save() {
    const raw = JSON.stringify(state);
    try {
      if (Prefs) await Prefs.set({ key: STORE_KEY, value: raw });
      else localStorage.setItem(STORE_KEY, raw);
    } catch (e) { console.error(e); toast('Opslaan is mislukt. Probeer het opnieuw.'); }
  }

  const uid = () => 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const findMed = (id) => state.meds.find((m) => m.id === id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function nextNotifId() {
    if (state.nextId > 2000000000) state.nextId = 1000;
    return state.nextId++;
  }

  // ---------- Tekst-hulpjes ----------
  function longDate(d) {
    return S.DAY_NAMES_LONG[d.getDay()] + ' ' + d.getDate() + ' ' + S.MONTHS_LONG[d.getMonth()];
  }
  function relTime(ms) {
    const m = Math.round(ms / MIN);
    if (m < 1) return 'nu';
    if (m < 60) return 'over ' + m + ' min';
    const h = Math.floor(m / 60), r = m % 60;
    if (h >= 24) return 'over ' + Math.round(h / 24) + (Math.round(h / 24) === 1 ? ' dag' : ' dagen');
    if (h >= 2) return 'over ' + Math.round(m / 60) + ' uur';
    return 'over ' + h + ' uur' + (r ? ' en ' + r + ' min' : '');
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  // ---------- Plant-glyphs ----------
  function glyph(name, color) {
    const c = color || 'currentColor';
    const v = 'var(--sheet)';
    let inner = '';
    switch (name) {
      case 'varen':
        inner = `<path d="M16 30 C16 20 15.5 12 17 3" fill="none" stroke="${c}" stroke-width="1.8" stroke-linecap="round"/>` +
          [[25, 8, 4], [20, 7, 3.6], [15, 6, 3.1], [10, 5, 2.6], [6, 3.8, 2]].map(([y, rx, ry], i) =>
            `<ellipse cx="${16 - rx + 0.5}" cy="${y}" rx="${rx}" ry="${ry * .55}" transform="rotate(${-20} ${16 - rx + .5} ${y})" fill="${c}"/>` +
            `<ellipse cx="${16 + rx - 0.2}" cy="${y - 1.5}" rx="${rx}" ry="${ry * .55}" transform="rotate(${20} ${16 + rx - .2} ${y - 1.5})" fill="${c}"/>`).join('');
        break;
      case 'bloem':
        inner = `<path d="M16 30 V18" stroke="${c}" stroke-width="1.8" stroke-linecap="round"/>` +
          [0, 72, 144, 216, 288].map((a) => {
            const r = a * Math.PI / 180;
            return `<circle cx="${(16 + Math.sin(r) * 6.2).toFixed(2)}" cy="${(12 - Math.cos(r) * 6.2).toFixed(2)}" r="4.6" fill="${c}"/>`;
          }).join('') + `<circle cx="16" cy="12" r="3" fill="${v}"/>`;
        break;
      case 'bes':
        inner = `<path d="M16 3 C16 8 13 10 11 14 M16 3 C17 9 20 11 21 15 M16 3 C16 10 16 14 16 18" fill="none" stroke="${c}" stroke-width="1.5" stroke-linecap="round"/>` +
          `<path d="M16 4 C20 1 25 2 26 6 C22 7 18 6 16 4z" fill="${c}"/>` +
          `<circle cx="10.5" cy="18" r="4.4" fill="${c}"/><circle cx="21.5" cy="19" r="4.4" fill="${c}"/><circle cx="16" cy="24" r="4.6" fill="${c}"/>` +
          `<circle cx="9.2" cy="16.6" r="1" fill="${v}"/><circle cx="20.2" cy="17.6" r="1" fill="${v}"/><circle cx="14.6" cy="22.4" r="1" fill="${v}"/>`;
        break;
      case 'tak':
        inner = `<path d="M7 29 C12 22 17 14 25 4" fill="none" stroke="${c}" stroke-width="1.8" stroke-linecap="round"/>` +
          [[11, 23, -60], [15, 17, 30], [18, 13, -55], [22, 8, 35]].map(([x, y, r]) =>
            `<ellipse cx="${x}" cy="${y}" rx="5" ry="2.3" transform="rotate(${r} ${x} ${y})" fill="${c}"/>`).join('');
        break;
      case 'zaad':
        inner = `<path d="M16 2 C24 9 25 20 16 30 C7 20 8 9 16 2z" fill="${c}"/><path d="M16 6 C19 13 19 20 16 27" fill="none" stroke="${v}" stroke-width="1.4" stroke-linecap="round"/>`;
        break;
      default: // blad
        inner = `<path d="M5 28 C5 15 13 5 28 4 C28 18 19 28 5 28z" fill="${c}"/><path d="M6 27 C12 20 17 14 23 9" fill="none" stroke="${v}" stroke-width="1.4" stroke-linecap="round"/>`;
    }
    return `<svg class="glyph" viewBox="0 0 32 32" aria-hidden="true">${inner}</svg>`;
  }

  // ---------- Dosissen van vandaag ----------
  function doseEntries(from, to, now) {
    const out = [];
    for (const med of state.meds) {
      const created = med.createdAt ? new Date(med.createdAt) : null;
      for (const due of dosesBetween(med, from, to)) {
        const key = doseKey(med.id, due);
        const log = state.log[key];
        if (created && due < created && !log) continue; // niets "gemist" van vóór het toevoegen
        out.push({ med, due, key, log, st: statusOf(med, due, log, now) });
      }
    }
    out.sort((a, b) => a.due - b.due || a.med.name.localeCompare(b.med.name));
    return out;
  }

  function todayEntries(now) {
    const t0 = startOfDay(now);
    return doseEntries(addDays(t0, -1), addDays(t0, 1), now)
      .filter((e) => e.due >= t0 || e.st === 'due'); // openstaande van gisteravond blijven zichtbaar
  }

  // ---------- Rank (herbarium-plant) ----------
  function vineSVG(entries) {
    const W = 360, H = 150;
    const P = [[10, 128], [104, 34], [228, 158], [342, 38]];
    const bez = (t) => {
      const u = 1 - t;
      const x = u * u * u * P[0][0] + 3 * u * u * t * P[1][0] + 3 * u * t * t * P[2][0] + t * t * t * P[3][0];
      const y = u * u * u * P[0][1] + 3 * u * u * t * P[1][1] + 3 * u * t * t * P[2][1] + t * t * t * P[3][1];
      const dx = 3 * u * u * (P[1][0] - P[0][0]) + 6 * u * t * (P[2][0] - P[1][0]) + 3 * t * t * (P[3][0] - P[2][0]);
      const dy = 3 * u * u * (P[1][1] - P[0][1]) + 6 * u * t * (P[2][1] - P[1][1]) + 3 * t * t * (P[3][1] - P[2][1]);
      return { x, y, a: Math.atan2(dy, dx) * 180 / Math.PI };
    };
    const leafPath = (L) => `M0 0 C${-L * .46} ${-L * .22} ${-L * .42} ${-L * .8} 0 ${-L} C${L * .42} ${-L * .8} ${L * .46} ${-L * .22} 0 0Z`;
    let parts = `<path class="vine-stem" d="M${P[0]} C${P[1]} ${P[2]} ${P[3]}"/>`;
    const n = entries.length;
    entries.forEach((e, i) => {
      const t = (i + 1) / (n + 1);
      const p = bez(t);
      const side = i % 2 ? 1 : -1;
      let dir = p.a + side * 62;
      const tw = 8;
      const nx = p.x + Math.cos((p.a + side * 90) * Math.PI / 180) * tw;
      const ny = p.y + Math.sin((p.a + side * 90) * Math.PI / 180) * tw;
      parts += `<path class="vine-twig" d="M${p.x.toFixed(1)} ${p.y.toFixed(1)} L${nx.toFixed(1)} ${ny.toFixed(1)}"/>`;
      const at = `transform="translate(${nx.toFixed(1)} ${ny.toFixed(1)}) rotate(%R)"`;
      const label = `${hm(e.due)} ${esc(e.med.name)}`;
      if (e.st === 'taken') {
        const L = 36;
        parts += `<g ${at.replace('%R', (dir + 90).toFixed(1))}><g class="leaf${e.key === justTaken ? ' grow' : ''}"><title>${label}: ingenomen</title><path d="${leafPath(L)}" fill="${e.med.color}"/><path class="leaf-vein" d="M0 -2 L0 ${-L * .84}"/></g></g>`;
      } else if (e.st === 'skipped') {
        parts += `<g ${at.replace('%R', (dir + 90).toFixed(1))}><g class="leaf skipped"><title>${label}: overgeslagen</title><path d="${leafPath(26)}"/></g></g>`;
      } else if (e.st === 'missed') {
        dir = p.a + side * 128;
        parts += `<g ${at.replace('%R', (dir + 90).toFixed(1))}><g class="leaf missed"><title>${label}: gemist</title><path d="${leafPath(19)}"/></g></g>`;
      } else {
        const due = e.st === 'due';
        parts += `<circle class="bud${due ? ' due' : ''}" cx="${nx.toFixed(1)}" cy="${ny.toFixed(1)}" r="${due ? 7.5 : 5.5}"><title>${label}: ${due ? 'nu innemen' : 'gepland'}</title></circle>`;
      }
    });
    const counted = entries.filter((e) => e.st !== 'skipped');
    if (counted.length && counted.every((e) => e.st === 'taken')) {
      const [bx, by] = P[3];
      parts += `<g class="bloom">` + [0, 72, 144, 216, 288].map((a) => {
        const r = a * Math.PI / 180;
        return `<circle cx="${(bx + Math.sin(r) * 9).toFixed(1)}" cy="${(by - Math.cos(r) * 9).toFixed(1)}" r="7"/>`;
      }).join('') + `<circle class="heart" cx="${bx}" cy="${by}" r="4.6"/></g>`;
    }
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Plant van vandaag: elk blad is een ingenomen dosis">${parts}</svg>`;
  }

  // ---------- Weergaven ----------
  function render() {
    const app = document.getElementById('app');
    document.querySelectorAll('nav.tabs button').forEach((b) => {
      if (b.dataset.nav === view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    if (view === 'meds') app.innerHTML = renderMeds();
    else if (view === 'log') app.innerHTML = renderLog();
    else if (view === 'more') { app.innerHTML = renderMore(); fillMoreAsync(); }
    else app.innerHTML = renderToday();
    justTaken = null;
  }

  function noticesHTML(now) {
    let h = '';
    if (native && notif.display !== 'granted' && notif.display !== 'unknown' && state.meds.length) {
      h += `<div class="notice"><p><b>Meldingen staan uit.</b> Zonder meldingen kan de Pil-inator je niet herinneren.</p>
        <button class="btn" data-act="ask-notif">Meldingen aanzetten</button></div>`;
    } else if (native && notif.exact === 'denied' && state.meds.length) {
      h += `<div class="notice"><p><b>Exacte wekkers staan uit.</b> Herinneringen kunnen dan een paar minuten te laat komen.</p>
        <button class="btn" data-act="ask-exact">Exacte wekkers toestaan</button></div>`;
    }
    for (const med of state.meds) {
      const st = med.stock;
      if (!st || !st.enabled || med.active === false || S.isFinished(med, now)) continue;
      if (Number(st.count) <= Number(st.warnAt)) {
        h += `<div class="notice stock"><p><b>${esc(med.name)} raakt op.</b> Nog ${esc(st.count)} over${daysLeftText(med, now)}.</p>
          <button class="btn ghost" data-act="edit" data-id="${med.id}">Voorraad bijwerken</button></div>`;
      }
    }
    return h;
  }

  function daysLeftText(med, now) {
    const st = med.stock;
    const perDay = S.dosesPerDay(med, now) * (Number(st.perDose) || 1);
    if (!perDay) return '';
    const days = Math.floor(Number(st.count) / perDay);
    return days < 1 ? ', minder dan een dag' : ', genoeg voor ongeveer ' + plural(days, 'dag', 'dagen');
  }

  function renderToday() {
    const now = new Date();
    if (!state.meds.length) {
      return `<h1 class="view-title">Pil-inator</h1>
        <div class="empty">
          ${emptyIllustration()}
          <h2>Nog niets geplant</h2>
          <p>Voeg je eerste medicijn toe. Je krijgt dan op tijd een melding en vinkt hier af wat je hebt ingenomen.</p>
          <button class="btn" data-act="new">Medicijn toevoegen</button>
        </div>`;
    }
    const entries = todayEntries(now);
    const taken = entries.filter((e) => e.st === 'taken').length;
    const total = entries.filter((e) => e.st !== 'skipped').length;
    const next = entries.find((e) => e.st === 'planned');
    let nextLine;
    if (!entries.length) nextLine = 'Vandaag staat er niets gepland.';
    else if (next) nextLine = `Volgende: ${esc(next.med.name)} om ${hm(next.due)}, ${relTime(next.due - now)}.`;
    else if (entries.some((e) => e.st === 'due')) nextLine = 'Er staat iets klaar om in te nemen.';
    else if (taken === total && total) nextLine = 'Alles voor vandaag is ingenomen.';
    else nextLine = 'Voor vandaag staat er niets meer gepland.';

    let html = `${noticesHTML(now)}
      <section class="plate">
        ${vineSVG(entries)}
        <div class="label">
          <div class="date">${longDate(now)}</div>
        </div>
        <div class="next-line">${total ? `<b>${taken} van ${total}</b> ingenomen. ` : ''}${nextLine}</div>
      </section>`;

    if (entries.length) {
      html += `<ol class="timeline">` + entries.map((e) => doseRow(e, now)).join('') + `</ol>`;
    }
    return html;
  }

  function doseRow(e, now) {
    const { med, due, key, st, log } = e;
    const yesterday = due < startOfDay(now);
    const snooze = state.snoozes[key];
    let stateLine = '';
    let actions = '';
    if (st === 'taken') {
      stateLine = 'Ingenomen om ' + hm(new Date(log.at));
      actions = `<button class="btn quiet" data-act="undo" data-key="${key}">Ongedaan maken</button>`;
    } else if (st === 'skipped') {
      stateLine = 'Overgeslagen';
      actions = `<button class="btn quiet" data-act="undo" data-key="${key}">Ongedaan maken</button>`;
    } else if (st === 'missed') {
      stateLine = 'Gemist';
      actions = `<button class="btn ghost" data-act="take" data-key="${key}">Toch ingenomen</button>
        <button class="btn quiet" data-act="skip" data-key="${key}">Overslaan</button>`;
    } else if (st === 'due') {
      stateLine = snooze && snooze > Date.now() ? 'Uitgesteld tot ' + hm(new Date(snooze)) : 'Nu innemen';
      actions = `<button class="btn" data-act="take" data-key="${key}">Ingenomen</button>
        <button class="btn quiet" data-act="snooze" data-key="${key}">Later</button>
        <button class="btn quiet" data-act="skip" data-key="${key}">Overslaan</button>`;
    } else {
      stateLine = relTime(due - now).replace(/^o/, 'O');
      actions = `<button class="btn ghost" data-act="take" data-key="${key}">Ingenomen</button>
        <button class="btn quiet" data-act="skip" data-key="${key}">Overslaan</button>`;
    }
    const meta = [med.dose, med.note].filter(Boolean).map(esc).join('. ');
    return `<li class="dose ${st}">
      <div class="dose-time">${hm(due)}${yesterday ? '<small>gisteren</small>' : ''}</div>
      <div class="node" aria-hidden="true"></div>
      <div class="dose-body">
        <div class="dose-name">${glyph(med.glyph, med.color)}<span>${esc(med.name)}</span></div>
        ${meta ? `<div class="dose-meta">${meta}</div>` : ''}
        <div class="dose-state">${stateLine}</div>
        <div class="dose-actions">${actions}</div>
      </div>
    </li>`;
  }

  function emptyIllustration() {
    return `<svg viewBox="0 0 120 120" aria-hidden="true">
      <path d="M60 112 C58 90 62 70 60 40" fill="none" stroke="var(--stem)" stroke-width="2.4" stroke-linecap="round"/>
      <g transform="translate(60 78) rotate(-58)"><path d="M0 0 C-12 -6 -11 -21 0 -27 C11 -21 12 -6 0 0Z" fill="var(--fern)"/></g>
      <g transform="translate(61 62) rotate(55)"><path d="M0 0 C-10 -5 -9 -18 0 -23 C9 -18 10 -5 0 0Z" fill="var(--fern)" opacity=".75"/></g>
      <circle cx="60" cy="38" r="6" fill="var(--pollen)"/>
      <path d="M38 112 H82" stroke="var(--rule)" stroke-width="2" stroke-linecap="round"/>
    </svg>`;
  }

  function renderMeds() {
    const now = new Date();
    let html = `<h1 class="view-title">Medicijnen</h1>`;
    if (!state.meds.length) {
      html += `<p class="view-sub">Hier komen je medicijnen en hun schema's te staan.</p>`;
    } else {
      html += `<p class="view-sub">Tik op een medicijn om het schema, de herinneringen of de voorraad aan te passen.</p>
        <ul class="med-list">` + state.meds.map((m) => {
        const finished = S.isFinished(m, now);
        const paused = m.active === false;
        const tag = paused ? '<span class="tag done">gepauzeerd</span>' : finished ? '<span class="tag done">afgerond</span>' : '';
        const stock = m.stock && m.stock.enabled ? `<div class="desc">Voorraad: ${esc(m.stock.count)}${daysLeftText(m, now)}</div>` : '';
        return `<li><button class="med-row${paused || finished ? ' paused' : ''}" data-act="edit" data-id="${m.id}">
          <span class="badge">${glyph(m.glyph, m.color)}</span>
          <span><span class="name">${esc(m.name)}</span>${tag}
            ${m.dose ? `<div class="desc">${esc(m.dose)}</div>` : ''}
            <div class="desc">${esc(S.describe(m))}</div>${stock}</span>
          <span class="chev" aria-hidden="true">›</span>
        </button></li>`;
      }).join('') + `</ul>`;
    }
    html += `<button class="btn wide" data-act="new">Medicijn toevoegen</button>`;
    return html;
  }

  function renderLog() {
    const now = new Date();
    const t0 = startOfDay(now);
    const from = addDays(t0, -13);
    const entries = doseEntries(from, now, now).filter((e) => e.st !== 'planned');
    // Afgevinkte dosissen van verwijderde medicijnen
    for (const [key, log] of Object.entries(state.log)) {
      const { medId, due } = parseDoseKey(key);
      if (findMed(medId) || !due || due < from || due > now) continue;
      entries.push({ med: { name: log.n || 'Verwijderd medicijn', color: 'var(--stem)', glyph: 'blad' }, due, key, log, st: log.s });
    }
    if (!entries.length) {
      return `<h1 class="view-title">Logboek</h1><p class="view-sub">Zodra je iets afvinkt of een inname mist, zie je het hier terug.</p>`;
    }
    const week = entries.filter((e) => e.due >= addDays(t0, -6) && e.st !== 'due');
    const wTaken = week.filter((e) => e.st === 'taken').length;
    const wMissed = week.filter((e) => e.st === 'missed').length;
    const wSkipped = week.filter((e) => e.st === 'skipped').length;
    let weekLine = `De afgelopen 7 dagen nam je ${wTaken} van de ${wTaken + wMissed + wSkipped} geplande innames.`;
    const extra = [];
    if (wMissed) extra.push(plural(wMissed, 'gemist', 'gemist'));
    if (wSkipped) extra.push(plural(wSkipped, 'overgeslagen', 'overgeslagen'));
    if (extra.length) weekLine += ' ' + extra.join(', ').replace(/^./, (c) => c.toUpperCase()) + '.';

    let html = `<h1 class="view-title">Logboek</h1><p class="week-line">${weekLine}</p>`;
    for (let i = 0; i < 14; i++) {
      const day = addDays(t0, -i);
      const dayEnd = addDays(day, 1);
      const list = entries.filter((e) => e.due >= day && e.due < dayEnd).sort((a, b) => b.due - a.due);
      if (!list.length) continue;
      const tk = list.filter((e) => e.st === 'taken').length;
      const cnt = list.filter((e) => e.st !== 'skipped').length;
      const title = i === 0 ? 'Vandaag' : i === 1 ? 'Gisteren' : longDate(day).replace(/^./, (c) => c.toUpperCase());
      html += `<section class="day"><div class="day-head"><h3>${title}</h3><span>${tk} van ${cnt}</span></div>` +
        list.map((e) => {
          let s;
          if (e.st === 'taken') {
            const at = new Date(e.log.at);
            const late = at - e.due > 30 * MIN;
            s = `<span class="s s-taken">Ingenomen${late || at < e.due - 30 * MIN ? ' om ' + hm(at) : ''}</span>`;
          } else if (e.st === 'skipped') s = '<span class="s s-skipped">Overgeslagen</span>';
          else if (e.st === 'missed') s = '<span class="s s-missed">Gemist</span>';
          else s = '<span class="s">Nu innemen</span>';
          return `<div class="log-row"><span class="t">${hm(e.due)}</span><span>${esc(e.med.name)}</span>${s}</div>`;
        }).join('') + `</section>`;
    }
    return html;
  }

  function renderMore() {
    const sm = state.settings.snoozeMin;
    return `<h1 class="view-title">Meer</h1>
      <section class="section">
        <h2>Meldingen</h2>
        <div class="check-row"><div class="lbl"><b>Meldingen</b><span>Nodig om je te herinneren</span></div><div id="st-notif">…</div></div>
        <div class="check-row"><div class="lbl"><b>Exacte wekkers</b><span>Zodat een melding op de minuut komt</span></div><div id="st-exact">…</div></div>
        <div class="check-row"><div class="lbl"><b>Testmelding</b><span>Komt over 5 seconden, met dezelfde knoppen als een echte</span></div>
          <button class="btn ghost" data-act="test">Verstuur</button></div>
        <p class="small">Komen meldingen op jouw telefoon toch te laat? Zet dan de batterijoptimalisatie voor Pil-inator uit via Instellingen, Apps, Pil-inator, Batterij.</p>
      </section>
      <section class="section">
        <h2>Herinneringen</h2>
        <div class="field"><label for="snoozeMin">"Later" stelt uit met</label>
          <select id="snoozeMin" data-setting="snoozeMin">
            ${[5, 10, 15, 20, 30, 60].map((n) => `<option value="${n}"${n === sm ? ' selected' : ''}>${n} minuten</option>`).join('')}
          </select></div>
      </section>
      <section class="section">
        <h2>Back-up</h2>
        <p class="small">Je gegevens staan alleen op deze telefoon. Maak af en toe een back-up, bijvoorbeeld naar je Drive of mail, zodat je ze op een nieuwe telefoon kunt terugzetten.</p>
        <div class="btn-row">
          <button class="btn ghost" data-act="export">Back-up maken</button>
          <button class="btn ghost" data-act="import">Back-up terugzetten</button>
        </div>
      </section>
      <section class="section">
        <h2>Over</h2>
        <p class="small" id="about">Pil-inator</p>
      </section>`;
  }

  async function fillMoreAsync() {
    await checkPermissions();
    const set = (id, ok, okText, badText, act) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.innerHTML = ok ? `<span class="ok">${okText}</span>` : act ? `<button class="btn" data-act="${act}">${badText}</button>` : `<span class="bad">${badText}</span>`;
    };
    if (!native) {
      set('st-notif', false, '', 'Alleen in de app');
      set('st-exact', false, '', 'Alleen in de app');
    } else {
      set('st-notif', notif.display === 'granted', 'Aan', 'Aanzetten', 'ask-notif');
      set('st-exact', notif.exact !== 'denied', 'Toegestaan', 'Toestaan', 'ask-exact');
    }
    const about = document.getElementById('about');
    if (about) {
      let ver = '';
      try { if (AppP) { const info = await AppP.getInfo(); ver = ' versie ' + info.version + ' (' + info.build + ')'; } } catch (e) { /* geen info */ }
      about.textContent = 'Pil-inator' + ver + '. Een medicatiewekker die blijft herinneren tot je hebt afgevinkt. Gemaakt door Jimmyhonderd.';
    }
  }

  // ---------- Formulier ----------
  function newMed() {
    const now = new Date();
    const nextHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0);
    return {
      id: uid(), name: '', dose: '', note: '',
      color: COLORS[state.meds.length % COLORS.length],
      glyph: Object.keys(GLYPH_NAMES)[state.meds.length % 6],
      schedule: {
        kind: 'daily', times: ['08:00'], days: [1, 2, 3, 4, 5], everyHours: 8, startTime: '08:00',
        startDate: ymd(now), endDate: '', onceAt: ymd(nextHour) + 'T' + hm(nextHour),
      },
      remind: { every: 10, count: 3 },
      stock: { enabled: false, count: 30, perDose: 1, warnAt: 7 },
      active: true,
      createdAt: Date.now(),
    };
  }

  function openForm(med) {
    draft = JSON.parse(JSON.stringify(med));
    draft._isNew = !findMed(med.id);
    formErrors = [];
    renderForm();
  }

  function closeForm() {
    draft = null;
    const w = document.querySelector('.sheet-wrap');
    if (w) w.remove();
  }

  function renderForm() {
    let wrap = document.querySelector('.sheet-wrap');
    let scroll = 0;
    if (wrap) scroll = wrap.querySelector('.sheet').scrollTop;
    else {
      wrap = document.createElement('div');
      wrap.className = 'sheet-wrap';
      document.body.appendChild(wrap);
    }
    const d = draft, s = d.schedule;
    const kinds = [['daily', 'Elke dag'], ['weekdays', 'Bepaalde dagen'], ['interval', 'Elke paar uur'], ['course', 'Kuur'], ['once', 'Eenmalig']];
    const timesBlock = `<div class="field"><span class="lbl">Tijden</span><div class="times">` +
      (s.times.length ? s.times : ['']).map((t, i) => `<div class="time-item">
        <input type="time" value="${esc(t)}" data-time="${i}" aria-label="Tijd ${i + 1}">
        <button class="icon-btn" data-act="del-time" data-i="${i}" aria-label="Tijd verwijderen"${s.times.length <= 1 ? ' disabled' : ''}>×</button></div>`).join('') +
      `</div><button class="btn quiet" data-act="add-time">Tijd toevoegen</button></div>`;
    const startField = `<div><label for="f-start">Vanaf</label><input type="date" id="f-start" data-f="schedule.startDate" value="${esc(s.startDate)}"></div>`;
    const endField = (req) => `<div><label for="f-end">${req ? 'Laatste dag' : 'Tot en met'}</label><input type="date" id="f-end" data-f="schedule.endDate" value="${esc(s.endDate)}"></div>`;

    let sched = '';
    if (s.kind === 'daily') {
      sched = timesBlock + `<div class="field row">${startField}${endField(false)}</div><p class="hint small">Laat "tot en met" leeg als je het blijvend gebruikt.</p>`;
    } else if (s.kind === 'weekdays') {
      const names = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];
      sched = `<div class="field"><span class="lbl">Op welke dagen</span><div class="chips days">` +
        names.map((n, i) => `<button class="chip day" data-act="day" data-day="${i + 1}" aria-pressed="${(s.days || []).includes(i + 1)}">${n}</button>`).join('') +
        `</div></div>` + timesBlock + `<div class="field row">${startField}${endField(false)}</div>`;
    } else if (s.kind === 'interval') {
      sched = `<div class="field row">
          <div><label for="f-every">Elke</label><select id="f-every" data-f="schedule.everyHours" data-num>
            ${[2, 3, 4, 6, 8, 12, 24, 36, 48, 72].map((h) => `<option value="${h}"${Number(s.everyHours) === h ? ' selected' : ''}>${h} uur</option>`).join('')}
          </select></div>
          <div><label for="f-stime">Eerste keer om</label><input type="time" id="f-stime" data-f="schedule.startTime" value="${esc(s.startTime)}"></div>
        </div><div class="field row">${startField}${endField(false)}</div>
        <p class="hint small">Het interval loopt door de nacht heen, net als bij een antibioticakuur.</p>`;
    } else if (s.kind === 'course') {
      sched = timesBlock + `<div class="field row">${startField}${endField(true)}</div>`;
    } else {
      sched = `<div class="field"><label for="f-once">Datum en tijd</label><input type="datetime-local" id="f-once" data-f="schedule.onceAt" value="${esc(s.onceAt)}"></div>`;
    }

    const r = d.remind, st = d.stock;
    wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <div class="sheet-head"><h2 id="sheet-title">${d._isNew ? 'Nieuw medicijn' : 'Medicijn bewerken'}</h2>
        <button class="icon-btn" data-act="close" aria-label="Sluiten">×</button></div>
      ${formErrors.length ? `<div class="errors" role="alert">${formErrors.map((e) => `<p>${esc(e)}</p>`).join('')}</div>` : ''}
      <div class="field"><label for="f-name">Naam</label><input type="text" id="f-name" data-f="name" value="${esc(d.name)}" placeholder="Bijvoorbeeld Metformine" autocomplete="off"></div>
      <div class="field"><label for="f-dose">Hoeveel</label><input type="text" id="f-dose" data-f="dose" value="${esc(d.dose)}" placeholder="Bijvoorbeeld 1 tablet van 500 mg" autocomplete="off"></div>
      <div class="field"><label for="f-note">Notitie</label><input type="text" id="f-note" data-f="note" value="${esc(d.note)}" placeholder="Bijvoorbeeld met eten innemen" autocomplete="off"></div>
      <div class="field"><span class="lbl">Herkenning</span>
        <div class="glyphs">${Object.entries(GLYPH_NAMES).map(([k, n]) => `<button class="glyph-btn" data-act="glyph" data-g="${k}" aria-pressed="${d.glyph === k}" aria-label="${n}">${glyph(k, d.color)}</button>`).join('')}</div>
        <div class="swatches" style="margin-top:10px">${COLORS.map((c) => `<button class="swatch" data-act="color" data-c="${c}" style="background:${c}" aria-pressed="${d.color === c}" aria-label="Kleur"></button>`).join('')}</div>
      </div>
      <hr class="soft">
      <div class="field"><span class="lbl">Wanneer</span><div class="chips">
        ${kinds.map(([k, n]) => `<button class="chip" data-act="kind" data-k="${k}" aria-pressed="${s.kind === k}">${n}</button>`).join('')}
      </div></div>
      ${sched}
      <hr class="soft">
      <div class="field"><span class="lbl">Blijven herinneren</span>
        <div class="row">
          <div><label for="f-rc" class="small">Herhalen</label><select id="f-rc" data-f="remind.count" data-num>
            ${[0, 1, 2, 3, 4, 5, 6].map((n) => `<option value="${n}"${Number(r.count) === n ? ' selected' : ''}>${n === 0 ? 'Niet herhalen' : n + ' keer'}</option>`).join('')}
          </select></div>
          <div><label for="f-re" class="small">Om de</label><select id="f-re" data-f="remind.every" data-num${Number(r.count) === 0 ? ' disabled' : ''}>
            ${[5, 10, 15, 20, 30].map((n) => `<option value="${n}"${Number(r.every) === n ? ' selected' : ''}>${n} minuten</option>`).join('')}
          </select></div>
        </div>
        <p class="hint">Zolang je niet op Ingenomen of Overslaan tikt, komt de melding terug.</p>
      </div>
      <hr class="soft">
      <div class="field"><label class="switch">Voorraad bijhouden<input type="checkbox" data-f="stock.enabled" ${st.enabled ? 'checked' : ''}></label></div>
      ${st.enabled ? `<div class="field row3">
          <div><label for="f-sc" class="small">Op voorraad</label><input type="number" inputmode="decimal" min="0" id="f-sc" data-f="stock.count" data-num value="${esc(st.count)}"></div>
          <div><label for="f-sp" class="small">Per inname</label><input type="number" inputmode="decimal" min="0" step="0.5" id="f-sp" data-f="stock.perDose" data-num value="${esc(st.perDose)}"></div>
          <div><label for="f-sw" class="small">Waarschuw bij</label><input type="number" inputmode="decimal" min="0" id="f-sw" data-f="stock.warnAt" data-num value="${esc(st.warnAt)}"></div>
        </div>` : ''}
      ${!d._isNew ? `<hr class="soft"><div class="field"><label class="switch">Actief (uit = gepauzeerd, geen meldingen)<input type="checkbox" data-f="active" ${d.active !== false ? 'checked' : ''}></label></div>` : ''}
      <div class="form-actions">
        <button class="btn wide" data-act="save">Opslaan</button>
        ${!d._isNew ? '<button class="btn danger wide" data-act="delete">Verwijderen</button>' : ''}
      </div>
    </div>`;
    wrap.querySelector('.sheet').scrollTop = scroll;
  }

  function setPath(obj, path, val) {
    const parts = path.split('.');
    let o = obj;
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
    o[parts[parts.length - 1]] = val;
  }

  async function saveDraft() {
    const d = draft;
    d.name = (d.name || '').trim();
    d.schedule.times = S.sortedTimes(d.schedule.times);
    formErrors = S.validate(d);
    if (formErrors.length) { renderForm(); document.querySelector('.sheet').scrollTop = 0; return; }
    const isNew = d._isNew;
    delete d._isNew;
    const idx = state.meds.findIndex((m) => m.id === d.id);
    if (idx >= 0) state.meds[idx] = d; else state.meds.push(d);
    await save();
    closeForm();
    render();
    toast(isNew ? `${d.name} is toegevoegd` : 'Wijzigingen opgeslagen');
    if (native && isNew && notif.display !== 'granted') await askNotif();
    refreshNotifications();
  }

  async function deleteDraft() {
    if (!confirm(`${draft.name || 'Dit medicijn'} verwijderen? Het logboek blijft bewaard.`)) return;
    state.meds = state.meds.filter((m) => m.id !== draft.id);
    await save();
    closeForm();
    render();
    toast('Verwijderd');
    refreshNotifications();
  }

  // ---------- Afvinken ----------
  async function markDose(key, status) {
    const { medId } = parseDoseKey(key);
    const med = findMed(medId);
    if (!med) return;
    const prev = state.log[key];
    if (prev && prev.s === status) return;
    if (prev && prev.s === 'taken') adjustStock(med, +1);
    state.log[key] = { s: status, at: Date.now(), n: med.name, d: med.dose || '' };
    delete state.snoozes[key];
    if (status === 'taken') {
      justTaken = key;
      await adjustStock(med, -1);
    }
    await save();
    await clearDelivered(key);
    render();
    refreshNotifications();
  }

  async function undoDose(key) {
    const prev = state.log[key];
    if (!prev) return;
    const med = findMed(parseDoseKey(key).medId);
    if (prev.s === 'taken' && med) adjustStock(med, +1);
    delete state.log[key];
    await save();
    render();
    refreshNotifications();
  }

  async function snoozeDose(key) {
    state.snoozes[key] = Date.now() + state.settings.snoozeMin * MIN;
    await save();
    await clearDelivered(key);
    render();
    refreshNotifications();
  }

  async function adjustStock(med, direction) {
    const st = med.stock;
    if (!st || !st.enabled) return;
    const before = Number(st.count) || 0;
    const step = Number(st.perDose) || 1;
    st.count = Math.max(0, Math.round((before + direction * step) * 100) / 100);
    if (direction < 0 && before > Number(st.warnAt) && st.count <= Number(st.warnAt) && LN) {
      try {
        await LN.schedule({ notifications: [{
          id: nextNotifId(), channelId: CHANNEL,
          title: `${med.name} raakt op`,
          body: `Nog ${st.count} over. Tijd om bij te bestellen.`,
          schedule: { at: new Date(Date.now() + 3000), allowWhileIdle: true },
          smallIcon: 'ic_stat_leaf', iconColor: '#3B6A47',
        }] });
      } catch (e) { console.error(e); }
    }
  }

  async function clearDelivered(key) {
    if (!LN) return;
    const ids = state.idMap[key] || [];
    if (!ids.length) return;
    try {
      await LN.removeDeliveredNotifications({ notifications: ids.map((id) => ({ id, title: '', body: '' })) });
    } catch (e) { console.error(e); }
  }

  // ---------- Meldingen inplannen ----------
  async function checkPermissions() {
    if (!LN) return;
    try { notif.display = (await LN.checkPermissions()).display; } catch (e) { notif.display = 'unknown'; }
    try { notif.exact = (await LN.checkExactNotificationSetting()).exact_alarm; } catch (e) { notif.exact = 'granted'; }
  }

  async function askNotif() {
    if (!LN) return;
    try {
      const r = await LN.requestPermissions();
      notif.display = r.display;
      if (r.display !== 'granted') toast('Zet meldingen aan via Instellingen, Apps, Pil-inator, Meldingen.');
    } catch (e) { console.error(e); }
    render();
    refreshNotifications();
  }

  async function askExact() {
    if (!LN) return;
    try { notif.exact = (await LN.changeExactNotificationSetting()).exact_alarm; } catch (e) { console.error(e); }
    render();
    refreshNotifications();
  }

  async function setupNotifications() {
    if (!LN) return;
    try {
      await LN.createChannel({
        id: CHANNEL, name: 'Medicatie', description: 'Herinneringen om je medicatie in te nemen',
        importance: 5, visibility: 1, vibration: true, lights: true, lightColor: '#3B6A47',
      });
    } catch (e) { console.error(e); }
    await registerActions();
    LN.addListener('localNotificationActionPerformed', onNotificationAction);
  }

  async function registerActions() {
    if (!LN) return;
    try {
      await LN.registerActionTypes({ types: [{
        id: 'DOSE',
        actions: [
          { id: 'taken', title: 'Ingenomen' },
          { id: 'snooze', title: `Over ${state.settings.snoozeMin} min` },
          { id: 'skip', title: 'Overslaan' },
        ],
      }] });
    } catch (e) { console.error(e); }
  }

  function reminderTimes(med, key, due) {
    const r = med.remind || {};
    const every = (Number(r.every) || 10) * MIN;
    const count = Number(r.count) || 0;
    const snooze = state.snoozes[key];
    const base = snooze ? new Date(snooze) : due;
    const out = [{ at: base, rep: snooze ? 'snooze' : 0 }];
    for (let i = 1; i <= count; i++) out.push({ at: new Date(base.getTime() + i * every), rep: i });
    return out;
  }

  let refreshChain = Promise.resolve();
  function refreshNotifications() {
    refreshChain = refreshChain.then(doRefresh).catch((e) => console.error('Inplannen mislukt', e));
    return refreshChain;
  }

  async function doRefresh() {
    if (!LN) return;
    await checkPermissions();
    if (notif.display !== 'granted') { if (view === 'today') render(); return; }

    // Alles wat nog gepland staat opnieuw opbouwen
    const pending = (await LN.getPending()).notifications || [];
    if (pending.length) await LN.cancel({ notifications: pending.map((n) => ({ id: n.id })) });

    const now = new Date();
    const soon = new Date(now.getTime() + 2000);
    const horizon = addDays(now, HORIZON_DAYS);
    const list = [];
    const idMap = {};
    // bestaande (al getoonde) id's van recente dosissen bewaren, zodat afvinken ze kan opruimen
    const keepAfter = addDays(now, -2);
    for (const [key, ids] of Object.entries(state.idMap)) {
      const { due } = parseDoseKey(key);
      if (due && due > keepAfter) idMap[key] = ids.slice(-12);
    }

    for (const med of state.meds) {
      const lookBack = new Date(now.getTime() - S.missedAfterMin(med) * MIN - 24 * 60 * MIN);
      for (const due of dosesBetween(med, lookBack, horizon)) {
        const key = doseKey(med.id, due);
        if (state.log[key]) continue;
        if (med.createdAt && due < new Date(med.createdAt)) continue;
        for (const { at, rep } of reminderTimes(med, key, due)) {
          if (at < soon) continue;
          const first = rep === 0;
          const id = nextNotifId();
          const meta = [med.dose, med.note].filter(Boolean).join('. ');
          list.push({
            id,
            title: first ? `Tijd voor ${med.name}` : `Nog niet afgevinkt: ${med.name}`,
            body: first ? (meta ? `${meta}. ` : '') + `Gepland om ${hm(due)}.` : `Gepland om ${hm(due)}. Tik op Ingenomen zodra je het hebt genomen.`,
            schedule: { at, allowWhileIdle: true },
            channelId: CHANNEL,
            actionTypeId: 'DOSE',
            extra: { key },
            group: key,
            autoCancel: true,
            smallIcon: 'ic_stat_leaf',
            iconColor: med.color,
          });
          (idMap[key] = idMap[key] || []).push(id);
        }
      }
    }

    list.sort((a, b) => a.schedule.at - b.schedule.at);
    const toSchedule = list.slice(0, MAX_PENDING);

    // Vangnet: als de app dagen niet geopend wordt, één melding aan het eind van het venster
    const hasFuture = state.meds.some((m) => m.active !== false && !S.isFinished(m, horizon));
    if (hasFuture) {
      const lastAt = toSchedule.length >= MAX_PENDING ? toSchedule[toSchedule.length - 1].schedule.at : addDays(now, HORIZON_DAYS - 0.1);
      toSchedule.push({
        id: WINDOW_NOTICE_ID, channelId: CHANNEL,
        title: 'Open de Pil-inator even',
        body: 'Zo blijven je herinneringen voor de komende dagen ingepland.',
        schedule: { at: new Date(lastAt.getTime() - 60 * MIN), allowWhileIdle: true },
        smallIcon: 'ic_stat_leaf', iconColor: '#3B6A47',
      });
    }

    for (let i = 0; i < toSchedule.length; i += 60) {
      await LN.schedule({ notifications: toSchedule.slice(i, i + 60) });
    }
    state.idMap = idMap;
    await save();
  }

  async function onNotificationAction(ev) {
    const key = ev && ev.notification && ev.notification.extra && ev.notification.extra.key;
    const act = ev && ev.actionId;
    if (key === 'test') { toast(act === 'tap' ? 'Testmelding geopend' : 'Testmelding werkt'); return; }
    if (!key || !findMed(parseDoseKey(key).medId)) return;
    const med = findMed(parseDoseKey(key).medId);
    const fromOutside = Date.now() - lastBackgroundAt < 5000 || Date.now() - bootAt < 8000;
    if (act === 'taken') { await markDose(key, 'taken'); toast(`${med.name} ingenomen`); }
    else if (act === 'skip') { await markDose(key, 'skipped'); toast(`${med.name} overgeslagen`); }
    else if (act === 'snooze') { await snoozeDose(key); toast(`Uitgesteld met ${state.settings.snoozeMin} minuten`); }
    else { view = 'today'; closeForm(); render(); return; }
    if (fromOutside && AppP) setTimeout(() => { AppP.minimizeApp().catch(() => {}); }, 1500);
  }

  async function sendTest() {
    if (!LN) { toast('Testmeldingen werken alleen in de app.'); return; }
    if (notif.display !== 'granted') { await askNotif(); if (notif.display !== 'granted') return; }
    try {
      await LN.schedule({ notifications: [{
        id: 5, title: 'Testmelding van de Pil-inator', body: 'Zo ziet een herinnering eruit. Probeer de knoppen maar.',
        schedule: { at: new Date(Date.now() + 5000), allowWhileIdle: true },
        channelId: CHANNEL, actionTypeId: 'DOSE', extra: { key: 'test' },
        smallIcon: 'ic_stat_leaf', iconColor: '#3B6A47',
      }] });
      toast('Testmelding komt over 5 seconden');
    } catch (e) { toast('Testmelding mislukt: ' + (e.message || e)); }
  }

  // ---------- Back-up ----------
  async function exportBackup() {
    const data = JSON.stringify({ app: 'pil-inator', exported: new Date().toISOString(), meds: state.meds, log: state.log, settings: state.settings }, null, 1);
    const name = `pil-inator-backup-${ymd(new Date())}.json`;
    if (FS && Share) {
      try {
        const res = await FS.writeFile({ path: name, data, directory: 'CACHE', encoding: 'utf8' });
        await Share.share({ title: 'Pil-inator back-up', files: [res.uri] });
      } catch (e) {
        if (!/cancel/i.test(String(e && e.message))) toast('Back-up maken mislukt: ' + (e.message || e));
      }
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
      a.download = name;
      a.click();
    }
  }

  function importBackup(file) {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = JSON.parse(reader.result);
        if (data.app !== 'pil-inator' || !Array.isArray(data.meds)) throw new Error('Dit is geen Pil-inator back-up.');
        if (!confirm(`Back-up van ${String(data.exported || '').slice(0, 10)} terugzetten? Je huidige medicijnen en logboek worden vervangen.`)) return;
        state.meds = data.meds;
        state.log = data.log || {};
        state.settings = Object.assign({ snoozeMin: 10 }, data.settings);
        state.snoozes = {};
        await save();
        await registerActions();
        render();
        toast(`Teruggezet: ${plural(state.meds.length, 'medicijn', 'medicijnen')}`);
        refreshNotifications();
      } catch (e) { toast(e.message || 'Bestand kon niet worden gelezen.'); }
    };
    reader.readAsText(file);
  }

  // ---------- Toast ----------
  let toastTimer;
  function toast(msg) {
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    const t = document.createElement('div');
    t.className = 'toast';
    t.setAttribute('role', 'status');
    t.textContent = msg;
    document.body.appendChild(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), 3200);
  }

  // ---------- Gebeurtenissen ----------
  document.addEventListener('click', async (ev) => {
    const nav = ev.target.closest('[data-nav]');
    if (nav) { view = nav.dataset.nav; closeForm(); render(); window.scrollTo(0, 0); return; }
    const el = ev.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const act = el.dataset.act;
    const key = el.dataset.key;
    switch (act) {
      case 'take': return markDose(key, 'taken');
      case 'skip': return markDose(key, 'skipped');
      case 'snooze': return snoozeDose(key);
      case 'undo': return undoDose(key);
      case 'new': return openForm(newMed());
      case 'edit': return openForm(findMed(el.dataset.id));
      case 'close': return closeForm();
      case 'save': return saveDraft();
      case 'delete': return deleteDraft();
      case 'ask-notif': return askNotif();
      case 'ask-exact': return askExact();
      case 'test': return sendTest();
      case 'export': return exportBackup();
      case 'import': return document.getElementById('importFile').click();
      // formulier
      case 'kind':
        draft.schedule.kind = el.dataset.k;
        if (el.dataset.k === 'course' && !draft.schedule.endDate) draft.schedule.endDate = ymd(addDays(new Date(), 6));
        return renderForm();
      case 'day': {
        const dnum = Number(el.dataset.day);
        const days = new Set(draft.schedule.days || []);
        if (days.has(dnum)) days.delete(dnum); else days.add(dnum);
        draft.schedule.days = [...days].sort();
        return renderForm();
      }
      case 'add-time': {
        const last = draft.schedule.times[draft.schedule.times.length - 1] || '08:00';
        const [h, m] = last.split(':').map(Number);
        draft.schedule.times.push(S.pad((h + 4) % 24) + ':' + S.pad(m));
        return renderForm();
      }
      case 'del-time':
        draft.schedule.times.splice(Number(el.dataset.i), 1);
        return renderForm();
      case 'glyph': draft.glyph = el.dataset.g; return renderForm();
      case 'color': draft.color = el.dataset.c; return renderForm();
    }
  });

  document.addEventListener('input', (ev) => {
    const el = ev.target;
    if (!draft) return;
    if (el.dataset.time !== undefined) { draft.schedule.times[Number(el.dataset.time)] = el.value; return; }
    if (el.dataset.f && el.type !== 'checkbox' && el.tagName !== 'SELECT') {
      setPath(draft, el.dataset.f, el.dataset.num !== undefined ? (el.value === '' ? '' : Number(el.value)) : el.value);
    }
  });

  document.addEventListener('change', async (ev) => {
    const el = ev.target;
    if (el.id === 'importFile') { if (el.files[0]) importBackup(el.files[0]); el.value = ''; return; }
    if (el.dataset.setting) {
      state.settings[el.dataset.setting] = Number(el.value);
      await save();
      await registerActions();
      toast('Opgeslagen');
      return;
    }
    if (!draft || !el.dataset.f) return;
    if (el.type === 'checkbox') { setPath(draft, el.dataset.f, el.checked); renderForm(); return; }
    if (el.tagName === 'SELECT') {
      setPath(draft, el.dataset.f, el.dataset.num !== undefined ? Number(el.value) : el.value);
      if (el.dataset.f === 'remind.count') renderForm();
    }
  });

  // ---------- Opstarten ----------
  async function init() {
    await load();
    render();
    if (native) {
      await setupNotifications();
      AppP.addListener('appStateChange', ({ isActive }) => {
        if (!isActive) { lastBackgroundAt = Date.now(); return; }
        render();
        refreshNotifications();
      });
      AppP.addListener('backButton', () => {
        if (draft) { closeForm(); return; }
        if (view !== 'today') { view = 'today'; render(); return; }
        AppP.minimizeApp().catch(() => {});
      });
      await refreshNotifications();
      render();
    }
    // Status (nu / gemist) actueel houden
    setInterval(() => { if (!draft && document.visibilityState === 'visible' && (view === 'today' || view === 'log')) render(); }, 30 * 1000);
  }

  init();
})();
