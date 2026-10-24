/*
 * WHO DAT — the 24 original characters.
 * Every portrait is drawn from the attributes below (no image files, no outside artwork), so a character's
 * picture always matches its data. Attributes are for drawing only: the game NEVER uses them to knock
 * characters down — players do that themselves.
 *
 * To restyle someone, change their row. Options for each field are listed above the table.
 */

const SKIN = { s1: "#f6d7c3", s2: "#e9b993", s3: "#cf9568", s4: "#a8693f", s5: "#7b4a29", s6: "#4f2f1b" };
const HAIR = { black: "#1b1515", brown: "#5b3820", blonde: "#e6c069", red: "#b8462a", gray: "#a9a9b2", white: "#ededf0", pink: "#ff6fae", blue: "#3f74e6" };
const EYES = { brown: "#4a2b16", blue: "#3a7bd5", green: "#3d9a4e", hazel: "#8c6a2a", gray: "#78838e" };
const BG = ["#ff2a3d", "#1fb6ff", "#ffc93c", "#8b5cf6", "#22c55e", "#ff7a1a", "#ec4899", "#14b8a6"];

/*
 * hair:   fade | slick | buzz | bald | afro | long | longcurly | bob | bun | ponytail | locs | curly | mohawk
 * face:   none | beard | goatee | mustache | stubble
 * glasses: none | round | square | shades
 * hat:    none | cap | beanie | bucket | headband | cowboy
 * extra:  none | earrings | chain | stud (nose stud)
 * top:    tee | hoodie | collar | jersey | jacket | turtleneck
 */
//            name        skin  hair         hairColor eyes     face       glasses   hat         extra       top          topColor
const ROWS = [
  ["Dre",      "s5", "fade",      "black",  "brown", "beard",    "none",   "cap",      "chain",    "hoodie",    "#e11d2e"],
  ["Keisha",   "s4", "afro",      "black",  "brown", "none",     "round",  "none",     "earrings", "tee",       "#facc15"],
  ["Marcus",   "s6", "bald",      "black",  "brown", "goatee",   "shades", "none",     "none",     "jacket",    "#1f2937"],
  ["Tasha",    "s3", "long",      "red",    "green", "none",     "none",   "beanie",   "stud",     "turtleneck","#0ea5e9"],
  ["Big Mike", "s2", "buzz",      "brown",  "blue",  "beard",    "none",   "bucket",   "none",     "jersey",    "#16a34a"],
  ["Jasmine",  "s5", "bun",       "black",  "hazel", "none",     "square", "none",     "earrings", "collar",    "#f97316"],
  ["Tony",     "s2", "slick",     "black",  "brown", "mustache", "none",   "none",     "chain",    "jacket",    "#7c2d12"],
  ["Aaliyah",  "s4", "locs",      "black",  "brown", "none",     "none",   "headband", "earrings", "hoodie",    "#a855f7"],
  ["Carlos",   "s3", "curly",     "brown",  "brown", "stubble",  "round",  "none",     "none",     "tee",       "#2563eb"],
  ["Mei",      "s1", "bob",       "black",  "brown", "none",     "none",   "cap",      "none",     "hoodie",    "#f472b6"],
  ["Jamal",    "s6", "locs",      "black",  "brown", "beard",    "none",   "none",     "chain",    "jersey",    "#7c3aed"],
  ["Priya",    "s3", "long",      "black",  "brown", "none",     "round",  "none",     "stud",     "collar",    "#10b981"],
  ["Ricky",    "s1", "mohawk",    "pink",   "blue",  "none",     "shades", "none",     "earrings", "jacket",    "#111827"],
  ["Nia",      "s5", "ponytail",  "blonde", "hazel", "none",     "none",   "cap",      "none",     "tee",       "#ef4444"],
  ["Omar",     "s4", "fade",      "black",  "brown", "beard",    "square", "none",     "none",     "turtleneck","#334155"],
  ["Bree",     "s1", "long",      "blonde", "blue",  "none",     "none",   "none",     "earrings", "tee",       "#22d3ee"],
  ["Theo",     "s2", "curly",     "red",    "green", "none",     "none",   "beanie",   "none",     "hoodie",    "#65a30d"],
  ["Lola",     "s3", "bob",       "blue",   "brown", "none",     "shades", "none",     "earrings", "jersey",    "#eab308"],
  ["Kofi",     "s6", "buzz",      "black",  "brown", "mustache", "none",   "bucket",   "none",     "collar",    "#fb923c"],
  ["Sasha",    "s2", "bun",       "gray",   "gray",  "none",     "round",  "none",     "chain",    "turtleneck","#be123c"],
  ["Vince",    "s1", "bald",      "gray",   "blue",  "beard",    "none",   "cowboy",   "none",     "jacket",    "#92400e"],
  ["Imani",    "s5", "afro",      "brown",  "brown", "none",     "none",   "none",     "stud",     "jacket",    "#0f766e"],
  ["Hank",     "s2", "slick",     "gray",   "gray",  "mustache", "square", "none",     "none",     "collar",    "#64748b"],
  ["Rosa",     "s4", "longcurly", "brown",  "hazel", "none",     "none",   "headband", "earrings", "tee",       "#d946ef"],
];

