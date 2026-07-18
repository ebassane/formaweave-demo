// FORMAWEAVE web demo — loads the fw-wasm kernel module (no bindgen, no
// imports), renders the JSON scene as SVG, and runs the LIVE cloth
// simulation (fw-sim + fw-avatar) on a canvas. Relative paths only.

const PARAMS = [
  ["chest", "obseg prsi", 700, 1400, 1000],
  ["waist", "obseg pasu", 600, 1300, 900],
  ["torso", "dolžina trupa", 500, 900, 700],
  ["shoulder", "širina ramen", 340, 560, 460],
  ["neck", "širina vratu", 120, 240, 180],
  ["armhole", "globina rokavne odprtine", 180, 320, 250],
  ["stretch", "razteg pletenine (0/1/2)", 0, 2, 1],
  ["strip", "širina role", 800, 2200, 1600],
];

const controls = document.getElementById("controls");
const state = {};
let fabricSel = null; // material-DB izbirnik (napolnjen po nalaganju wasm)
for (const [key, label, min, max, val] of PARAMS) {
  state[key] = val;
  const row = document.createElement("label");
  row.innerHTML = `<span>${label}</span><input type="range" min="${min}" max="${max}" value="${val}" step="1"><output>${val}</output>`;
  const input = row.querySelector("input");
  const out = row.querySelector("output");
  input.addEventListener("input", () => {
    state[key] = Number(input.value);
    out.value = input.value;
    if (key === "stretch" && fabricSel) {
      // Ročni razred izklopi izbrani material (razred spet vodi).
      state.fabric = -1;
      fabricSel.value = "-1";
    }
    if (key in DOC_IDX) docEvent(key);
    render();
    renderDerived();
    initSim();
  });
  controls.append(row);
}

const wasmBytes = await fetch("fw_wasm.wasm").then((r) => r.arrayBuffer());
const { instance } = await WebAssembly.instantiate(wasmBytes, {});
const ex = instance.exports;

// ---- Material DB (I143): imenovana blaga iz jedra --------------------------
// Izbran material vodi razteg + upogib + trenje simulacije; njegov krojni
// RAZRED sinhronizira drsnik (kroji in fizika ostanejo usklajeni).
state.fabric = -1; // -1 = razred z drsnika
{
  const len = ex.fabrics_json();
  const ptr = Number(ex.demo_ptr());
  const fabrics = JSON.parse(
    new TextDecoder().decode(new Uint8Array(ex.memory.buffer.slice(ptr, ptr + len))),
  );
  const row = document.createElement("label");
  row.innerHTML = `<span>material (baza)</span>`;
  fabricSel = document.createElement("select");
  fabricSel.innerHTML =
    `<option value="-1">&mdash; po razredu z drsnika &mdash;</option>` +
    fabrics
      .map((f) => `<option value="${f.i}">${f.name} (${f.kind})</option>`)
      .join("");
  fabricSel.addEventListener("change", () => {
    state.fabric = Number(fabricSel.value);
    if (state.fabric >= 0) {
      const f = fabrics[state.fabric];
      state.stretch = f.cls;
      const srow = [...controls.querySelectorAll("label")].find((l) =>
        l.textContent.includes("razteg"),
      );
      const sin = srow && srow.querySelector("input");
      if (sin) {
        sin.value = String(f.cls);
        srow.querySelector("output").value = String(f.cls);
      }
      render();
      renderDerived();
    }
    initSim();
  });
  row.append(fabricSel);
  controls.append(row);
}

// ---- Dokument resnice: drsniki mer so op-log dogodki ----------------------
const DOC_IDX = { chest: 0, waist: 1, torso: 2, shoulder: 3, neck: 4, armhole: 5 };

function docEvent(key) {
  const h = BigInt.asUintN(64, ex.doc_set(DOC_IDX[key], state[key]));
  document.getElementById("docstat").innerHTML =
    `dokument: <b>${ex.doc_op_count()}</b> op · hash <code>${h.toString(16).padStart(16, "0")}</code>`;
}

