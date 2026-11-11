// Repris tel quel du Studio de vie (app/assets/jeu/personnages_vie.js) pour Oricourt. Studio de vie — vie procédurale des personnages (J67). Sans animation achetée : après le mélangeur de clips, quelques os
// reçoivent de petits décalages, les mêmes pour les modèles Meshy de J45, l'habillage de J50 et le kit paramétrique de J22.
//   - respiration : le buste se redresse à l'inspiration, les clavicules montent un peu, le cou compense pour que la tête
//     reste stable ; rythme et phase propres à chaque personnage ; essoufflement après une course ;
//   - appuis : en attente debout, le poids passe lentement d'une jambe à l'autre (bassin déporté et incliné, cuisses qui
//     compensent pour que les pieds ne glissent pas, colonne qui redresse les épaules) ; période et phase tirées de
//     l'identifiant : deux personnages ne bougent jamais ensemble, et le même personnage bouge toujours pareil ;
//   - regard : la tête, puis les yeux quand le modèle en a, se tournent vers l'interlocuteur (fixé par le plan de dialogue)
//     ou vers ce qui bouge à portée, dans des limites anatomiques (buste, cou, tête), avec amortissement ;
//   - yeux : saccades et clignements là où le modèle a des yeux séparés (nuanceur de l'œil de l'habillage, os d'yeux,
//     clés de paupière : voir « Contrat » plus bas). Les modèles Meshy ont des yeux peints : tête et buste seulement.
// Les décalages sont retirés avant chaque passage du mélangeur (`avant`) et reposés après (`apres`) : rien ne s'accumule,
// les clips, les calages des armes et les pivots corrigés de J52 ne voient jamais un os décalé pendant leur calcul.
// Désactivable : localStorage « studio.vie » = « 0 », ou ?vie=0 ; coupée d'office avec « mouvements réduits ».
// Contrat des têtes à venir (corps en haute définition, docs/HABILLAGE.md) — au choix, le moteur les reconnaît seul :
//   - os `LeftEye` et `RightEye` (enfants de `Head`, repos neutre) : tournés vers la cible ;
//   - clés de forme `clignement_g`, `clignement_d` (ou `clignement`), `regard_gauche`, `regard_droite`, `regard_haut`,
//     `regard_bas` (0 à 1, pour 30° de côté et 20° en hauteur) ;
//   - ou le matériau « oeil » de l'habillage, qui lit REGARD_YEUX (lacet, tangage, paupière).
import * as THREE from 'three';

/** Uniforme commun des yeux tracés au nuanceur (personnages_habillage.js, _oeil) : x lacet (rad, vers la gauche du
 *  personnage), y tangage (rad, vers le bas), z paupière (0 ouverte, 1 fermée). Chaque œil le reçoit juste avant son dessin. */
export const REGARD_YEUX = { value: new THREE.Vector3(0, 0, 0) };

const RAD = Math.PI / 180;
// états du personnage (clip de fond) : debout par défaut ; au sol, assis ou au travail, pas d'appuis ; les variantes des
// mouvements de J65 (attente_2, marche_blesse…) suivent leur famille
const AU_SOL = /assis|agenouill|couch|mort|renvers|travail|ramass|recolt|nage|chevauch|monte|dort|tomb/;
const GARDE = /combat|garde/;
const MARCHE = /^(marche|course|porter|trot|galop|fuite)/;
const LIMITES = { lacet: 68 * RAD, haut: 20 * RAD, bas: 26 * RAD, yeuxLacet: 30 * RAD, yeuxTangage: 20 * RAD, derriere: 105 * RAD };
const PORTEE = 6.5, PROCHE = 2.6, MEMOIRE = 2.5;

/** La vie procédurale est-elle voulue sur cet appareil ? */
export function vieActive() {
  try {
    if (typeof location !== 'undefined' && /[?&]vie=(0|non)\b/.test(location.search || '')) return false;
    if (typeof localStorage !== 'undefined' && localStorage.getItem('studio.vie') === '0') return false;
  } catch { /* sans stockage : active */ }
  return true;
}