export const CHARACTERS = ROWS.map((r, id) => ({
  id, name: r[0], skin: r[1], hair: r[2], hairColor: r[3], eyes: r[4], face: r[5], glasses: r[6], hat: r[7], extra: r[8], top: r[9], topColor: r[10],
  bg: BG[id % BG.length],
}));

/* ---------- drawing ---------- */
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.max(0, Math.min(255, Math.round(c + amt * (amt < 0 ? c : 255 - c))));
  return "#" + [f(n >> 16), f((n >> 8) & 255), f(n & 255)].map((c) => c.toString(16).padStart(2, "0")).join("");
}
const P = (d, fill, extra = "") => `<path d="${d}" fill="${fill}"${extra}/>`;
const C = (cx, cy, r, fill, extra = "") => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"${extra}/>`;

function hairBack(c, col) {
  switch (c.hair) {
    case "afro": return C(60, 52, 39, col) + C(30, 66, 12, col) + C(90, 66, 12, col);
    case "long": return P("M31 64C28 30 45 23 60 23C75 23 92 30 89 64L93 122H27Z", col);
    case "longcurly": return P("M31 64C28 30 45 23 60 23C75 23 92 30 89 64L93 122H27Z", col) +
      [[28, 80], [26, 100], [30, 118], [92, 80], [94, 100], [90, 118]].map(([x, y]) => C(x, y, 9, col)).join("");
    case "bob": return P("M31 66C29 33 45 26 60 26C75 26 91 33 89 66L90 94H30Z", col);
    case "bun": return C(60, 22, 12, col);
    case "ponytail": return P("M78 36C96 40 100 70 96 104C94 112 86 112 86 104C88 80 86 58 74 46Z", col);
    case "locs": return [30, 37, 44, 76, 83, 90].map((x) => `<rect x="${x - 4}" y="44" width="8" height="${66 + (x % 3) * 6}" rx="4" fill="${col}"/>`).join("");
    default: return "";
  }
}

