// Ambiance d'Oricourt : course du soleil sur la journée, ciel de nuit, sons de lieu (synthétisés, aucun fichier),
// fumées, oiseaux, brume de vallée. Le module ne connaît la maquette que par ce que main.js lui passe.
//
// Repère « local » de la maquette : x vers l'est, y vers le nord, z vers le haut. V(x, y, z) le convertit pour three.js.

const lisse = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const borne = (x, a, b) => Math.min(b, Math.max(a, x));

// ------------------------------------------------------------------ la journée
// Automne 1435, latitude d'Oricourt (47,6° N) : le soleil se lève vers 7 h à l'est-sud-est, culmine à environ 34° et se
// couche vers 18 h 30. La journée (7 h à 18 h 30) dure une heure réelle ; la nuit passe trois fois plus vite (22 minutes).
const LEVER = 7, COUCHER = 18.5, HAUTEUR_MAX = 34;
export function soleilA(h) {
  let el, az;
  if (h >= LEVER && h <= COUCHER) {
    const f = (h - LEVER) / (COUCHER - LEVER);
    el = HAUTEUR_MAX * Math.sin(Math.PI * f); az = -72 + 144 * f;
  } else {
    const hn = h < LEVER ? h + 24 : h, f = (hn - COUCHER) / (24 - COUCHER + LEVER);
    el = -26 * Math.sin(Math.PI * f); az = 72 + 216 * f;
  }
  const e = el * Math.PI / 180, a = az * Math.PI / 180;
  return { el, az, dir: [-Math.sin(a) * Math.cos(e), -Math.cos(a) * Math.cos(e), Math.sin(e)] };
}
export const heuresParSeconde = (h) => (h >= LEVER && h < COUCHER ? (COUCHER - LEVER) / 3600 : (24 - COUCHER + LEVER) / 1320);
export function libelleHeure(h) { const hh = Math.floor(h), mm = Math.floor((h - hh) * 60 / 5) * 5; return `${hh} h ${String(mm).padStart(2, '0')}`; }