document.getElementById("dl-dxf").addEventListener("click", () => {
  const len = ex.dxf_build(state.stretch);
  const ptr = Number(ex.demo_ptr());
  const bytes = new Uint8Array(ex.memory.buffer, ptr, Math.abs(len)).slice();
  if (len < 0) {
    alert("DXF: " + new TextDecoder().decode(bytes));
    return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([bytes], { type: "application/dxf" }));
  a.download = "formaweave-demo.dxf";
  a.click();
  URL.revokeObjectURL(a.href);
});

function scene() {
  const len = ex.demo_build(
    state.chest, state.waist, state.torso, state.shoulder, state.neck,
    state.armhole, state.stretch, state.strip, 5.0,
  );
  const ptr = Number(ex.demo_ptr());
  const bytes = new Uint8Array(ex.memory.buffer, ptr, len);
  return JSON.parse(new TextDecoder().decode(bytes));
}

const svgNS = "http://www.w3.org/2000/svg";
function poly(el, pts, stroke, dash = null, fill = "none") {
  const p = document.createElementNS(svgNS, "polygon");
  p.setAttribute("points", pts.map(([x, y]) => `${x},${-y}`).join(" "));
  p.setAttribute("fill", fill);
  p.setAttribute("stroke", stroke);
  p.setAttribute("stroke-width", "3");
  if (dash) p.setAttribute("stroke-dasharray", dash);
  el.append(p);
}
function line(el, [x1, y1], [x2, y2], stroke, dash = null) {
  const l = document.createElementNS(svgNS, "line");
  l.setAttribute("x1", x1); l.setAttribute("y1", -y1);
  l.setAttribute("x2", x2); l.setAttribute("y2", -y2);
  l.setAttribute("stroke", stroke);
  l.setAttribute("stroke-width", "3");
  if (dash) l.setAttribute("stroke-dasharray", dash);
  el.append(l);
}
function notchMark(el, [x, y]) {
  const c = document.createElementNS(svgNS, "circle");
  c.setAttribute("cx", x); c.setAttribute("cy", -y);
  c.setAttribute("r", "6"); c.setAttribute("fill", "orange");
  el.append(c);
}
function fitView(el, pad = 30) {
  const bb = el.getBBox();
  el.setAttribute("viewBox", `${bb.x - pad} ${bb.y - pad} ${bb.width + 2 * pad} ${bb.height + 2 * pad}`);
}

function render() {
  const s = scene();
  const stats = document.getElementById("stats");
  const panels = document.getElementById("panels");
  const marker = document.getElementById("marker");
  panels.replaceChildren();
  marker.replaceChildren();

  if (!s.ok) {
    stats.innerHTML = `<span class="err">Napaka: ${s.error}</span>`;
    return;
  }

  // Complete garment laid out side by side: front, back, sleeve, skirt.
  let dx = 0;
  for (const p of [s.front, s.back, s.sleeve, s.skirt]) {
    const xs = p.cut.map(([x]) => x);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const off = dx - minX;
    const sh = (pts) => pts.map(([x, y]) => [x + off, y]);
    poly(panels, sh(p.cut), "tomato", "8 6");
    poly(panels, sh(p.sew), "steelblue");
    if (p.grain) line(panels, sh([p.grain[0]])[0], sh([p.grain[1]])[0], "green");
    if (p.notch) for (const nn of p.notch) notchMark(panels, sh([nn])[0]);
    if (p.dart) {
      const d = p.dart;
      line(panels, sh([d.a])[0], sh([d.apex])[0], "purple");
      line(panels, sh([d.b])[0], sh([d.apex])[0], "purple");
    }
    dx += (maxX - minX) + 70;
  }
  fitView(panels);

  // Marker: strip outline + placed cut polygons.
  const stripPoly = [
    [0, 0], [s.nest.strip_w, 0],
    [s.nest.strip_w, s.nest.marker_len], [0, s.nest.marker_len],
  ];
  poly(marker, stripPoly, "gray", "4 6");
  for (const pl of s.nest.placements) poly(marker, pl.poly, "tomato", null, "#ff634722");
  fitView(marker);

  stats.innerHTML =
    `Marker: <b>${(s.nest.marker_len / 10).toFixed(1)} cm</b> · ` +
    `utilizacija (v0 placeholder): <b>${(s.nest.utilization * 100).toFixed(1)} %</b> · ` +
    `true-shape verifikacija: <b>${s.nest.verified ? "OK" : "NI OK"}</b>`;

  const spec = document.getElementById("specstat");
  if (spec && s.spec) {
    spec.innerHTML =
      `Končne mere oblačila (M): prsi <b>${s.spec.chest} mm</b> · ` +
      `dolžina <b>${s.spec.length} mm</b> · rokav <b>${s.spec.sleeve} mm</b> · ` +
      `rokavna odprtina <b>${s.spec.armhole} mm</b>`;
  }
}