const hache = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; };
const borne = (x, a, b) => (x < a ? a : x > b ? b : x);
const tour = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const qA = new THREE.Quaternion(), qB = new THREE.Quaternion(), qR = new THREE.Quaternion(), qP = new THREE.Quaternion();
const eul = new THREE.Euler(0, 0, 0, 'YXZ');
const v1 = new THREE.Vector3();

/** Squelette humanoïde d'un personnage : os utiles, quel que soit le jeu de noms (Meshy et habillage, kit) ; null sinon. */
function lireSquelette(p) {
  const os = p && p.os;
  if (!os || typeof os.get !== 'function' || !p.objet) return null;
  const tete = os.get('Head'), bassin = os.get('Hips') || os.get('pelvis');
  const cuisseG = os.get('LeftUpLeg') || os.get('thigh_l'), cuisseD = os.get('RightUpLeg') || os.get('thigh_r');
  const epauleG = os.get('LeftShoulder') || os.get('clavicle_l'), epauleD = os.get('RightShoulder') || os.get('clavicle_r');
  if (!tete || !bassin || !cuisseG || !cuisseD || !epauleG || !epauleD) return null;
  const colonne = [];                                          // du bassin (exclu) à la tête (incluse)
  for (let o = tete; o && o !== bassin; o = o.parent) { if (!o.isBone) return null; colonne.unshift(o); }
  if (colonne.length < 3 || colonne[0].parent !== bassin) return null;
  const amont = [];                                            // de la racine du personnage (exclue) au parent du bassin (inclus)
  for (let o = bassin.parent; o && o !== p.objet; o = o.parent) amont.unshift(o);
  if (!bassin.parent) return null;
  const n = colonne.length;
  return { tete, cou: colonne[n - 2], buste: colonne[n - 3], dos: n >= 4 ? colonne[n - 4] : null, lombes: colonne[0] !== colonne[n - 3] ? colonne[0] : null,
    colonne, bassin, cuisseG, cuisseD, epauleG, epauleD, amont, oeilG: os.get('LeftEye') || null, oeilD: os.get('RightEye') || null };
}

/** Yeux d'un personnage : maillages au matériau « oeil » (nuanceur de l'habillage), clés de forme de paupière et de regard. */
function lireYeux(p) {
  const y = { nuanceur: [], cles: [] };
  for (const m of p.maillages || []) {
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    if (mats.some((x) => x && x.name === 'oeil')) y.nuanceur.push(m);
    const d = m.morphTargetDictionary;
    if (d && ['clignement', 'clignement_g', 'clignement_d', 'regard_gauche', 'regard_droite', 'regard_haut', 'regard_bas'].some((k) => d[k] !== undefined)) y.cles.push(m);
  }
  return y;
}

export class Vie {
  /** `calme` : mouvements réduits (aucune vie procédurale). */
  constructor({ calme = false, actif = vieActive() } = {}) {
    this.actif = !!actif && !calme;
    this.etats = new WeakMap(); this.poses = []; this.temps = 0;
    this.fixes = new Map();                                    // porteur -> cible imposée (porteur ou point {x, y, z})
    this._ms = 0; this._images = 0; this._n = 0;
  }
  /** Regard imposé d'un porteur (dialogue) : `cible` est un autre porteur, un point {x, y, z} du monde, ou null pour le rendre. */
  fixer(porteur, cible) { if (!porteur) return; if (cible) this.fixes.set(porteur, cible); else this.fixes.delete(porteur); }
  liberer() { this.fixes.clear(); }
  /** Coût mesuré : millisecondes par image (moyenne depuis la dernière lecture) et nombre de personnages animés. */
  cout(remettre = true) { const r = { ms: this._images ? this._ms / this._images : 0, images: this._images, personnages: this._n }; if (remettre) { this._ms = 0; this._images = 0; } return r; }

