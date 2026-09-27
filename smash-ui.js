// Super Smash Rolls: shared drawing code for the TV and the phones.
// SSR.board(state, fighter, opts) → the hero board (Layout A, Split Board)
// SSR.hud(state, fighter, opts)   → the player HUD (HUD 1, HUD Slash)
// SSR.fxPanel(state, fighter, id, onPick, onClose) → token/status details
(function () {
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function textOn(hex) {
    var c = String(hex || '#ffffff').replace('#', '');
    var r = parseInt(c.substr(0, 2), 16), g = parseInt(c.substr(2, 2), 16), b = parseInt(c.substr(4, 2), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#16122b' : '#ffffff';
  }
  function svg(path, size) {
    var ns = 'http://www.w3.org/2000/svg';
    var s = document.createElementNS(ns, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size);
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2');
    s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS(ns, 'path'); p.setAttribute('d', path); s.appendChild(p);
    return s;
  }
  var SHIELD = 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z';
  var BOLT = 'M13 2L4 14h7l-1 8 9-12h-7l1-8z';

  function lvl(f, id) { return (f.upgrades && f.upgrades[id]) || 1; }

  // A dice chip colored like the hero's face for that number.
  function chip(h, label) {
    var c = el('span', 'ssr-chip', label);
    var n = parseInt(label, 10);
    if (n >= 1 && n <= 6 && h.faces[n]) {
      var col = h.symbols[h.faces[n]].color;
      c.style.background = col; c.style.color = textOn(col);
    }
    return c;
  }
  function chips(h, list) {
    var box = el('div', 'ssr-chips');
    (list || []).forEach(function (l) { box.appendChild(chip(h, l)); });
    return box;
  }

  function usedName(s, f) {
    if (s.pending && s.pending.attackerId === f.id) return s.pending.ability;
    var e = s.event;
    if (e && e.by === f.id && (e.kind === 'hit' || e.kind === 'attack') && e.abilityName) return e.abilityName;
    return null;
  }

  // Everything a fighter carries: tokens first, then statuses.
  var NO_STEAL = 'No. Statuses stay until they wear off.';
  var STATUS = {
    burn: { name: 'Burn', text: 'Take 2 damage for each stack (up to 3 stacks).', when: 'At the start of your turn, then all stacks are removed. Shake It Off or Tea with Iroh clears it.' },
    knockdown: { name: 'Knocked Down', text: 'Your offensive roll gets 2 rolls instead of 3.', when: 'Your next offensive roll, then it wears off.' },
    frozen: { name: 'Frozen', text: 'Your defense rolls 1 fewer die.', when: 'The next time you roll defense, then it wears off.' },
    shield: { name: 'Shield', text: 'Prevents this much damage.', when: 'The next attack on you this turn. Leftover shield is gone at the end of the turn.' },
    sealed: { name: 'Ultimate sealed', text: "You can't use your Ultimate.", when: 'Until the end of your next turn.' }
  };
  var GLYPH = { avatarState: 'AV', airScooter: 'AS', weaponUp: 'WU', hammerLock: 'HL', knockdown: 'KD' };
  function glyph(name, id) {
    if (id && GLYPH[id]) return GLYPH[id];
    var w = name.replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean);
    return (w.length > 1 ? w[0][0] + w[1][0] : name.slice(0, 2)).toUpperCase();
  }
  // Everything to show for a fighter: their hero's token slots (even at 0, so you can
  // tap them and learn what they do), any other tokens they hold, then statuses.
  function effects(s, f) {
    var out = [];
    var have = {};
    f.tokens.forEach(function (t) { have[t.id] = t.n; });
    var slots = ((s.heroes[f.hero] || {}).tokenSlots || []).slice();
    f.tokens.forEach(function (t) { if (slots.indexOf(t.id) < 0) slots.push(t.id); });
    slots.forEach(function (id) {
      var info = s.tokenInfo[id];
      if (!info) return;
      var n = have[id] || 0;
      out.push({ id: id, kind: 'tok', name: info.name, text: info.text, count: n, max: info.max, empty: !n,
        when: info.when, steal: info.stealNote, glyph: glyph(info.name, id) });
    });
    function sts(id, n) { var x = STATUS[id]; out.push({ id: id, kind: 'sts', name: x.name, text: x.text, when: x.when, steal: NO_STEAL, count: n }); }
    if (f.status.burn) sts('burn', f.status.burn);
    if (f.status.knockdown) sts('knockdown', 1);
    if (f.status.frozen) sts('frozen', 1);
    if (f.shield) sts('shield', f.shield);
    if (f.sealed) sts('sealed', 1);
    out.forEach(function (e) { if (!e.glyph) e.glyph = glyph(e.name, e.id); });
    return out;
  }
  function countLabel(e) {
    if (e.kind === 'sts') return 'STATUS · ×' + e.count;
    return 'TOKEN · ' + (e.max > 1 ? e.count + ' / ' + e.max : e.count ? 'HELD' : 'NOT HELD');
  }
  function facts(e) {
    var d = el('dl', 'facts');
    [['What it does', e.text], ['Can it be stolen?', e.steal], ['When is it used?', e.when]].forEach(function (r) {
      if (!r[1]) return;
      d.appendChild(el('dt', '', r[0])); d.appendChild(el('dd', '', r[1]));
    });
    return d;
  }

  // ---------------------------------------------------------------- board (Layout A)
  function board(s, f, opts) {
    opts = opts || {};
    var h = s.heroes[f.hero];
    var root = el('div', 'ssr-board' + (opts.compact ? ' compact' : ''));
    var isActive = f.id === s.activeId;
    var rolling = opts.highlight !== false && isActive && s.step === 'roll' && s.dice && s.dice.rolled && !s.dice.done;
    var q = {};
    if (rolling) (s.qualifying || []).forEach(function (x) { q[x.id] = x; });
    var used = opts.highlight !== false ? usedName(s, f) : null;
    var defId = s.pending ? s.pending.defenderId : null;

    var left = el('div', 'ssr-left');
    var art = el('div', 'ssr-art');
    var img = el('img'); img.src = h.art; img.alt = h.name; art.appendChild(img);
    left.appendChild(art);
    var plate = el('div', 'ssr-plate');
    plate.appendChild(el('div', 'nm', h.name.toUpperCase()));
    plate.appendChild(el('div', 'tt', f.name + ' · ' + h.title + (f.bot ? ' · bot' : '')));
    var st = el('div', 'st');
    var hp = el('span'); hp.appendChild(el('b', '', f.alive ? f.hp : 'KO')); hp.appendChild(document.createTextNode(' / ' + f.maxHp + ' HP'));
    var bp = el('span'); bp.style.color = '#ffc23d'; bp.appendChild(el('b', '', f.cp)); bp.appendChild(document.createTextNode(' BP'));
    var cd = el('span'); cd.appendChild(el('b', '', f.cards)); cd.appendChild(document.createTextNode(' cards'));
    st.appendChild(hp); st.appendChild(bp); st.appendChild(cd);
    plate.appendChild(st);
    left.appendChild(plate);
    root.appendChild(left);

    var right = el('div', 'ssr-right');
    // Status row: this hero's token slots, then any statuses
    var stat = el('div', 'ssr-status');
    stat.appendChild(el('div', 'lab', 'STATUS'));
    var have = {};
    f.tokens.forEach(function (t) { have[t.id] = t.n; });
    (h.tokenSlots || []).forEach(function (id) {
      var info = s.tokenInfo[id];
      var n = have[id] || 0;
      var t = el('div', 'ssr-tok' + (n ? ' on' : ''));
      var c = el('div', 'c', info.max > 1 ? n + '/' + info.max : (n ? '✓' : '0'));
      if (n) { c.style.borderColor = info.color; c.style.background = info.color + '33'; }
      t.appendChild(c); t.appendChild(el('span', '', info.name));
      stat.appendChild(t);
    });
    effects(s, f).filter(function (e) { return e.kind === 'sts'; }).forEach(function (e) {
      var t = el('div', 'ssr-tok on bad');
      var c = el('div', 'c'); c.style.borderColor = '#ff6b8b'; c.style.background = 'rgba(255,107,139,.2)';
      c.appendChild(el('span', '', e.count > 1 ? e.count : '!'));
      t.appendChild(c); t.appendChild(el('span', '', e.name));
      stat.appendChild(t);
    });
    right.appendChild(stat);

    // 4 × 2 grid: spaces 1-7 are abilities, space 8 is defense
    var grid = el('div', 'ssr-grid');
    h.abilities.slice().sort(function (a, b) { return a.space - b.space; }).forEach(function (a) {
      var card = el('div', 'ssr-card' + (used === a.name ? ' use' : q[a.id] ? ' q' : rolling ? ' dim' : ''));
      var hd = el('div', 'hd');
      hd.appendChild(el('span', 'n', a.space));
      hd.appendChild(el('span', 't', a.name));
      card.appendChild(hd);
      var L = lvl(f, a.id);
      if (L > 1) card.appendChild(el('span', 'lv', 'II'));
      card.appendChild(chips(h, a.chips));
      card.appendChild(el('div', 'x', a.text[L - 1] || a.text[0]));
      grid.appendChild(card);
    });
    var d = h.defense;
    var dc = el('div', 'ssr-card def' + (s.step === 'defend' && defId === f.id ? ' use' : ''));
    var dl = el('div', 'dl'); dl.appendChild(svg(SHIELD, '1.4em')); dl.appendChild(document.createTextNode('8 · DEFENSE'));
    dc.appendChild(dl);
    if (lvl(f, d.id) > 1) dc.appendChild(el('span', 'lv', 'II'));
    dc.appendChild(el('div', 't', d.name));
    dc.appendChild(el('div', 'x', d.text[lvl(f, d.id) - 1] || d.text[0]));
    grid.appendChild(dc);
    right.appendChild(grid);

    // Ultimate banner
    var u = h.ultimate;
    var ult = el('div', 'ssr-ult' + (used === u.name ? ' use' : q[u.id] ? ' q' : ''));
    var k = el('div', 'k'); k.appendChild(svg(BOLT, '1.6em')); k.appendChild(document.createTextNode('ULTIMATE'));
    ult.appendChild(k);
    var ub = el('div');
    var un = el('div', 'un'); un.appendChild(el('b', '', u.name.toUpperCase())); un.appendChild(chips(h, u.chips));
    ub.appendChild(un);
    ub.appendChild(el('div', 'ux', u.need + '. ' + u.text[0]));
    ult.appendChild(ub);
    right.appendChild(ult);
    root.appendChild(right);
    return root;
  }

  // ---------------------------------------------------------------- HUD 1 (HUD Slash)
  // opts.flip mirrors it (player box on the right, bar drains toward the right edge),
  // so two HUDs side by side have full bars meeting in the middle.
  // opts.open = the effect id whose dropdown is open (draws that token as selected).
  function hud(s, f, opts) {
    opts = opts || {};
    var h = s.heroes[f.hero];
    var defId = s.pending ? s.pending.defenderId : null;
    var root = el('div', 'ssr-hud' + (opts.flip ? ' flip' : '') + (!f.alive ? ' is-out' : f.id === defId ? ' is-def' : f.id === s.activeId ? ' is-turn' : '') + (opts.you ? ' is-you' : ''));

    var plate = el('div', 'plate');
    var inner = el('div');
    var who = el('div', 'who');
    var sq = el('i'); sq.style.background = f.color || '#3ee6e0'; who.appendChild(sq);
    who.appendChild(el('span', 'nmx', 'P' + (opts.playerNo || '') + ' · ' + f.name.toUpperCase() + (opts.you ? ' (YOU)' : '') + (f.bot ? ' · BOT' : '') + (f.connected ? '' : ' · AWAY')));
    if (f.alive && f.id === defId) who.appendChild(el('span', 'tg d', '◆ DEFEND'));
    else if (f.alive && f.id === s.activeId) who.appendChild(el('span', 'tg', '▶ TURN'));
    inner.appendChild(who);
    inner.appendChild(el('div', 'hero', h.name.toUpperCase()));
    plate.appendChild(inner);
    root.appendChild(plate);

    var pct = Math.max(0, f.hp) / f.maxHp * 100;
    var hit = 0;
    if (s.result) s.result.hits.forEach(function (x) { if (x.targetId === f.id) hit = x.taken; });
    var bar = el('div', 'bar'); var bi = el('div');
    var fill = el('div', 'fill'); fill.style.width = pct + '%';
    fill.style.background = pct > 50 ? '#7ed98a' : pct > 25 ? '#ffd23d' : '#ff4d5e';
    var ghost = el('div', 'ghost'); ghost.style.width = Math.min(hit, f.maxHp - Math.max(0, f.hp)) / f.maxHp * 100 + '%';
    bi.appendChild(fill); bi.appendChild(ghost); bar.appendChild(bi);
    root.appendChild(bar);

    // Under the bar: BP, then tokens, then HP.
    var row = el('div', 'row');
    var bp = el('div', 'bp'); bp.appendChild(el('span', 'k', 'BP'));
    var pips = el('div', 'pips');
    for (var i = 0; i < 15; i++) pips.appendChild(el('span', i < f.cp ? 'on' : ''));
    bp.appendChild(pips); bp.appendChild(el('span', 'v', f.cp));
    row.appendChild(bp);

    var fx = el('div', 'fx');
    effects(s, f).forEach(function (e) {
      var b = el('button', 'eff k-' + e.kind + (e.empty ? ' empty' : '') + (opts.open === e.id ? ' sel' : ''));
      b.type = 'button';
      b.setAttribute('aria-label', e.name + (e.count > 1 ? ' ×' + e.count : '') + '. Show what it does');
      b.setAttribute('aria-expanded', opts.open === e.id ? 'true' : 'false');
      b.title = e.name;
      b.appendChild(el('div', 'g', e.glyph));
      if (!e.empty && (e.count > 1 || e.max > 1)) b.appendChild(el('span', 'ct', e.count));
      if (opts.onEffect) b.addEventListener('click', function (ev) { ev.stopPropagation(); opts.onEffect(f.id, e.id); });
      fx.appendChild(b);
    });
    fx.appendChild(el('span', 'cards', f.cards + (f.cards === 1 ? ' CARD' : ' CARDS')));
    row.appendChild(fx);

    var hp = el('div', 'hp', f.alive ? String(f.hp) : 'KO');
    hp.appendChild(el('small', '', ' / ' + f.maxHp));
    row.appendChild(hp);
    root.appendChild(row);
    return root;
  }

  // The dropdown under a HUD when a token is tapped: name, what it does,
  // whether it can be stolen, and when it's used. Then the rest of their tokens.
  function fxPanel(s, f, selId, onPick, onClose) {
    var list = effects(s, f);
    var sel = list.filter(function (e) { return e.id === selId; })[0] || list[0];
    var p = el('div', 'ssr-fxpanel');
    if (onClose) {
      var x = el('button', 'close', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Close');
      x.addEventListener('click', function (ev) { ev.stopPropagation(); onClose(); });
      p.appendChild(x);
    }
    if (sel) {
      var top = el('div', 'top');
      top.appendChild(el('div', 'big k-' + sel.kind + (sel.empty ? ' empty' : ''), sel.glyph));
      var t = el('div');
      var nm = el('div', 'nm', sel.name);
      var kd = el('span', 'kd', countLabel(sel));
      kd.style.color = sel.kind === 'tok' ? '#3ee6e0' : '#ff6b8b';
      nm.appendChild(kd);
      t.appendChild(nm);
      t.appendChild(facts(sel));
      top.appendChild(t);
      p.appendChild(top);
    }
    var others = list.filter(function (e) { return !sel || e.id !== sel.id; });
    if (others.length) {
      var l = el('div', 'list');
      l.appendChild(el('div', 'lab', f.name.toUpperCase() + "'S OTHER TOKENS · TAP ONE"));
      others.forEach(function (e) {
        var b = el('button', 'li' + (e.empty ? ' empty' : '')); b.type = 'button';
        b.appendChild(el('div', 'big k-' + e.kind + (e.empty ? ' empty' : ''), e.glyph));
        var t = el('div');
        var nm = el('div', 'nm2', e.name);
        var kd = el('span', 'kd', countLabel(e));
        kd.style.color = e.kind === 'tok' ? '#3ee6e0' : '#ff6b8b';
        nm.appendChild(kd);
        t.appendChild(nm);
        t.appendChild(el('div', 'tx2', e.text));
        b.appendChild(t);
        b.addEventListener('click', function (ev) { ev.stopPropagation(); onPick(e.id); });
        l.appendChild(b);
      });
      p.appendChild(l);
    }
    return p;
  }

  // Version tag at the bottom of every screen. Turns gold with a reload hint if any
  // piece (this page, the shared UI file, or the server) is out of date.
  var VERSION = '0.6';
  function versionTag(pageVersion) {
    var tag = document.getElementById('ver');
    if (!tag) return;
    tag.textContent = 'v' + pageVersion;
    fetch('/smash/version', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
      var ok = j.version === pageVersion && VERSION === pageVersion;
      tag.textContent = ok ? 'v' + pageVersion : 'v' + pageVersion + ' · server v' + j.version + ' · reload the page';
      tag.classList.toggle('old', !ok);
    }).catch(function () {});
  }

  window.SSR = { board: board, hud: hud, fxPanel: fxPanel, effects: effects, chip: chip, textOn: textOn, version: VERSION, versionTag: versionTag };
})();