export function creerAmbiance(o) {
  const { THREE, scene, renderer, soleil, hemi, matCiel, V } = o;
  const A = { heure: 10, pause: false, baseBrouillard: new THREE.Color(0xc6c4c0), jour: 1 };
  const cSoleilBas = new THREE.Color(0xff9a55), cSoleilHaut = new THREE.Color(0xfff0d6), cLune = new THREE.Color(0x92a6d6);
  const ciJour = new THREE.Color(0xdfe3ea), ciNuit = new THREE.Color(0x34415f), soJour = new THREE.Color(0x6a6238), soNuit = new THREE.Color(0x1c1c18);
  const cDore = new THREE.Color(0xffbf80), brNuit = new THREE.Color(0x1b2233), brCrep = new THREE.Color(0xd99a70), tmp = new THREE.Color();
  const cible = soleil.target.position.clone(), dirV = new THREE.Vector3();

  function lumiere() {
    const S = soleilA(A.heure), sinEl = Math.sin(S.el * Math.PI / 180);
    const jour = lisse(-0.12, 0.22, sinEl), crep = Math.exp(-(((sinEl - 0.04) / 0.13) ** 2)), nuit = 1 - lisse(-0.2, 0.0, sinEl);
    A.jour = jour;
    dirV.copy(V(...S.dir)).normalize();
    if (sinEl > -0.04) {   // le soleil
      soleil.position.copy(cible).addScaledVector(dirV, 220);
      soleil.intensity = 2.3 * lisse(-0.04, 0.2, sinEl);
      soleil.color.copy(cSoleilBas).lerp(cSoleilHaut, lisse(0.05, 0.45, sinEl));
    } else {               // la lune, haute au sud-ouest
      const l = V(-0.45, -0.6, 0.66).normalize(); soleil.position.copy(cible).addScaledVector(l, 220);
      soleil.intensity = 0.5 * lisse(-0.04, -0.2, sinEl); soleil.color.copy(cLune);
    }
    hemi.intensity = 0.3 + 0.3 * jour;
    hemi.color.copy(ciNuit).lerp(ciJour, jour).lerp(cDore, crep * 0.55 * jour); hemi.groundColor.copy(soNuit).lerp(soJour, jour);
    scene.environmentIntensity = 0.07 + 0.38 * jour;
    // brouillard et ciel
    tmp.copy(brNuit).lerp(A.baseBrouillard, jour).lerp(brCrep, crep * 0.35 * jour);
    if (scene.fog) scene.fog.color.copy(tmp);
    const U = matCiel.uniforms; U.soleil.value.copy(dirV); U.lum.value = 0.07 + 0.93 * jour; U.crep.value = crep; U.nuit.value = nuit;
    return { jour, crep, nuit };
  }

  // ------------------------------------------------------------------ sons de lieu
  const SONS = { ctx: null, maitre: null, voulu: true, sources: {}, prochain: {}, attenue: 1, ventG: null, ventF: null };
  try { SONS.voulu = localStorage.getItem('oricourt_sons') !== 'non'; } catch (e) { /* stockage indisponible */ }
  function reveiller() {
    if (SONS.ctx || !SONS.voulu) { if (SONS.ctx && SONS.ctx.state === 'suspended') SONS.ctx.resume(); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return;
    const ctx = new Ctx(); SONS.ctx = ctx;
    SONS.maitre = ctx.createGain(); SONS.maitre.gain.value = 0.9; SONS.maitre.connect(ctx.destination);
    const n = ctx.sampleRate * 2, buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    SONS.bruit = buf;
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;   // le vent : bruit filtré, qui monte avec l'altitude
    SONS.ventF = ctx.createBiquadFilter(); SONS.ventF.type = 'bandpass'; SONS.ventF.frequency.value = 420; SONS.ventF.Q.value = 0.6;
    SONS.ventG = ctx.createGain(); SONS.ventG.gain.value = 0;
    src.connect(SONS.ventF).connect(SONS.ventG).connect(SONS.maitre); src.start();
  }
  const osc = (type, f, t, dur, g, sortie, glisse) => {
    const c = SONS.ctx, o2 = c.createOscillator(), e = c.createGain(); o2.type = type; o2.frequency.setValueAtTime(f, t);
    if (glisse) o2.frequency.exponentialRampToValueAtTime(glisse, t + dur);
    e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(g, t + Math.min(0.02, dur / 4)); e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o2.connect(e).connect(sortie); o2.start(t); o2.stop(t + dur + 0.05);
  };
  const bruitBref = (t, dur, g, fType, f, sortie) => {
    const c = SONS.ctx, s = c.createBufferSource(), fi = c.createBiquadFilter(), e = c.createGain(); s.buffer = SONS.bruit;
    fi.type = fType; fi.frequency.value = f; e.gain.setValueAtTime(g, t); e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fi).connect(e).connect(sortie); s.start(t, Math.random() * 1.5, dur + 0.05);
  };
  const RECETTES = {
    marteau(t, g, s) { for (const [f, k] of [[1730, 1], [2410, 0.6], [3870, 0.35]]) osc('sine', f, t, 0.22, g * 0.22 * k, s); bruitBref(t, 0.04, g * 0.3, 'highpass', 2500, s); },
    poule(t, g, s) { const n = 2 + Math.floor(Math.random() * 3); for (let i = 0; i < n; i++) osc('triangle', 620 - i * 15, t + i * 0.16, 0.09, g * 0.12, s, 470);
      if (Math.random() < 0.4) osc('triangle', 520, t + n * 0.16 + 0.1, 0.35, g * 0.12, s, 760); },
    pigeon(t, g, s) { for (let i = 0; i < 2; i++) { const c = SONS.ctx, o2 = c.createOscillator(), e = c.createGain(), tr = c.createOscillator(), trg = c.createGain();
      o2.frequency.value = 360 - i * 25; tr.frequency.value = 24; trg.gain.value = 0.5; tr.connect(trg); const t0 = t + i * 0.55;
      e.gain.setValueAtTime(0.0001, t0); e.gain.exponentialRampToValueAtTime(g * 0.1, t0 + 0.08); e.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.45);
      const am = c.createGain(); am.gain.value = 0.6; trg.connect(am.gain); o2.connect(am).connect(e).connect(s); o2.start(t0); tr.start(t0); o2.stop(t0 + 0.5); tr.stop(t0 + 0.5); } },
    oiseau(t, g, s) { const n = 3 + Math.floor(Math.random() * 4), f0 = 2600 + Math.random() * 1800; for (let i = 0; i < n; i++) osc('sine', f0 * (0.9 + Math.random() * 0.2), t + i * 0.09, 0.07, g * 0.05, s, f0 * 1.35); },
    grillon(t, g, s) { for (let k = 0; k < 3; k++) for (let i = 0; i < 3; i++) osc('sine', 4600, t + k * 0.32 + i * 0.045, 0.03, g * 0.03, s); },
    cloche(t, g, s) { for (const [r, k, d] of [[0.5, 0.6, 5], [1, 1, 4], [1.19, 0.5, 3], [1.5, 0.45, 2.6], [2, 0.35, 2], [2.74, 0.22, 1.4]]) osc('sine', 330 * r, t, d, g * 0.11 * k, s); },
    cor(t, g, s) { for (const [f, t0, d] of [[196, 0, 0.9], [262, 0.95, 1.5]]) { const c = SONS.ctx, o2 = c.createOscillator(), fi = c.createBiquadFilter(), e = c.createGain();
      o2.type = 'sawtooth'; o2.frequency.value = f; fi.type = 'lowpass'; fi.frequency.value = 900; e.gain.setValueAtTime(0.0001, t + t0); e.gain.exponentialRampToValueAtTime(g * 0.16, t + t0 + 0.12);
      e.gain.setValueAtTime(g * 0.16, t + t0 + d - 0.2); e.gain.exponentialRampToValueAtTime(0.0001, t + t0 + d); o2.connect(fi).connect(e).connect(s); o2.start(t + t0); o2.stop(t + t0 + d + 0.05); } },
    oie(t, g, s) { const n = 1 + Math.floor(Math.random() * 3); for (let i = 0; i < n; i++) { const c = SONS.ctx, o2 = c.createOscillator(), fi = c.createBiquadFilter(), e = c.createGain(), t0 = t + i * (0.28 + Math.random() * 0.2), f = 330 + Math.random() * 90;
      o2.type = 'sawtooth'; o2.frequency.setValueAtTime(f, t0); o2.frequency.exponentialRampToValueAtTime(f * 1.25, t0 + 0.05); o2.frequency.exponentialRampToValueAtTime(f * 0.92, t0 + 0.2);
      fi.type = 'bandpass'; fi.frequency.value = 1100; fi.Q.value = 1.4; e.gain.setValueAtTime(0.0001, t0); e.gain.exponentialRampToValueAtTime(g * 0.2, t0 + 0.03); e.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
      o2.connect(fi).connect(e).connect(s); o2.start(t0); o2.stop(t0 + 0.25); } },
    canard(t, g, s) { const n = 2 + Math.floor(Math.random() * 3); for (let i = 0; i < n; i++) { const c = SONS.ctx, o2 = c.createOscillator(), fi = c.createBiquadFilter(), e = c.createGain(), t0 = t + i * 0.2;
      o2.type = 'square'; o2.frequency.setValueAtTime(260, t0); o2.frequency.exponentialRampToValueAtTime(200, t0 + 0.15); fi.type = 'bandpass'; fi.frequency.value = 900; fi.Q.value = 2;
      e.gain.setValueAtTime(0.0001, t0); e.gain.exponentialRampToValueAtTime(g * 0.12, t0 + 0.02); e.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16); o2.connect(fi).connect(e).connect(s); o2.start(t0); o2.stop(t0 + 0.2); } },
    faucon(t, g, s) { const n = 3 + Math.floor(Math.random() * 4); for (let i = 0; i < n; i++) osc('triangle', 2300, t + i * 0.13, 0.09, g * 0.07, s, 1900); },
    crepitement(t, g, s) { for (let i = 0; i < 4; i++) bruitBref(t + Math.random() * 0.4, 0.02 + Math.random() * 0.04, g * 0.12, 'highpass', 1800, s); },
  };
  function jouer(recette, g) { if (!SONS.ctx || g < 0.01) return; RECETTES[recette](SONS.ctx.currentTime + 0.02, Math.min(1, g), SONS.maitre); }
  let heurePrec = Math.floor(A.heure);
  function sons(dt, ecoute, passe, hauteur) {
    if (!SONS.ctx) return;
    SONS.maitre.gain.value += ((SONS.voulu ? 0.9 * SONS.attenue : 0) - SONS.maitre.gain.value) * Math.min(1, dt * 2);
    SONS.ventG.gain.value += ((0.025 + 0.09 * lisse(4, 18, hauteur)) - SONS.ventG.gain.value) * Math.min(1, dt);
    SONS.ventF.frequency.value = 380 + 160 * Math.sin(performance.now() / 4300) + 90 * Math.sin(performance.now() / 1700);
    const t = performance.now() / 1000, jourActif = A.heure > 7.5 && A.heure < 18.3, gDist = (p, R) => (p ? borne(1 - Math.hypot(p[0] - ecoute[0], p[1] - ecoute[1], (p[2] ?? ecoute[2]) - ecoute[2]) / R, 0, 1) ** 2 : 0);
    const planifier = (cle, attente, fn) => { if (!(cle in SONS.prochain)) SONS.prochain[cle] = t + Math.random() * attente[1]; if (t >= SONS.prochain[cle]) { SONS.prochain[cle] = t + attente[0] + Math.random() * (attente[1] - attente[0]); fn(); } };
    const S = SONS.sources;
    if (jourActif) planifier('oiseau', [2, 7], () => jouer('oiseau', 0.6 + 0.4 * Math.random()));
    else planifier('grillon', [0.8, 2.4], () => jouer('grillon', 0.7));
    if (passe) {
      if (jourActif && S.forge) planifier('forge', [0.7, 1.4], () => jouer('marteau', gDist(S.forge, 45)));
      if (S.poules) planifier('poule', [3, 10], () => jouer('poule', gDist(S.poules, 35)));
      if (jourActif && S.colombier) planifier('pigeon', [3, 8], () => jouer('pigeon', gDist(S.colombier, 28)));
      if (S.torches) planifier('torche', [0.15, 0.5], () => { let g = 0; for (const p of S.torches) g = Math.max(g, gDist(p, 5)); jouer('crepitement', g); });
      const h = Math.floor(A.heure);
      if (h !== heurePrec && S.cloche) {   // la cloche de la chapelle sonne les heures
        const n = h % 12 || 12, g = 0.25 + 0.75 * gDist(S.cloche, 140);
        for (let i = 0; i < n; i++) setTimeout(() => jouer('cloche', g), i * 2300);
      }
      heurePrec = h;
    } else heurePrec = Math.floor(A.heure);
  }

  // ------------------------------------------------------------------ fumées (feux des masures, de la forge, de la cuisine)
  const texFumee = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 2, 32, 32, 31);
    g.addColorStop(0, 'rgba(235,235,235,0.9)'); g.addColorStop(0.5, 'rgba(210,210,210,0.35)'); g.addColorStop(1, 'rgba(200,200,200,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const FUMEES = [];
  function fumee(x, y, z, groupe, force = 1) {
    const P = [];
    for (let i = 0; i < 10; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texFumee, transparent: true, depthWrite: false, opacity: 0, color: 0xa9a7a3, fog: true })); groupe.add(s); P.push({ s, age: i * 0.9 * 10 / 10, vie: 9 }); }
    FUMEES.push({ x, y, z, P, force, groupe });
  }
  function majFumees(dt, temps) {
    const vx = 0.35 + 0.15 * Math.sin(temps / 23), vy = 0.12;
    for (const F of FUMEES) {
      if (!F.groupe.visible) continue;
      for (const p of F.P) {
        p.age += dt; if (p.age > p.vie) p.age -= p.vie;
        const f = p.age / p.vie, h = p.age * 0.55 * F.force;
        p.s.position.copy(V(F.x + vx * p.age + Math.sin(p.age * 0.8 + F.x) * 0.2, F.y + vy * p.age, F.z + h));
        const sc = (0.6 + f * 3.4) * F.force; p.s.scale.set(sc, sc, 1);
        p.s.material.opacity = 0.5 * Math.min(1, f * 6) * (1 - f) * (0.55 + 0.45 * A.jour);
      }
    }
  }

  // ------------------------------------------------------------------ oiseaux : pigeons autour du colombier, choucas autour des tours
  const VOLEES = [];
  /** Un oiseau stylisé : corps en fuseau, deux ailes triangulaires (envergure ≈ 0,7 × taille), cou éventuel. */
  function unOiseau(mat, taille, cou = 0) {
    const corps = new THREE.ConeGeometry(0.07 * taille, 0.32 * taille, 5).rotateX(Math.PI / 2);
    const aile = new THREE.BufferGeometry(); aile.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.08 * taille, 0, 0, 0.1 * taille, 0.34 * taille, 0, 0.02 * taille], 3)); aile.computeVertexNormals();
    const g = new THREE.Group(), c = new THREE.Mesh(corps, mat), aG = new THREE.Mesh(aile, mat), aD = new THREE.Mesh(aile, mat); aD.scale.x = -1; g.add(c, aG, aD);
    if (cou) { const n = new THREE.Mesh(new THREE.CylinderGeometry(0.02 * taille, 0.03 * taille, cou * taille).rotateX(Math.PI / 2), mat); n.position.z = -(0.16 * taille + cou * taille / 2);   /* le cou tendu, en avant : le corps vole base en avant */ g.add(n); }
    return { g, aG, aD };
  }
  function oiseaux(groupe, centre, z, rayon, n, couleur, taille = 1) {
    const mat = new THREE.MeshStandardMaterial({ color: couleur, roughness: 0.9, side: THREE.DoubleSide });
    for (let i = 0; i < n; i++) {
      const { g, aG, aD } = unOiseau(mat, taille); groupe.add(g);
      VOLEES.push({ g, aG, aD, centre, z: z + (Math.random() - 0.5) * 4, r: rayon * (0.6 + Math.random() * 0.6), w: (0.35 + Math.random() * 0.25) * (Math.random() < 0.5 ? 1 : -1), ph: Math.random() * 6.28, groupe });
    }
  }
  function majOiseaux(temps) {
    for (const B of VOLEES) {
      if (!B.groupe.visible) continue;
      const a = B.ph + temps * B.w, x = B.centre[0] + Math.cos(a) * B.r, y = B.centre[1] + Math.sin(a) * B.r * 0.8, z = B.z + Math.sin(temps * 0.7 + B.ph) * 1.2;
      B.g.position.copy(V(x, y, z));
      const vx = -Math.sin(a) * B.w, vy = Math.cos(a) * B.w * 0.8; B.g.rotation.y = Math.atan2(vx, -vy) + Math.PI;
      const battre = Math.sin(temps * 16 + B.ph * 3) * 0.7 * (0.5 + 0.5 * Math.sin(temps * 0.5 + B.ph) > 0.3 ? 1 : 0.15);
      B.aG.rotation.z = battre; B.aD.rotation.z = -battre;
    }
  }

  // ------------------------------------------------------------------ passages : oies sauvages en V, canards en ligne, faucon qui tournoie
  // De jour, toutes les deux à quatre minutes, une volée traverse le ciel en ligne droite ; un faucon crécerelle plane au-dessus du château.
  const PASSAGES = { groupe: null, centre: [0, 0], vol: null, prochain: 40 + Math.random() * 50, faucon: null, cri: 20 };
  function passages(groupe, centre) {
    PASSAGES.groupe = groupe; PASSAGES.centre = centre;
    const mf = new THREE.MeshStandardMaterial({ color: 0x6a5a48, roughness: 0.9, side: THREE.DoubleSide });
    const f = unOiseau(mf, 2.4); groupe.add(f.g); PASSAGES.faucon = { ...f, a: Math.random() * 6.28, r: 38, z: 52 };
  }
  function lancerVol() {
    const P = PASSAGES, oies = Math.random() < 0.6, n = oies ? 7 + Math.floor(Math.random() * 6) : 5 + Math.floor(Math.random() * 4);
    const mat = new THREE.MeshStandardMaterial({ color: oies ? 0x5e574e : 0x4a4436, roughness: 0.9, side: THREE.DoubleSide });
    const cap = Math.random() * 6.28, d = [Math.cos(cap), Math.sin(cap)], q = [-d[1], d[0]], dec = (Math.random() - 0.5) * 120;
    const depart = [P.centre[0] - d[0] * 600 + q[0] * dec, P.centre[1] - d[1] * 600 + q[1] * dec], g = new THREE.Group(), membres = [];
    for (let k = 0; k < n; k++) {
      const o = unOiseau(mat, oies ? 4.4 : 2.8, oies ? 0.22 : 0.1); g.add(o.g);
      const rang = Math.ceil(k / 2), cote = k % 2 ? 1 : -1;
      const off = oies ? [-rang * 2.6, rang * 2.1 * cote] : [-k * 2.2 + (Math.random() - 0.5), (Math.random() - 0.5) * 1.6];   // [recul, écart]
      membres.push({ ...o, off, ph: Math.random() * 6.28, dz: (Math.random() - 0.5) * 0.6 });
    }
    P.groupe.add(g);
    P.vol = { g, membres, oies, d, q, depart, s: 0, v: oies ? 15 : 19, z: 45 + Math.random() * 30, crie: 1 };
  }
  function majPassages(dt, temps, ecoute) {
    const P = PASSAGES; if (!P.groupe) return;
    const jour = A.heure > 6.5 && A.heure < 19.5, visible = P.groupe.visible;
    // le faucon : il plane en larges cercles, bat des ailes de temps à autre, et crie
    if (P.faucon) {
      const F = P.faucon; F.g.visible = jour; F.a += dt * 0.16;
      const x = P.centre[0] + Math.cos(F.a) * F.r, y = P.centre[1] + Math.sin(F.a) * F.r * 0.85, z = F.z + Math.sin(temps * 0.21) * 6;
      F.g.position.copy(V(x, y, z)); F.g.rotation.order = 'YXZ'; F.g.rotation.y = Math.atan2(-Math.sin(F.a), -Math.cos(F.a) * 0.85) + Math.PI; F.g.rotation.z = 0.35;
      const bat = Math.sin(temps * 0.4) > 0.75 ? Math.sin(temps * 13) * 0.6 : 0.12; F.aG.rotation.z = bat; F.aD.rotation.z = -bat;
      P.cri -= dt; if (P.cri < 0) { P.cri = 18 + Math.random() * 30; if (jour && visible) jouer('faucon', 0.25 + 0.5 * borne(1 - Math.hypot(x - ecoute[0], y - ecoute[1], z - ecoute[2]) / 140, 0, 1)); }
    }
    // les volées de passage
    if (!P.vol) { P.prochain -= dt; if (P.prochain < 0) { P.prochain = 120 + Math.random() * 120; if (jour) lancerVol(); } return; }
    const W = P.vol; W.s += dt * W.v;
    const tete = [W.depart[0] + W.d[0] * W.s, W.depart[1] + W.d[1] * W.s];
    for (const M of W.membres) {
      const x = tete[0] + W.d[0] * M.off[0] + W.q[0] * M.off[1], y = tete[1] + W.d[1] * M.off[0] + W.q[1] * M.off[1];
      M.g.position.copy(V(x, y, W.z + M.dz + Math.sin(temps * 0.8 + M.ph) * 0.4)); M.g.rotation.y = Math.atan2(W.d[0], -W.d[1]) + Math.PI;
      const bat = Math.sin(temps * (W.oies ? 5.5 : 9) + M.ph) * (W.oies ? 0.55 : 0.7); M.aG.rotation.z = bat; M.aD.rotation.z = -bat;
    }
    const dist = Math.hypot(tete[0] - ecoute[0], tete[1] - ecoute[1], W.z - ecoute[2]);
    W.crie -= dt; if (W.crie < 0 && visible) { W.crie = W.oies ? 0.8 + Math.random() * 1.6 : 1.5 + Math.random() * 2.5; jouer(W.oies ? 'oie' : 'canard', borne(1 - dist / 260, 0, 1) ** 1.5); }
    if (W.s > 1200) { P.groupe.remove(W.g); W.g.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); P.vol = null; }
  }

  // ------------------------------------------------------------------ brume de vallée (matin, soir et nuit)
  const BRUMES = [];
  function brume(groupe, zs, etendue = 900) {
    const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d'), img = x.createImageData(256, 256);
    const hsh = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };
    const brt = (u, v, p) => { const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j, w = (a) => ((a % p) + p) % p, su = fu * fu * (3 - 2 * fu), sv = fv * fv * (3 - 2 * fv);
      return (hsh(w(i), w(j)) * (1 - su) + hsh(w(i + 1), w(j)) * su) * (1 - sv) + (hsh(w(i), w(j + 1)) * (1 - su) + hsh(w(i + 1), w(j + 1)) * su) * sv; };
    for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
      let s = 0, a = 0.5, f = 4; for (let k = 0; k < 4; k++) { s += a * brt(i / 256 * f, j / 256 * f, f); a *= 0.5; f *= 2; }
      const v = lisse(0.38, 0.75, s); const q = (j * 256 + i) * 4; img.data[q] = img.data[q + 1] = img.data[q + 2] = 240; img.data[q + 3] = v * 255;
    }
    x.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(5, 5);
    zs.forEach((z, k) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(etendue, etendue).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: tex.clone(), transparent: true, depthWrite: false, opacity: 0, color: 0xe6e8ec, fog: true }));
      m.material.map.repeat.set(5 + k, 5 + k); m.material.map.needsUpdate = true;
      m.position.copy(V(0, 0, z)); m.renderOrder = 2; groupe.add(m); BRUMES.push({ m, k });
    });
  }
  function majBrume(dt, temps, eclairage) {
    const h = A.heure, matin = Math.exp(-(((h - 8) / 1.6) ** 2)), soir = Math.exp(-(((h - 19.3) / 1.4) ** 2));
    const dens = 0.04 + 0.42 * Math.max(matin, soir) + 0.18 * eclairage.nuit;
    for (const B of BRUMES) {
      B.m.material.opacity = dens * (B.k ? 0.6 : 0.85);
      B.m.material.map.offset.set(temps * 0.0015 * (B.k + 1), temps * 0.0009);
      B.m.material.color.setRGB(0.55 + 0.45 * A.jour, 0.57 + 0.43 * A.jour, 0.62 + 0.38 * A.jour);
    }
  }

  // ------------------------------------------------------------------ boucle
  let temps = 0;
  function maj(dt, { ecoute, passe, hauteur }) {
    temps += dt;
    if (!A.pause) { A.heure += dt * heuresParSeconde(A.heure); if (A.heure >= 24) A.heure -= 24; }
    const ecl = lumiere();
    majFumees(dt, temps); majOiseaux(temps); majPassages(dt, temps, ecoute || [0, 0, 0]); majBrume(dt, temps, ecl);
    sons(dt, ecoute, passe, hauteur);
    return ecl;
  }
  return {
    A, maj, fumee, oiseaux, passages, brume, reveiller, jouer, SONS, PASSAGES, lancerVol,
    regler(h) { A.heure = ((h % 24) + 24) % 24; },
    basculerSons() { SONS.voulu = !SONS.voulu; try { localStorage.setItem('oricourt_sons', SONS.voulu ? 'oui' : 'non'); } catch (e) { /* rien */ } if (SONS.voulu) reveiller(); return SONS.voulu; },
  };
}