function hairFront(c, col) {
  const dome = "M35 58C34 37 47 29 60 29C73 29 86 37 85 58C79 46 70 42 60 42C50 42 41 46 35 58Z";
  switch (c.hair) {
    case "fade": return P(dome, col) + P("M35 58C35 50 37 46 39 44L37 62Z", shade(col, .25), ' opacity=".7"') + P("M85 58C85 50 83 46 81 44L83 62Z", shade(col, .25), ' opacity=".7"');
    case "slick": return P("M34 60C32 34 47 27 62 28C76 29 87 38 86 60C83 46 74 40 66 40C58 40 46 42 34 60Z", col) +
      `<path d="M44 38C54 32 68 32 78 38" stroke="${shade(col, .35)}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
    case "buzz": return P("M36 56C37 38 49 33 60 33C71 33 83 38 84 56C78 45 70 41 60 41C50 41 42 45 36 56Z", col, ' opacity=".9"');
    case "bald": return `<ellipse cx="51" cy="42" rx="8" ry="4" fill="#fff" opacity=".22" transform="rotate(-20 51 42)"/>`;
    case "afro": return P("M35 58C34 40 46 31 60 31C74 31 86 40 85 58C78 48 70 45 60 45C50 45 42 48 35 58Z", col);
    case "long": case "longcurly":
      return P("M35 60C34 36 47 28 60 28C73 28 86 36 85 60C80 44 66 40 56 44C48 47 40 52 35 60Z", col) +
        P("M35 58L33 116H41L39 64Z", col) + P("M85 58L87 116H79L81 64Z", col);
    case "bob": return P("M35 54C35 36 47 29 60 29C73 29 85 36 85 54Z", col) + P("M35 54L33 92H40L38 60Z", col) + P("M85 54L87 92H80L82 60Z", col);
    case "bun": case "ponytail": return P("M35 58C34 37 47 30 60 30C73 30 86 37 85 58C80 46 70 41 60 41C50 41 40 46 35 58Z", col);
    case "locs": return P(dome, col) + [42, 50, 58, 66, 74].map((x) => `<path d="M${x} 33V${46 - Math.abs(60 - x) / 4}" stroke="${shade(col, .3)}" stroke-width="1.6"/>`).join("");
    case "curly": return [[38, 50], [42, 40], [50, 33], [60, 30], [70, 33], [78, 40], [82, 50], [48, 42], [60, 39], [72, 42]].map(([x, y]) => C(x, y, 8, col)).join("");
    case "mohawk": return P(dome, col, ' opacity=".28"') + P("M53 44L52 26L56 30L58 14L62 26L66 16L67 30L69 28L67 44Z", col);
    default: return "";
  }
}

function top(c) {
  const col = c.topColor, dk = shade(col, -.3), lt = shade(col, .25);
  let s = P("M8 140C10 116 30 104 60 104C90 104 110 116 112 140Z", col);
  switch (c.top) {
    case "tee": s += P("M47 104Q60 118 73 104Z", SKIN[c.skin]) + `<path d="M47 104Q60 118 73 104" stroke="${dk}" stroke-width="2.5" fill="none"/>`; break;
    case "hoodie": s += P("M36 108Q60 90 84 108Q60 124 36 108Z", dk) + `<path d="M54 112V128M66 112V128" stroke="${lt}" stroke-width="2" stroke-linecap="round"/>`; break;
    case "collar": s += P("M48 104L60 120L52 124L42 108Z", "#fff") + P("M72 104L60 120L68 124L78 108Z", "#fff") + C(60, 128, 1.6, dk) + C(60, 136, 1.6, dk); break;
    case "jersey": s += P("M50 104L60 116L70 104Z", SKIN[c.skin]) + `<path d="M50 104L60 116L70 104" stroke="#fff" stroke-width="3" fill="none"/>` +
      `<text x="60" y="137" text-anchor="middle" font-family="Anton, Impact, sans-serif" font-size="16" fill="#fff">${c.id + 1}</text>`; break;
    case "jacket": s += P("M50 104L60 140L70 104Z", "#f4f4f5") + P("M46 104L58 140H50L38 110Z", dk) + P("M74 104L62 140H70L82 110Z", dk); break;
    case "turtleneck": s += `<rect x="49" y="90" width="22" height="18" rx="6" fill="${col}"/>` + `<path d="M51 95H69M51 100H69" stroke="${dk}" stroke-width="1.4"/>`; break;
  }
  return s;
}

function face(c) {
  const skin = SKIN[c.skin], dk = shade(skin, -.18), hcol = HAIR[c.hairColor], eye = EYES[c.eyes];
  const browCol = c.hair === "bald" && c.hairColor !== "gray" ? shade(skin, -.45) : shade(hcol, c.hairColor === "white" ? -.2 : -.05);
  let s = "";
  s += C(35, 66, 5.5, dk) + C(85, 66, 5.5, dk);                                // ears
  s += `<ellipse cx="60" cy="64" rx="25" ry="30" fill="${skin}"/>`;              // head
  s += `<ellipse cx="45" cy="74" rx="4.5" ry="2.6" fill="#ff7a8a" opacity=".22"/><ellipse cx="75" cy="74" rx="4.5" ry="2.6" fill="#ff7a8a" opacity=".22"/>`;
  if (c.glasses !== "shades") {
    for (const x of [50, 70]) s += `<ellipse cx="${x}" cy="63" rx="5" ry="4" fill="#fff"/>` + C(x, 63.4, 3, eye) + C(x, 63.4, 1.4, "#0b0b0b") + C(x + 1, 62.4, .8, "#fff");
  }
  s += `<path d="M44 55.5Q50 52.5 56 55M64 55Q70 52.5 76 55.5" stroke="${browCol}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
  s += `<path d="M60 64Q57 72 59 73.5Q61 74.4 63 73" stroke="${shade(skin, -.3)}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`;
  return s;
}

function facialHair(c) {
  const col = HAIR[c.hairColor === "pink" || c.hairColor === "blue" ? "black" : c.hairColor];
  const beard = "M35 64C35 92 47 101 60 101C73 101 85 92 85 64C82 80 74 87 60 87C46 87 38 80 35 64Z";
  const stache = "M50 79Q55 74 60 77Q65 74 70 79Q65 81 60 79.6Q55 81 50 79Z";
  switch (c.face) {
    case "beard": return P(beard, col) + P(stache, col);
    case "goatee": return P("M53 87Q60 99 67 87Q60 90 53 87Z", col) + P(stache, col);
    case "mustache": return P(stache, col);
    case "stubble": return P(beard, col, ' opacity=".28"');
    default: return "";
  }
}

function mouth(c) {
  const col = c.face === "beard" ? "#f3d2c2" : "#7a2630";
  return `<path d="M52 82Q60 88 68 82" stroke="${col}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
}

function glasses(c) {
  const frame = "#111";
  switch (c.glasses) {
    case "round": return `<g fill="none" stroke="${frame}" stroke-width="2"><circle cx="50" cy="63" r="7"/><circle cx="70" cy="63" r="7"/><path d="M57 62Q60 60 63 62M43 62L36 60M77 62L84 60"/></g>`;
    case "square": return `<g fill="none" stroke="${frame}" stroke-width="2.2"><rect x="42" y="57" width="16" height="12" rx="2"/><rect x="62" y="57" width="16" height="12" rx="2"/><path d="M58 62H62M42 61L36 59M78 61L84 59"/></g>`;
    case "shades": return `<g><rect x="41" y="57" width="18" height="12" rx="4" fill="#0b0b10"/><rect x="61" y="57" width="18" height="12" rx="4" fill="#0b0b10"/><path d="M59 61H61M41 60L35 58M79 60L85 58" stroke="#0b0b10" stroke-width="2.4"/><path d="M44 60L49 60M64 60L69 60" stroke="#fff" stroke-width="1.6" opacity=".5" stroke-linecap="round"/></g>`;
    default: return "";
  }
}

function hat(c) {
  const col = c.id % 2 ? "#111827" : "#f8fafc";
  switch (c.hat) {
    case "cap": { const k = c.id === 0 ? "#e11d2e" : c.id === 9 ? "#2563eb" : "#facc15";
      return P("M33 51C33 28 47 21 60 21C73 21 87 28 87 51Z", k) + P("M30 50Q60 43 94 51Q98 56 88 57Q60 51 32 56Z", shade(k, -.3)) + C(60, 22, 2.4, shade(k, -.3)); }
    case "beanie": { const k = c.id === 3 ? "#f59e0b" : "#16a34a";
      return P("M33 54C33 26 47 18 60 18C73 18 87 26 87 54Z", k) + `<rect x="31" y="46" width="58" height="11" rx="4" fill="${shade(k, -.25)}"/>` + C(60, 15, 6, "#fff"); }
    case "bucket": return P("M38 46C40 26 50 22 60 22C70 22 80 26 82 46Z", col === "#f8fafc" ? "#d6c7a1" : "#3f4a3a") + P("M24 54L38 42H82L96 54Z", col === "#f8fafc" ? "#bfae86" : "#2f382b");
    case "headband": return `<rect x="34" y="42" width="52" height="7" rx="3" fill="${c.id === 7 ? "#facc15" : "#22d3ee"}"/>`;
    case "cowboy": return P("M40 42C40 18 50 13 60 19C70 13 80 18 80 42Z", "#8b5a2b") + `<rect x="40" y="35" width="40" height="5" fill="#3b2412"/>` + P("M12 46Q60 30 108 46Q102 54 60 47Q18 54 12 46Z", "#a0682f");
    default: return "";
  }
}