// ---- Derived block: 3D telo → šivni rez → razgrnitev ----------------------
let aspect = 1.35;
const aspectInput = document.getElementById("aspect");
aspectInput.addEventListener("input", () => {
  aspect = Number(aspectInput.value) / 100;
  document.getElementById("aspectout").value = aspect.toFixed(2);
  renderDerived();
});

function renderDerived() {
  const len = ex.derived_build(
    state.chest, state.waist, state.torso, state.shoulder, state.neck,
    state.armhole, aspect,
  );
  const ptr = Number(ex.demo_ptr());
  const d = JSON.parse(new TextDecoder().decode(new Uint8Array(ex.memory.buffer, ptr, len)));
  const svg = document.getElementById("derived");
  const stat = document.getElementById("derivedstat");
  svg.replaceChildren();
  if (!d.ok) {
    stat.innerHTML = `<span class="err">${d.error}</span>`;
    return;
  }
  poly(svg, d.outline, "darkorange", null, "#ff8c0018");
  fitView(svg);
  stat.innerHTML =
    `pas: <b>${d.hem.toFixed(0)}</b> mm · prsi: <b>${d.top.toFixed(0)}</b> mm · ` +
    `šiv: <b>${d.seam.toFixed(0)}</b> mm · max popačenje: <b>${(d.max_strain * 100).toFixed(2)} %</b>`;

  currentAddr = d.address;
  document.getElementById("addrstat").innerHTML = `naslov artefakta: <code>${d.address}</code>`;
  const pin = document.getElementById("pinstat");
  if (pinnedAddr === null) {
    pin.textContent = "";
  } else if (pinnedAddr === currentAddr) {
    pin.innerHTML = `<b style="color:#2a2">IDENTIČEN pripetemu</b>`;
  } else {
    pin.innerHTML = `<b style="color:#c60">drugačen</b> (pripet <code>${pinnedAddr.slice(0, 8)}…</code>)`;
  }
}

let currentAddr = null;
let pinnedAddr = null;
document.getElementById("pin-addr").addEventListener("click", () => {
  pinnedAddr = currentAddr;
  renderDerived();
});

// ---- COP: naročilo po velikostih → plan markerjev -------------------------
const COP_SIZES = [["S", 37], ["M", 83], ["L", 52], ["XL", 18]];
const copState = {};
const copControls = document.getElementById("cop-controls");
for (const [sz, def] of COP_SIZES) {
  copState[sz] = def;
  const row = document.createElement("label");
  row.innerHTML = `<span>${sz}</span><input type="number" min="0" max="5000" value="${def}">`;
  row.querySelector("input").addEventListener("input", (e) => {
    copState[sz] = Math.max(0, Number(e.target.value) || 0);
    renderCop();
  });
  copControls.append(row);
}

function renderCop() {
  const len = ex.cop_plan(copState.S, copState.M, copState.L, copState.XL, 25, 6);
  const ptr = Number(ex.demo_ptr());
  const p = JSON.parse(new TextDecoder().decode(new Uint8Array(ex.memory.buffer, ptr, len)));
  const table = document.getElementById("cop-table");
  const stat = document.getElementById("copstat");
  if (!p.ok) {
    table.replaceChildren();
    stat.innerHTML = `<span class="err">${p.error}</span>`;
    return;
  }
  table.innerHTML =
    "<tr><th>#</th><th>kompozicija</th><th>sloji</th><th>dolžina</th></tr>" +
    p.markers.map((m, i) =>
      `<tr><td>${i + 1}</td><td>${m.comp.map(([sz, c]) => `${sz}×${c}`).join(" ")}</td>` +
      `<td>${m.plies}</td><td>${(m.len_mm / 1000).toFixed(2)} m</td></tr>`).join("");
  const total = COP_SIZES.reduce((a, [sz]) => a + copState[sz], 0);
  stat.innerHTML =
    `naročilo: <b>${total}</b> kosov · markerjev: <b>${p.markers.length}</b> · ` +
    `blago: <b>${(p.total_mm / 1000).toFixed(1)} m</b> · ` +
    `učinkovitost: <b>${(p.eff * 100).toFixed(1)} %</b> ` +
    `(teoretični min <b>${(p.floor_mm / 1000).toFixed(1)} m</b>)`;
}

