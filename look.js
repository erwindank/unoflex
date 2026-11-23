// ============================================================
// ¡CAMALEÓN! — NEW LOOK (the 7 ideas of the "UNO Fiesta New Look" mock-up,
// brought to ¡CAMALEÓN! with its own rainforest colours, 2026-11-23)
//
// Loaded BEFORE app.js. app.js asks these helpers for the card faces when they exist:
//   lookIconHTML(value)          — drawn centre picture (skip, reverse, wild pictures) or ''
//   lookCornerHTML(value, pos)   — small corner label / picture
//   lookWildCenterHTML(value)    — four-colour leaf + "+4" / "+2" or a picture
// Later steps add the table ring, seats, title screen and movement below.
// ============================================================

// ---- 1. Card pictures ----------------------------------------------------
// Every picture is drawn in the card's colour (currentColor) with a dark outline,
// so the same drawing works on all four colours and on the white leaf.
const LOOK_OUT = '#0c1f19';
const _S = `stroke="${LOOK_OUT}" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"`;
const LOOK_ICONS = {
  // ⊘ Salto: a ring with a bar through it
  skip: `<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="34" fill="none" stroke="${LOOK_OUT}" stroke-width="22"/><circle cx="50" cy="50" r="34" fill="none" stroke="currentColor" stroke-width="12"/><path d="M27 73 L73 27" stroke="${LOOK_OUT}" stroke-width="22" stroke-linecap="round"/><path d="M27 73 L73 27" stroke="currentColor" stroke-width="12" stroke-linecap="round"/></svg>`,
  // ⇄ Reversa: two arrows pointing opposite ways
  reverse: `<svg viewBox="0 0 100 100" aria-hidden="true"><g transform="rotate(-45 50 50)"><path d="M14 28 H56 V14 L84 33 L56 52 V38 H14 Z" fill="currentColor" ${_S}/><path d="M86 62 H44 V48 L16 67 L44 86 V72 H86 Z" fill="currentColor" ${_S}/></g></svg>`,
  // ⚡ Comodín Voltea Todos: a lightning bolt (every Power Card flips)
  wildFlip: `<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M58 6 L22 56 H46 L38 94 L78 40 H54 Z" fill="#c6f432" ${_S}/></svg>`,
  // 🎯 Comodín Diana: a target
  wildTarget2: `<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="38" fill="#E0322B" ${_S}/><circle cx="50" cy="50" r="25" fill="#fff" ${_S}/><circle cx="50" cy="50" r="11" fill="#E0322B" ${_S}/></svg>`
};
// a wild picture keeps its own colours; skip/reverse take the card's colour
const LOOK_WILD_PICS = ['wildFlip', 'wildTarget2'];

function lookIconHTML(value) {
  const svg = LOOK_ICONS[value];
  return svg ? `<span class="card-icon">${svg}</span>` : '';
}

function lookCornerHTML(value, pos) {
  const svg = LOOK_ICONS[value];
  if (svg) return `<span class="card-label ${pos} has-icon">${svg}</span>`;
  return `<span class="card-label ${pos}">${symbolOf(value)}</span>`;
}

function lookWildCenterHTML(value) {
  // the leaf keeps its four colours even after a colour was named (the ring shows that)
  const sub = value === 'wildTarget2' ? `<span class="wild-sub">+2</span>` : '';
  const inner = LOOK_WILD_PICS.includes(value) ? lookIconHTML(value) + sub
    : `<span class="card-label center">${symbolOf(value)}</span>`;
  return inner;
}

// ---- 2. Table: direction ring around the piles ----------------------------
// Called from renderStatus() in app.js on every render. Keeps one SVG ring inside
// .pile-area; the dashes march clockwise (direction 1) or the other way (-1).
let _lookDir = null;
function lookDirectionHTML(direction) {
  const area = document.querySelector('#screen-game .pile-area');
  if (area) {
    let ring = area.querySelector('.dir-ring');
    if (!ring) {
      ring = document.createElement('div');
      ring.className = 'dir-ring';
      ring.setAttribute('aria-hidden', 'true');
      ring.innerHTML = `<svg viewBox="0 0 100 100" preserveAspectRatio="none"><ellipse cx="50" cy="50" rx="48" ry="46" vector-effect="non-scaling-stroke"/></svg>
        <span class="dir-arrow dir-arrow-r"></span><span class="dir-arrow dir-arrow-l"></span>`;
      area.prepend(ring);
    }
    const ccw = direction !== 1;
    ring.classList.toggle('ccw', ccw);
    // a quick flash when a Reverse changes the direction
    if (_lookDir !== null && _lookDir !== direction) {
      ring.classList.remove('flip'); void ring.offsetWidth; ring.classList.add('flip');
    }
    _lookDir = direction;
  }
  return '';
}
