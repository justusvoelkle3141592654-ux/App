// touch.js — on-screen touch controls for phones/tablets.
// Left stick = move, right half drag = look, buttons: jump, sneak, sprint, break (hold), place/use, inventory, chat, pause, hotbar prev/next.
// Works by driving game.input / game.player directly and by dispatching synthetic mouse/keyboard events that main.js already handles.

export function isTouchDevice() {
  return ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
}

export function setupTouch(game) {
  if (!isTouchDevice()) return;
  const css = document.createElement('style');
  css.textContent = `
  html,body{touch-action:none;overscroll-behavior:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
  #tc{position:fixed;inset:0;z-index:20;pointer-events:none;display:none}
  #tc.on{display:block}
  #tc .zone{position:absolute;top:0;bottom:0;pointer-events:auto;touch-action:none}
  #tc .stickbase{position:absolute;width:132px;height:132px;border-radius:50%;background:rgba(255,255,255,.14);border:3px solid rgba(255,255,255,.35);display:none}
  #tc .stickknob{position:absolute;left:36px;top:36px;width:60px;height:60px;border-radius:50%;background:rgba(255,255,255,.45);border:3px solid rgba(255,255,255,.7)}
  #tc .btn{position:absolute;width:64px;height:64px;border-radius:12px;background:rgba(60,60,60,.55);border:3px solid rgba(255,255,255,.55);color:#fff;font:bold 15px monospace;display:flex;align-items:center;justify-content:center;pointer-events:auto;touch-action:none;text-shadow:1px 1px #000}
  #tc .btn.act{background:rgba(160,160,160,.65)}
  #tc .small{width:48px;height:48px;font-size:13px}
  `;
  document.head.appendChild(css);

  const root = document.createElement('div'); root.id = 'tc';
  document.body.appendChild(root);
  const inp = game.input;

  // ---- movement stick (left 40% of screen)
  const moveZone = document.createElement('div'); moveZone.className = 'zone'; moveZone.style.cssText = 'left:0;width:40%';
  const base = document.createElement('div'); base.className = 'stickbase';
  const knob = document.createElement('div'); knob.className = 'stickknob'; base.appendChild(knob);
  moveZone.appendChild(base); root.appendChild(moveZone);
  let moveId = null, mx0 = 0, my0 = 0;
  const setMove = (dx, dy) => {
    const R = 55, d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / R);
    const nx = dx / d * k, ny = dy / d * k;
    knob.style.transform = `translate(${nx * R * 0.8}px,${ny * R * 0.8}px)`;
    inp.forward = ny < -0.35; inp.back = ny > 0.35; inp.left = nx < -0.35; inp.right = nx > 0.35;
  };
  const stopMove = () => { moveId = null; base.style.display = 'none'; knob.style.transform = ''; inp.forward = inp.back = inp.left = inp.right = false; };
  moveZone.addEventListener('touchstart', (e) => {
    e.preventDefault(); game.audio?.unlock?.(); goFullscreen();
    if (moveId !== null) return;
    const t = e.changedTouches[0]; moveId = t.identifier; mx0 = t.clientX; my0 = t.clientY;
    base.style.left = (mx0 - 66) + 'px'; base.style.top = (my0 - 66) + 'px'; base.style.display = 'block'; setMove(0, 0);
  }, { passive: false });
  moveZone.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) if (t.identifier === moveId) setMove(t.clientX - mx0, t.clientY - my0);
  }, { passive: false });
  const endMove = (e) => { for (const t of e.changedTouches) if (t.identifier === moveId) stopMove(); };
  moveZone.addEventListener('touchend', endMove); moveZone.addEventListener('touchcancel', endMove);

  // ---- look zone (right 60%, below buttons via z-order: buttons added later)
  const lookZone = document.createElement('div'); lookZone.className = 'zone'; lookZone.style.cssText = 'right:0;width:60%';
  root.appendChild(lookZone);
  let lookId = null, lx = 0, ly = 0, ltStart = 0, lMoved = 0, holdTimer = null, holding = false;
  const fire = (type, button) => window.dispatchEvent(new MouseEvent(type, { button, bubbles: true }));
  const sens = () => { const s = game.settings.sensitivity; return 0.0042 * (s > 5 ? s / 100 : s); };
  lookZone.addEventListener('touchstart', (e) => {
    e.preventDefault(); game.audio?.unlock?.(); goFullscreen();
    if (lookId !== null) return;
    const t = e.changedTouches[0]; lookId = t.identifier; lx = t.clientX; ly = t.clientY; ltStart = performance.now(); lMoved = 0; holding = false;
    // long press = break block / attack (hold)
    holdTimer = setTimeout(() => { if (lookId !== null && lMoved < 14) { holding = true; fire('mousedown', 0); } }, 280);
  }, { passive: false });
  lookZone.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) if (t.identifier === lookId) {
      const dx = t.clientX - lx, dy = t.clientY - ly; lx = t.clientX; ly = t.clientY; lMoved += Math.abs(dx) + Math.abs(dy);
      const p = game.player; if (!p || !game.started || game.paused || game.dead) continue;
      p.yaw -= dx * sens(); p.pitch -= dy * sens();
      if (p.pitch > 1.5707) p.pitch = 1.5707; if (p.pitch < -1.5707) p.pitch = -1.5707;
    }
  }, { passive: false });
  const endLook = (e) => {
    for (const t of e.changedTouches) if (t.identifier === lookId) {
      clearTimeout(holdTimer);
      if (holding) fire('mouseup', 0);
      else if (lMoved < 14 && performance.now() - ltStart < 280) { fire('mousedown', 0); setTimeout(() => fire('mouseup', 0), 60); } // quick tap = single hit / click
      lookId = null; holding = false;
    }
  };
  lookZone.addEventListener('touchend', endLook); lookZone.addEventListener('touchcancel', endLook);

  // ---- buttons
  const key = (code, type) => window.dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true, cancelable: true }));
  function btn(label, css, onDown, onUp, small) {
    const b = document.createElement('div'); b.className = 'btn' + (small ? ' small' : ''); b.textContent = label; b.style.cssText = css;
    b.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); b.classList.add('act'); game.audio?.unlock?.(); onDown?.(); }, { passive: false });
    const up = (e) => { e.preventDefault(); e.stopPropagation(); b.classList.remove('act'); onUp?.(); };
    b.addEventListener('touchend', up, { passive: false }); b.addEventListener('touchcancel', up, { passive: false });
    root.appendChild(b); return b;
  }
  btn('JUMP', 'right:22px;bottom:96px;width:78px;height:78px', () => { inp.jump = true; key('Space', 'keydown'); }, () => { inp.jump = false; key('Space', 'keyup'); });
  btn('USE', 'right:112px;bottom:46px;width:70px;height:70px', () => fire('mousedown', 2), () => fire('mouseup', 2));
  btn('HIT', 'right:112px;bottom:128px;width:70px;height:70px', () => fire('mousedown', 0), () => fire('mouseup', 0));
  let sneak = false;
  const sb = btn('SNK', 'right:22px;bottom:186px', () => { sneak = !sneak; inp.sneak = sneak; sb.style.background = sneak ? 'rgba(160,160,160,.65)' : ''; }, null, true);
  btn('RUN', 'left:22px;bottom:170px', () => key('KeyR', 'keydown'), () => key('KeyR', 'keyup'), true);
  btn('INV', 'right:78px;top:12px', () => { key('KeyE', 'keydown'); key('KeyE', 'keyup'); }, null, true);
  btn('II', 'right:18px;top:12px', () => { key('Escape', 'keydown'); key('Escape', 'keyup'); }, null, true);
  btn('CMD', 'right:138px;top:12px', () => { key('KeyT', 'keydown'); key('KeyT', 'keyup'); }, null, true);
  btn('<', 'left:50%;margin-left:-190px;bottom:8px', () => cycle(-1), null, true);
  btn('>', 'left:50%;margin-left:142px;bottom:8px', () => cycle(1), null, true);
  const cycle = (d) => { const inv = game.inventory; if (inv) inv.selected = (inv.selected + d + 9) % 9; };

  // ---- fullscreen + landscape (needs a user gesture)
  let fsTried = false;
  function goFullscreen() {
    if (fsTried) return; fsTried = true;
    try { const el = document.documentElement; (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el); } catch (e) { /* */ }
    try { screen.orientation?.lock?.('landscape').catch(() => {}); } catch (e) { /* */ }
  }
  document.addEventListener('touchstart', goFullscreen, { once: true, passive: true });

  // ---- show only while playing without an open GUI
  const tick = () => {
    const on = game.started && !game.paused && !game.dead && !game.consoleOpen && !game.ui?.isOpen?.();
    root.classList.toggle('on', !!on);
    if (!on) { stopMove(); inp.jump = false; }
    requestAnimationFrame(tick);
  };
  tick();
  document.addEventListener('contextmenu', (e) => e.preventDefault());
}