// ---- Live simulation (fw-sim + fw-avatar in wasm) -------------------------
const canvas = document.getElementById("sim");
const ctx = canvas.getContext("2d");
const simstat = document.getElementById("simstat");
let frame = 0;

// Constraint topology of the live garment (fixed per scene): structural
// wireframe edges + seam pairs, cached at init; only positions stream per
// frame (I140 — the live scene is the FULL sewn garment).
let simEdges = new Uint32Array(0);
let simSeams = new Uint32Array(0);

function initSim() {
  const ok =
    state.fabric >= 0
      ? ex.sim_init_fabric(
          state.chest, state.waist, state.torso, state.shoulder, state.neck,
          state.armhole, state.fabric,
        )
      : ex.sim_init(
          state.chest, state.waist, state.torso, state.shoulder, state.neck,
          state.armhole, state.stretch,
        );
  frame = 0;
  if (ok) {
    simEdges = readU32(ex.sim_edges());
    simSeams = readU32(ex.sim_seams());
    init3d();
    simstat.textContent = `sim: OK · cel garment, ${ex.sim_dims()} vozlov`;
  } else {
    simstat.textContent = "sim: neveljavne mere";
  }
  return ok;
}

function readF32(len) {
  const ptr = Number(ex.demo_ptr());
  return new Float32Array(ex.memory.buffer.slice(ptr, ptr + len));
}

function readU32(len) {
  const ptr = Number(ex.demo_ptr());
  return new Uint32Array(ex.memory.buffer.slice(ptr, ptr + len));
}

// ---- 3D pogled (I142): osvetljeno telo + garment iz ISTIH podatkov kot sim.
// Vanilla WebGL1, brez knjižnic; telo je statična mreža (body_mesh ABI),
// garment črte dobijo sveže pozicije vsak frame. Počasna rotacija.
const gl = document.getElementById("sim3d")?.getContext("webgl", { antialias: true });
let g3 = null; // {prog, body:{vbo,ibo,n}, garm:{vbo,eibo,ne,sibo,ns}, loc}

function glProgram(vsSrc, fsSrc) {
  const mk = (t, src) => {
    const sh = gl.createShader(t);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(sh));
    return sh;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(p));
  return p;
}

// Minimalne matrike (column-major, kot jih pričakuje WebGL).
function matPerspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
}
function matMul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function matRotY(t) {
  const c = Math.cos(t), s = Math.sin(t);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}