function extra(c) {
  switch (c.extra) {
    case "earrings": return C(35, 74, 2.6, "#fbbf24") + C(85, 74, 2.6, "#fbbf24");
    case "chain": return `<path d="M43 106Q60 126 77 106" stroke="#fbbf24" stroke-width="2.6" fill="none"/>` + C(60, 120, 3.4, "#fbbf24");
    case "stud": return C(64.6, 72.6, 1.5, "#e5e7eb");
    default: return "";
  }
}

const cache = new Map();
/** Full SVG markup for a character (built only from the trusted table above). */
export function portraitSVG(id) {
  if (cache.has(id)) return cache.get(id);
  const c = CHARACTERS[id];
  const hcol = HAIR[c.hairColor];
  const svg =
    `<svg viewBox="0 0 120 140" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">` +
    `<rect width="120" height="140" fill="${c.bg}"/>` +
    `<g opacity=".18" fill="#fff">${[0, 1, 2, 3, 4, 5].map((i) => C(10 + i * 22, 14 + (i % 2) * 8, 2.2, "#fff")).join("")}</g>` +
    hairBack(c, hcol) + top(c) +
    `<rect x="51" y="86" width="18" height="20" fill="${shade(SKIN[c.skin], -.12)}"/>` +
    (c.top === "turtleneck" ? `<rect x="49" y="92" width="22" height="16" rx="6" fill="${c.topColor}"/><path d="M51 97H69M51 102H69" stroke="${shade(c.topColor, -.3)}" stroke-width="1.4"/>` : "") +
    (c.top === "hoodie" ? P("M36 108Q60 90 84 108Q60 124 36 108Z", shade(c.topColor, -.3)) + `<path d="M54 112V128M66 112V128" stroke="${shade(c.topColor, .25)}" stroke-width="2" stroke-linecap="round"/>` : "") +
    (c.top === "collar" ? P("M48 104L60 120L52 124L42 108Z", "#fff") + P("M72 104L60 120L68 124L78 108Z", "#fff") : "") +
    face(c) + facialHair(c) + mouth(c) + hairFront(c, hcol) + glasses(c) + hat(c) + extra(c) +
    `</svg>`;
  cache.set(id, svg);
  return svg;
}