  _etat(p) {
    let e = this.etats.get(p);
    if (e !== undefined) return e;
    const sq = lireSquelette(p);
    if (!sq || p.sansVie) { this.etats.set(p, null); return null; }
    const g = hache((p.desc && p.desc.id) || p.objet.uuid);
    const al = (k) => ((Math.imul(g ^ (k * 2654435761), 2246822519) >>> 0) % 10000) / 10000;   // tirage stable par personnage
    p.objet.updateWorldMatrix(true, false); sq.bassin.parent.updateWorldMatrix(true, false);
    const ech = (m) => Math.hypot(m.elements[0], m.elements[1], m.elements[2]) || 1;
    e = {
      sq, yeux: lireYeux(p),
      echAmont: ech(sq.bassin.parent.matrixWorld) / ech(p.objet.matrixWorld),       // unités du parent du bassin par mètre du personnage
      souffle: { periode: 3.6 + 1.2 * al(1), phase: al(2) * 6.283, effort: 0 },
      appui: { periode: 11 + 8 * al(3), phase: al(4) * 6.283, periode2: 23 + 9 * al(5), sens: al(6) < 0.5 ? -1 : 1 },
      derive: { p1: 5 + 4 * al(7), p2: 7 + 3 * al(8), ph: al(9) * 6.283 },
      regard: { lacet: 0, tangage: 0, vl: 0, vt: 0, poids: 0, cible: null, attention: 0, engage: false },
      oeil: { lacet: 0, tangage: 0, sl: 0, st: 0, prochaine: 0.5 + 2 * al(10), paupiere: 0, clin: -1, prochainClin: 1 + 4 * al(11), graine: g >>> 0 },
      debout: 0, mobile: 0, pos: new THREE.Vector3(), vit: 0, vu: false, lacetMonde: 0, vRegard: new THREE.Vector3(),
      mem: [],
    };
    for (const m of e.yeux.nuanceur) {                         // chaque œil reçoit son regard juste avant son dessin
      const ancien = m.onBeforeRender, etat = e;
      m.onBeforeRender = function (...a) { REGARD_YEUX.value.copy(etat.vRegard); if (ancien) ancien.apply(this, a); };
      m.onAfterRender = () => { REGARD_YEUX.value.set(0, 0, 0); };
    }
    this.etats.set(p, e);
    return e;
  }

  /** Avant le mélangeur : retire les décalages posés à l'image précédente (si personne d'autre n'a touché l'os depuis),
   *  du dernier au premier : un os décalé deux fois retrouve sa pose d'origine. */
  avant() {
    const l = this.poses;
    for (let i = l.length - 1; i >= 0; i--) {
      const x = l[i];
      if (x.pos) { if (x.os.position.equals(x.apres)) x.os.position.copy(x.avant); } else if (x.os.quaternion.equals(x.apres)) x.os.quaternion.copy(x.avant);
    }
    l.length = 0;
  }

  _memo(e, os, pos = false) {
    let x = e.mem[e.nMem];
    if (!x) { x = { os: null, pos: false, avant: null, apres: null }; e.mem[e.nMem] = x; }
    e.nMem++;
    x.os = os; x.pos = pos;
    if (pos) { (x.avant ||= new THREE.Vector3()); (x.apres ||= new THREE.Vector3()); if (!x.avant.isVector3) { x.avant = new THREE.Vector3(); x.apres = new THREE.Vector3(); } x.avant.copy(os.position); }
    else { if (!x.avant || !x.avant.isQuaternion) { x.avant = new THREE.Quaternion(); x.apres = new THREE.Quaternion(); } x.avant.copy(os.quaternion); }
    this.poses.push(x);
    return x;
  }
  /** Tourne `os` d'une rotation `r` donnée dans le repère du personnage ; `parent` : orientation du parent dans ce repère. */
  _tourner(e, os, parent, r) {
    const x = this._memo(e, os);
    qA.copy(parent).invert().multiply(r).multiply(parent);     // la rotation dans le repère du parent
    os.quaternion.premultiply(qA);
    x.apres.copy(os.quaternion);
  }