function matTranslate(x, y, z) {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

function init3d() {
  if (!gl) return;
  if (!g3) {
    const vs = `attribute vec3 aPos; attribute vec3 aNor;
      uniform mat4 uMVP; uniform mat4 uModel; varying vec3 vNor;
      void main(){ gl_Position = uMVP * vec4(aPos,1.0);
        vNor = mat3(uModel[0].xyz,uModel[1].xyz,uModel[2].xyz) * aNor; }`;
    const fs = `precision mediump float; varying vec3 vNor;
      uniform vec3 uColor; uniform float uLit;
      void main(){
        float d = max(dot(normalize(vNor), normalize(vec3(0.35,0.45,0.85))), 0.0);
        vec3 c = mix(uColor, uColor * (0.35 + 0.75 * d), uLit);
        gl_FragColor = vec4(c, 1.0); }`;
    const prog = glProgram(vs, fs);
    g3 = {
      prog,
      loc: {
        pos: gl.getAttribLocation(prog, "aPos"),
        nor: gl.getAttribLocation(prog, "aNor"),
        mvp: gl.getUniformLocation(prog, "uMVP"),
        model: gl.getUniformLocation(prog, "uModel"),
        color: gl.getUniformLocation(prog, "uColor"),
        lit: gl.getUniformLocation(prog, "uLit"),
      },
      body: { vbo: gl.createBuffer(), ibo: gl.createBuffer(), n: 0 },
      garm: { vbo: gl.createBuffer(), eibo: gl.createBuffer(), ne: 0, sibo: gl.createBuffer(), ns: 0 },
    };
    gl.enable(gl.DEPTH_TEST);
  }
  // Telo (statično na init): prepleteni [poz, normala].
  const bv = readF32(ex.body_mesh());
  const bi = readU32(ex.body_mesh_indices());
  gl.bindBuffer(gl.ARRAY_BUFFER, g3.body.vbo);
  gl.bufferData(gl.ARRAY_BUFFER, bv, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g3.body.ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(bi), gl.STATIC_DRAW);
  g3.body.n = bi.length;
  // Garment topologija (statična na init; pozicije pridejo vsak frame).
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g3.garm.eibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(simEdges), gl.STATIC_DRAW);
  g3.garm.ne = simEdges.length;
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g3.garm.sibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(simSeams), gl.STATIC_DRAW);
  g3.garm.ns = simSeams.length;
}

function draw3d(tSec) {
  if (!gl || !g3) return;
  gl.viewport(0, 0, 360, 430);
  gl.clearColor(0.125, 0.141, 0.172, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  const model = matRotY(tSec * 0.5);
  const view = matTranslate(0, -30, -2500);
  const proj = matPerspective((42 * Math.PI) / 180, 360 / 430, 100, 6000);
  const mv = matMul(view, matMul(model, matTranslate(0, -60, 0)));
  const mvp = matMul(proj, mv);
  gl.useProgram(g3.prog);
  gl.uniformMatrix4fv(g3.loc.mvp, false, new Float32Array(mvp));
  gl.uniformMatrix4fv(g3.loc.model, false, new Float32Array(model));
  // Telo: osvetljeni trikotniki.
  gl.bindBuffer(gl.ARRAY_BUFFER, g3.body.vbo);
  gl.enableVertexAttribArray(g3.loc.pos);
  gl.vertexAttribPointer(g3.loc.pos, 3, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(g3.loc.nor);
  gl.vertexAttribPointer(g3.loc.nor, 3, gl.FLOAT, false, 24, 12);
  gl.uniform3f(g3.loc.color, 0.78, 0.8, 0.84);
  gl.uniform1f(g3.loc.lit, 1.0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g3.body.ibo);
  gl.drawElements(gl.TRIANGLES, g3.body.n, gl.UNSIGNED_SHORT, 0);
  // Garment: sveže pozicije, črte (robovi + šivi).
  const pos = readF32(ex.sim_positions());
  gl.bindBuffer(gl.ARRAY_BUFFER, g3.garm.vbo);
  gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
  gl.vertexAttribPointer(g3.loc.pos, 3, gl.FLOAT, false, 12, 0);
  gl.disableVertexAttribArray(g3.loc.nor);
  gl.vertexAttrib3f(g3.loc.nor, 0, 0, 1);
  gl.uniform1f(g3.loc.lit, 0.0);
  gl.uniform3f(g3.loc.color, 0.28, 0.4, 0.62);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g3.garm.eibo);
  gl.drawElements(gl.LINES, g3.garm.ne, gl.UNSIGNED_SHORT, 0);
  gl.uniform3f(g3.loc.color, 0.9, 0.55, 0.2);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g3.garm.sibo);
  gl.drawElements(gl.LINES, g3.garm.ns, gl.UNSIGNED_SHORT, 0);
}

const S = 0.55; // mm → px
const mapX = (x) => 180 + x * S;
const mapY = (y) => 410 - y * S;

