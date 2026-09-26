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
  var STATUS = {
    burn: { name: 'Burn', text: 'At your upkeep take 2 damage per stack, then remove.' },
    knockdown: { name: 'Knocked Down', text: 'Your next offensive roll gets 2 rolls instead of 3.' },
    frozen: { name: 'Frozen', text: 'Your next defense rolls 1 fewer die.' },
    shield: { name: 'Shield', text: 'Prevents this much damage from the next attack this turn.' },
    sealed: { name: 'Ultimate sealed', text: "Can't use your Ultimate until the end of your next turn." }
  };
  function glyph(name) {
    var w = name.replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean);
    return (w.length > 1 ? w[0][0] + w[1][0] : name.slice(0, 2)).toUpperCase();
  }
  function effects(s, f) {
    var out = [];
    f.tokens.forEach(function (t) {
      var info = s.tokenInfo[t.id];
      out.push({ id: t.id, kind: 'tok', name: info.name, text: info.text, count: t.n, max: info.max, glyph: glyph(info.name) });
    });
    if (f.status.burn) out.push({ id: 'burn', kind: 'sts', name: STATUS.burn.name, text: STATUS.burn.text, count: f.status.burn });
    if (f.status.knockdown) out.push({ id: 'knockdown', kind: 'sts', name: STATUS.knockdown.name, text: STATUS.knockdown.text, count: 1 });
    if (f.status.frozen) out.push({ id: 'frozen', kind: 'sts', name: STATUS.frozen.name, text: STATUS.frozen.text, count: 1 });
    if (f.shield) out.push({ id: 'shield', kind: 'sts', name: STATUS.shield.name, text: STATUS.shield.text, count: f.shield });
    if (f.sealed) out.push({ id: 'sealed', kind: 'sts', name: STATUS.sealed.name, text: STATUS.sealed.text, count: 1 });
    out.forEach(function (e) { if (!e.glyph) e.glyph = glyph(e.name); });
    return out;
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
  function hud(s, f, opts) {
    opts = opts || {};
    var h = s.heroes[f.hero];
    var defId = s.pending ? s.pending.defenderId : null;
    var root = el('div', 'ssr-hud' + (!f.alive ? ' is-out' : f.id === defId ? ' is-def' : f.id === s.activeId ? ' is-turn' : ''));
    var plate = el('div', 'plate');
    var inner = el('div');
    var who = el('div', 'who');
    var sq = el('i'); sq.style.background = f.color || '#3ee6e0'; who.appendChild(sq);
    who.appendChild(document.createTextNode('P' + (opts.playerNo || '') + ' · ' + f.name.toUpperCase() + (opts.you ? ' (YOU)' : '') + (f.bot ? ' · BOT' : '') + (f.connected ? '' : ' · AWAY')));
    if (f.alive && f.id === defId) who.appendChild(el('span', 'tg d', '◆ DEFENDING'));
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
    fill.style.background = pct > 50 ? '#5ee07a' : pct > 25 ? '#ffd23d' : '#ff4d5e';
    var ghost = el('div', 'ghost'); ghost.style.width = Math.min(hit, f.maxHp - Math.max(0, f.hp)) / f.maxHp * 100 + '%';
    bi.appendChild(fill); bi.appendChild(ghost); bar.appendChild(bi);
    root.appendChild(bar);

    var row = el('div', 'row');
    var bp = el('div', 'bp'); bp.appendChild(document.createTextNode('BP'));
    var pips = el('div', 'pips');
    for (var i = 0; i < 15; i++) pips.appendChild(el('span', i < f.cp ? 'on' : ''));
    bp.appendChild(pips); bp.appendChild(document.createTextNode(f.cp));
    row.appendChild(bp);
    var hp = el('div', 'hp', f.alive ? String(f.hp) : 'KO');
    hp.appendChild(el('small', '', ' / ' + f.maxHp));
    row.appendChild(hp);
    root.appendChild(row);

    var fx = el('div', 'fx');
    var list = effects(s, f);
    if (!list.length) fx.appendChild(el('span', 'none', 'NO TOKENS'));
    list.forEach(function (e) {
      var b = el('button', 'eff ' + e.kind);
      b.type = 'button';
      b.setAttribute('aria-label', e.name + (e.count > 1 ? ' ×' + e.count : ''));
      b.title = e.name + ': ' + e.text;
      b.appendChild(el('div', 'g', e.glyph));
      if (e.count > 1 || e.max > 1) b.appendChild(el('span', 'ct', e.count));
      if (opts.onEffect) b.addEventListener('click', function (ev) { ev.stopPropagation(); opts.onEffect(f.id, e.id); });
      else b.tabIndex = -1;
      fx.appendChild(b);
    });
    fx.appendChild(el('span', 'none', f.cards + ' CARDS'));
    root.appendChild(fx);
    return root;
  }

  function fxPanel(s, f, selId, onPick, onClose) {
    var list = effects(s, f);
    var sel = list.filter(function (e) { return e.id === selId; })[0] || list[0];
    var p = el('div', 'ssr-fxpanel');
    if (sel) {
      var top = el('div', 'top');
      top.appendChild(el('div', 'big ' + sel.kind, sel.glyph));
      var t = el('div');
      var nm = el('div', 'nm', sel.name);
      t.appendChild(nm);
      var kd = el('div', 'kd', (sel.kind === 'tok' ? 'TOKEN' : 'STATUS') + ' · ' + (sel.max > 1 ? sel.count + ' / ' + sel.max : '×' + sel.count));
      kd.style.color = sel.kind === 'tok' ? '#3ee6e0' : '#ff6b8b';
      t.appendChild(kd);
      t.appendChild(el('div', 'tx', sel.text));
      top.appendChild(t);
      p.appendChild(top);
    }
    var l = el('div', 'list');
    l.appendChild(el('div', 'lab', 'ALL OF ' + f.name.toUpperCase() + "'S EFFECTS"));
    if (!list.length) l.appendChild(el('div', 'tx', 'Nothing right now.'));
    list.forEach(function (e) {
      if (sel && e.id === sel.id) return;
      var b = el('button', 'li'); b.type = 'button';
      b.appendChild(el('div', 'big ' + e.kind, e.glyph));
      var t = el('div');
      t.appendChild(el('div', 'nm', e.name)); t.lastChild.style.fontSize = '1.05em';
      t.appendChild(el('div', 'tx', e.text)); t.lastChild.style.fontSize = '.95em';
      b.appendChild(t);
      b.addEventListener('click', function () { onPick(e.id); });
      l.appendChild(b);
    });
    p.appendChild(l);
    return p;
  }

  window.SSR = { board: board, hud: hud, fxPanel: fxPanel, effects: effects, chip: chip, textOn: textOn };
})();