  /** Après le mélangeur : pose les décalages de l'image. `vivants` : les personnages de la troupe ; `dt` en secondes. */
  apres(vivants, dt) {
    if (!this.actif || !(dt > 0)) return;
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    this.temps += dt;
    const t = this.temps, actifs = [];
    // 1) où est chacun, qui bouge
    for (const p of vivants) {
      const e = this._etat(p);
      if (!e) continue;
      const m = p.objet.matrixWorld.elements;
      const x = m[12], y = m[13], z = m[14];
      if (e.vu) { const v = Math.hypot(x - e.pos.x, z - e.pos.z) / dt; e.vit += (Math.min(v, 8) - e.vit) * Math.min(1, dt * 8); }
      e.pos.set(x, y, z); e.vu = true;
      e.lacetMonde = Math.atan2(m[8], m[10]);
      e.p = p; e.porteur = p.objet.parent || p.objet;
      actifs.push(e);
    }
    this._n = actifs.length;
    // 2) à qui chacun prête attention
    for (const e of actifs) {
      const r = e.regard, fixe = this.fixes.get(e.porteur);
      let cible = null, haut = 0;
      if (fixe) {
        if (fixe.isObject3D) { const autre = actifs.find((o) => o.porteur === fixe); if (autre) { cible = autre.pos; haut = (autre.p.hauteur || 1.7) * 0.93; } else { cible = fixe.position; haut = 1.55; } }
        else { cible = fixe; haut = 0; }
        r.attention = MEMOIRE;
      } else {
        let mieux = null, note = 0;
        for (const o of actifs) {
          if (o === e) continue;
          const d = Math.hypot(o.pos.x - e.pos.x, o.pos.z - e.pos.z);
          if (d > PORTEE || d < 0.25) continue;
          const bouge = o.vit > 0.35, heros = o.porteur.userData && o.porteur.userData.role === 'heros';
          if (!bouge && !(heros && d < PROCHE) && o !== r.cible) continue;
          const n = (bouge ? 2 : 0) + (heros ? 1.2 : 0) + (o === r.cible ? 0.6 : 0) + 1 / (1 + d);
          if (n > note) { note = n; mieux = o; }
        }
        if (mieux && (mieux.vit > 0.35 || mieux !== r.cible || (mieux.porteur.userData && mieux.porteur.userData.role === 'heros' && Math.hypot(mieux.pos.x - e.pos.x, mieux.pos.z - e.pos.z) < PROCHE))) { r.cible = mieux; r.attention = MEMOIRE; }
        else r.attention -= dt;
        if (r.attention > 0 && r.cible && r.cible.p && r.cible.vu) { cible = r.cible.pos; haut = (r.cible.p.hauteur || 1.7) * 0.93; } else r.cible = null;
      }
      // direction voulue, dans le repère du personnage (lacet autour de Y, tangage positif vers le bas)
      let lacet = 0, tangage = 0, poids = 0;
      if (cible) {
        const dx = cible.x - e.pos.x, dz = cible.z - e.pos.z, dy = (cible.y + haut) - (e.pos.y + (e.p.hauteur || 1.7) * 0.93);
        const dist = Math.hypot(dx, dz);
        const a = tour(Math.atan2(dx, dz) - e.lacetMonde);
        r.engage = Math.abs(a) < (r.engage ? LIMITES.derriere + 12 * RAD : LIMITES.derriere) && dist > 0.2;
        if (r.engage) { lacet = a; tangage = -Math.atan2(dy, Math.max(0.3, dist)); poids = 1; }
      } else r.engage = false;
      r.voulu = lacet; r.vouluT = tangage; r.poidsVoulu = poids;
    }
    // 3) les os
    for (const e of actifs) this._animer(e, dt, t);
    if (t0) { this._ms += performance.now() - t0; this._images++; }
  }