function drawSim() {
  const n = ex.sim_dims();
  if (!n) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Figure as ONE smooth union (F1-B3, gladek render): every body part in
  // the SAME solid colour — overlaps become invisible and the round caps
  // blend the joints — then a light→shade gradient composited ONLY onto the
  // figure (source-atop) gives it a soft volume. Presentation only: the sim
  // still collides with the exact capsules/lofts.
  const BODY = "#c6cbd4";
  const lofts = ex.sim_avatar_loft ? readF32(ex.sim_avatar_loft()) : new Float32Array(0);
  if (lofts.length >= 4) {
    ctx.fillStyle = BODY;
    ctx.beginPath();
    // Right edge bottom→top, then left edge top→bottom.
    ctx.moveTo(mapX(lofts[2]), mapY(lofts[0]));
    for (let c = 0; c + 3 < lofts.length; c += 4) {
      ctx.lineTo(mapX(lofts[c + 3]), mapY(lofts[c + 1]));
    }
    for (let c = lofts.length - 4; c >= 0; c -= 4) {
      ctx.lineTo(mapX(-lofts[c + 3]), mapY(lofts[c + 1]));
      ctx.lineTo(mapX(-lofts[c + 2]), mapY(lofts[c]));
    }
    ctx.closePath();
    ctx.fill();
  }
  // Shoulder bar, neck, head, arms, legs: capsules as round-cap strokes in
  // the same solid colour — they merge with the torso into one silhouette.
  const av = readF32(ex.sim_avatar());
  ctx.strokeStyle = BODY;
  ctx.lineCap = "round";
  for (let c = 0; c + 6 < av.length; c += 7) {
    ctx.lineWidth = Math.max(2 * av[c + 6] * S, 2);
    ctx.beginPath();
    ctx.moveTo(mapX(av[c]), mapY(av[c + 1]));
    ctx.lineTo(mapX(av[c + 3]), mapY(av[c + 4]));
    ctx.stroke();
  }
  // Soft volume: shade the union from the left (light) to the right (shadow),
  // clipped to the figure pixels only.
  ctx.globalCompositeOperation = "source-atop";
  const shade = ctx.createLinearGradient(30, 0, 330, 0);
  shade.addColorStop(0, "rgba(255,255,255,0.40)");
  shade.addColorStop(0.45, "rgba(255,255,255,0)");
  shade.addColorStop(1, "rgba(30,40,58,0.26)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = "source-over";

  // Cloth grid.
  // The garment wireframe: structural edges, back fabric (z < 0) first in a
  // light tint, then front fabric dark — the same layer language as the
  // static visuals. Seams in a warm accent on top.
  const pos = readF32(ex.sim_positions());
  const X = (k) => mapX(pos[3 * k]);
  const Y = (k) => mapY(pos[3 * k + 1]);
  const Z = (k) => pos[3 * k + 2];
  ctx.lineWidth = 1.1;
  for (const pass of [0, 1]) {
    ctx.strokeStyle = pass === 0 ? "#a9b7d6" : "#35507e";
    ctx.beginPath();
    for (let e = 0; e + 1 < simEdges.length; e += 2) {
      const a = simEdges[e];
      const b = simEdges[e + 1];
      const front = Z(a) + Z(b) >= 0;
      if ((pass === 0 && front) || (pass === 1 && !front)) continue;
      ctx.moveTo(X(a), Y(a));
      ctx.lineTo(X(b), Y(b));
    }
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(217,130,43,0.55)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let e = 0; e + 1 < simSeams.length; e += 2) {
    const a = simSeams[e];
    const b = simSeams[e + 1];
    ctx.moveTo(X(a), Y(a));
    ctx.lineTo(X(b), Y(b));
  }
  ctx.stroke();
}

function tick() {
  if (ex.sim_step(1 / 60)) {
    frame++;
    drawSim();
    draw3d(frame / 60);
    if (frame % 30 === 0)
      simstat.textContent = `sim: OK · cel garment, ${ex.sim_dims()} vozlov · sličica ${frame}`;
  }
  requestAnimationFrame(tick);
}

for (const key of Object.keys(DOC_IDX)) docEvent(key); // začetno stanje = 6 dogodkov
{
  const addr = BigInt.asUintN(64, ex.size_table_address());
  document.getElementById("sizeaddr").innerHTML =
    `velikostna tabela (S–XL, op-log dokumenti): <code>${addr.toString(16).padStart(16, "0")}</code>`;
}
render();
renderDerived();
renderCop();
if (initSim()) requestAnimationFrame(tick);