  _animer(e, dt, t) {
    const p = e.p, sq = e.sq, r = e.regard;
    e.nMem = 0;
    if (p._rester) { e.vRegard.set(0, 0, p._rester ? 1 : 0); return; }       // à terre : ni souffle ni regard, paupières closes
    const etat = p.etat, enGeste = !!p.geste, marche = !!p.enMarche || MARCHE.test(etat || '');
    const k = Math.min(1, dt * 3);
    e.debout += ((!marche && !enGeste && !AU_SOL.test(etat || '') ? (GARDE.test(etat || '') ? 0.4 : 1) : 0) - e.debout) * k;
    e.mobile += ((marche ? 1 : 0) - e.mobile) * k;
    const ech = (p.hauteur || 1.75) / 1.75;
    // ---- respiration (essoufflement : il monte à la course, retombe en une dizaine de secondes)
    const s = e.souffle;
    s.effort = borne(s.effort + (etat === 'course' ? dt / 4 : -dt / 9), 0, 1);
    s.phase += dt * 6.283 / (s.periode / (1 + 1.1 * s.effort));
    const onde = Math.sin(s.phase + 0.45 * Math.sin(s.phase));              // inspiration plus vive que l'expiration
    const ampl = (1 + 1.4 * s.effort) * (1 - 0.45 * e.mobile);
    const buste = -0.95 * RAD * onde * ampl, epaules = 0.9 * RAD * Math.max(-0.3, onde) * ampl;
    // ---- appuis
    const ap = e.appui, w = e.debout;
    const u = Math.tanh(2.4 * Math.sin(t * 6.283 / ap.periode + ap.phase)) * 1.0164 * ap.sens;     // tient d'un côté, puis passe de l'autre
    const u2 = Math.sin(t * 6.283 / ap.periode2 + ap.phase * 1.7);
    const deport = 0.017 * ech * u * w, roulis = 1.5 * RAD * u * w, torsion = 1.3 * RAD * u2 * w;
    // ---- regard : amortissement critique vers la direction voulue
    const lim = LIMITES, mob = 1 - 0.45 * e.mobile, gest = enGeste ? 0.35 : 1;
    r.poids += (r.poidsVoulu * mob * gest - r.poids) * Math.min(1, dt * 4);
    const der = e.derive;
    const dL = (1.4 * Math.sin(t * 6.283 / der.p1 + der.ph) + 0.8 * Math.sin(t * 6.283 / der.p2)) * RAD * (1 - 0.6 * r.poids) * (0.4 + 0.6 * w);   // tête jamais figée
    const dT = 0.9 * Math.sin(t * 6.283 / der.p2 + der.ph * 2.3) * RAD * (1 - 0.6 * r.poids) * (0.4 + 0.6 * w);
    const butL = borne(r.voulu, -lim.lacet, lim.lacet) * r.poids, butT = borne(r.vouluT, -lim.haut, lim.bas) * r.poids;
    const om = 5.5, f = 1 + 2 * dt * om, om2 = om * om * dt;
    r.vl = (r.vl + om2 * (butL - r.lacet)) / (f + om2 * dt); r.lacet += r.vl * dt;
    r.vt = (r.vt + om2 * (butT - r.tangage)) / (f + om2 * dt); r.tangage += r.vt * dt;
    const L = r.lacet + dL, T = r.tangage + dT;
    // ---- yeux : ils devancent la tête, saccadent, clignent
    const o = e.oeil;
    if (e.yeux.nuanceur.length || e.yeux.cles.length || sq.oeilG) {
      o.prochaine -= dt;
      if (o.prochaine <= 0) { o.graine = (Math.imul(o.graine, 1664525) + 1013904223) >>> 0; const a = o.graine / 4294967296; o.graine = (Math.imul(o.graine, 1664525) + 1013904223) >>> 0; const b = o.graine / 4294967296;
        o.sl = (a - 0.5) * 5 * RAD * (r.poids > 0.5 ? 0.7 : 1.6); o.st = (b - 0.5) * 3 * RAD; o.prochaine = 0.6 + 2.2 * a; }
      const resteL = borne((r.poidsVoulu ? borne(r.voulu, -lim.lacet - lim.yeuxLacet, lim.lacet + lim.yeuxLacet) * Math.min(1, r.poids * 1.6) : 0) - r.lacet, -lim.yeuxLacet, lim.yeuxLacet);
      const resteT = borne((r.poidsVoulu ? r.vouluT * Math.min(1, r.poids * 1.6) : 0) - r.tangage, -lim.yeuxTangage, lim.yeuxTangage);
      const avantL = o.lacet, ky = Math.min(1, dt * 22);
      o.lacet += (resteL + o.sl - o.lacet) * ky; o.tangage += (resteT + o.st - o.tangage) * ky;
      o.prochainClin -= dt;
      if (o.clin < 0 && (o.prochainClin <= 0 || Math.abs(o.lacet - avantL) > 9 * RAD)) { o.clin = 0; o.graine = (Math.imul(o.graine, 1664525) + 1013904223) >>> 0; o.prochainClin = 2.4 + 4.2 * (o.graine / 4294967296); }
      if (o.clin >= 0) { o.clin += dt; o.paupiere = o.clin < 0.06 ? o.clin / 0.06 : Math.max(0, 1 - (o.clin - 0.06) / 0.1); if (o.clin > 0.16) { o.clin = -1; o.paupiere = 0; } }
      e.vRegard.set(o.lacet, o.tangage, o.paupiere);
      for (const m of e.yeux.cles) {
        const d = m.morphTargetDictionary, inf = m.morphTargetInfluences, poser = (nom, v) => { if (d[nom] !== undefined) inf[d[nom]] = borne(v, 0, 1); };
        poser('clignement', o.paupiere); poser('clignement_g', o.paupiere); poser('clignement_d', o.paupiere);
        poser('regard_gauche', o.lacet / (30 * RAD)); poser('regard_droite', -o.lacet / (30 * RAD)); poser('regard_bas', o.tangage / (20 * RAD)); poser('regard_haut', -o.tangage / (20 * RAD));
      }
    }
    // ---- pose des décalages, du bassin vers la tête (qP : orientation du parent dans le repère du personnage)
    qP.identity();
    for (let i = 0; i < sq.amont.length; i++) qP.multiply(sq.amont[i].quaternion);
    if (w > 0.002) {
      const x = this._memo(e, sq.bassin, true);
      v1.set(deport * e.echAmont, 0, 0).applyQuaternion(qB.copy(qP).invert());
      sq.bassin.position.add(v1); x.apres.copy(sq.bassin.position);
      this._tourner(e, sq.bassin, qP, qR.setFromEuler(eul.set(0, 0, roulis)));
    }
    qB.copy(qP).multiply(sq.bassin.quaternion);               // le bassin, décalé, dans le repère du personnage
    if (w > 0.002) {
      const comp = qR.setFromEuler(eul.set(0, 0, -roulis - deport / (0.5 * (p.hauteur || 1.75))));     // les pieds restent en place
      this._tourner(e, sq.cuisseG, qB, comp); this._tourner(e, sq.cuisseD, qB, comp);
    }
    qP.copy(qB);
    const n = sq.colonne.length;
    for (let i = 0; i < n; i++) {
      const os = sq.colonne[i];
      let tang = 0, lac = 0, roul = 0;
      if (os === sq.lombes) { roul -= roulis * 0.65; lac += torsion * 0.5; }
      if (os === sq.dos) { tang += buste * 0.4; }
      if (os === sq.buste) { tang += buste + T * 0.12; lac += L * 0.14 * (1 - e.mobile) + torsion * 0.5; roul -= roulis * 0.35; }
      if (os === sq.cou) { tang += -buste * 1.25 + T * 0.38; lac += L * 0.36; }
      if (os === sq.tete) { tang += T * 0.5; lac += L * 0.5; roul += L * 0.06; }                        // la tête penche un peu en tournant
      if (tang || lac || roul) this._tourner(e, os, qP, qR.setFromEuler(eul.set(tang, lac, roul)));
      if (os === sq.buste && Math.abs(epaules) > 1e-5) {
        qB.copy(qP).multiply(os.quaternion);
        this._tourner(e, sq.epauleG, qB, qR.setFromEuler(eul.set(0, 0, epaules)));
        this._tourner(e, sq.epauleD, qB, qR.setFromEuler(eul.set(0, 0, -epaules)));
      }
      qP.multiply(os.quaternion);
    }
    if (sq.oeilG && sq.oeilD) {                                // os d'yeux (têtes à venir) : qP est maintenant la tête
      const rot = qR.setFromEuler(eul.set(o.tangage, o.lacet, 0));
      this._tourner(e, sq.oeilG, qP, rot); this._tourner(e, sq.oeilD, qP, rot);
    }
  }
}
