// Oricourt, l'an 1435 — contenu du jeu (personnages, dialogues, questions).
// Tout ce fichier se modifie sans toucher au moteur : textes, questions, positions.
// Les personnages sont inventés ; les faits qu'ils racontent sont ceux des fascicules et de l'histoire médiévale générale.
// Positions en mètres dans le repère de la maquette (x = est, y = nord, origine = haute-cour).

export const INTRO = {
  titre: "Le brouillard du puits",
  texte: [
    "Pendant la visite, tu t'es penché au-dessus de la margelle du vieux puits. Une brume froide est montée du fond, a rempli la galerie, puis toute la cour…",
    "Quand elle se dissipe, les murs ont retrouvé leurs créneaux, les tours leurs toits. Des poules courent dans la basse-cour. Nous sommes à l'automne de l'an 1435.",
    "Un brouillard étrange encercle le château : impossible de s'éloigner. Pour rentrer chez toi, il faut comprendre ce monde. Parle aux habitants : chacun te confiera un savoir et te posera une question. Gagne leurs neuf sceaux, puis reviens au puits.",
  ],
  bouton: "Entrer dans l'an 1435",
};

export const FIN = {
  titre: "Le retour",
  texte: [
    "Les neuf sceaux brillent dans ton carnet. Au fond du puits, la brume remonte, tiède cette fois.",
    "Tu sais maintenant qui vit ici, qui commande, qui travaille, ce qu'on mange, comment on se défend et comment on compte le temps. Le brouillard te laisse passer.",
    "Quand il se lève, le guide est en train de dire : « … et voici le puits, profond de vingt-deux mètres. » Tu souris. Tu le savais déjà.",
  ],
  bouton: "Revenir aujourd'hui",
};

export const CENTRE_BROUILLARD = [14, -30];
export const RAYON_BROUILLARD = 100;
export const DEPART = [-6, -6, 30];       // x, y, cap en degrés
export const POINT_RETOUR = 'puits';

// tenue : couleurs de la cotte, des chausses, de la coiffe ; coiffe : 'chaperon' | 'coiffe' | 'chapeau' | 'casque' | 'tonsure' | 'bonnet'
export const PERSONNAGES = [
  {
    id: 'guillemette', nom: 'Guillemette', role: 'servante du logis', pos: [-2, -4],
    studio: { sexe: 'F', pieces: ['tunique', 'chausses', 'bottes', 'ceinture', 'coupe_mi_longue'], teintes: { etoffe: '#7d8a5c', blason: '#d9d2bf', laine: '#5a4a3a', cuir: '#5a3e26', cheveux: '#6b4a2c' }, coiffes: ['coiffe'], couleurCoiffe: 0xeee8d8 },
    activite: { fond: 'attendre', gestes: ['saluer', 'designer', 'oui', 's_etirer'], periode: [7, 15] },
    tenue: { cotte: 0x7a8c5a, chausses: 0x5a4a3a, coiffe: 'coiffe', couleurCoiffe: 0xe8e2d2, tablier: 0xd9d2bf },
    accueil: "Sainte Vierge ! D'où sors-tu, avec ces drôles de braies ? Tu es tombé du brouillard, toi aussi… Ne crains rien. Ici, c'est Oricourt, en comté de Bourgogne. Je vais t'expliquer.",
    sujets: [
      { q: "Où suis-je ? En quelle année ?", r: "À Oricourt, pardi ! L'an de grâce 1435. Notre prince est Philippe, duc et comte de Bourgogne, qu'on appelle « le Bon ». Le château, lui, est bien plus vieux : il a plus de deux cent cinquante ans." },
      { q: "Qui habite ici ?", r: "Une trentaine de personnes : l'intendant, des gardes, le clerc, la cuisinière, les valets, les servantes comme moi. Le seigneur, lui, n'est presque jamais là. Dans la basse-cour vivent les bêtes et ceux qui les soignent." },
      { q: "Comment rentrer chez moi ?", r: "Les anciens disent que le brouillard du puits rend ceux qui ont compris. Va parler aux gens du château : chacun te donnera son sceau si tu réponds bien à sa question. Avec les neuf sceaux, reviens au puits, sous la galerie." },
    ],
    question: { texte: "Le château d'Oricourt est partagé en deux cours. Laquelle abrite le logis du seigneur, le puits et les réserves ?", choix: ["La basse-cour", "La haute-cour", "Le fossé"], bonne: 1,
      explication: "La haute-cour est le cœur protégé : logis, puits, four, caves. La basse-cour abrite les granges, les écuries et les bêtes." },
    savoir: "Oricourt a deux cours : la basse-cour (granges, bêtes, récoltes) et la haute-cour (logis, puits, réserves), mieux défendue.",
  },
  {
    id: 'aubert', nom: 'Maître Aubert', role: 'intendant du seigneur', pos: [8.5, -3],
    studio: { sexe: 'M', pieces: ['tunique', 'surcot', 'chausses', 'bottes', 'ceinture', 'bourse', 'coupe_courte', 'barbe'], teintes: { etoffe: '#3a3f5a', blason: '#5a2430', laine: '#2c2a33', cuir: '#3a2a1c', cheveux: '#8a8478' }, coiffes: ['chaperon'], couleurCoiffe: 0x2f3f5a },
    activite: { fond: 'attendre', gestes: ['designer', 'hausser_epaules', 'non', 'oui'], periode: [8, 18] },
    tenue: { cotte: 0x5a2f3a, chausses: 0x2c2a33, coiffe: 'chaperon', couleurCoiffe: 0x2f3f5a, longue: true },
    accueil: "Halte. Je suis Aubert, intendant de ce château. Je tiens les comptes, je fais rentrer les redevances et je réponds de tout devant mon maître. Que veux-tu savoir ?",
    sujets: [
      { q: "Qui est le seigneur d'Oricourt ?", r: "Depuis cette année même, c'est messire Nicolas Rolin, chancelier du duc de Bourgogne : l'homme le plus puissant du duché après le duc. Il a acheté la seigneurie. Avant lui, elle était aux Blâmont." },
      { q: "Pourquoi n'est-il pas là ?", r: "Un chancelier suit le duc, de Dijon à Bruges. Il possède bien d'autres terres. C'est pourquoi il lui faut un intendant : je gouverne le domaine en son nom, et je lui écris." },
      { q: "Que doivent les paysans ?", r: "Une part de leurs récoltes, des journées de travail sur les terres du seigneur, qu'on nomme corvées, et des taxes pour le four et le moulin. En échange, le seigneur doit protection et justice." },
    ],
    question: { texte: "En 1435, qui devient seigneur d'Oricourt ?", choix: ["Nicolas Rolin, chancelier du duc de Bourgogne", "Le roi de France en personne", "Un riche paysan du village"], bonne: 0,
      explication: "Nicolas Rolin acquiert Oricourt en 1435. Il fondera plus tard les Hospices de Beaune (1443), mais cela, Maître Aubert ne peut pas encore le savoir !" },
    savoir: "En 1435, Nicolas Rolin, chancelier du duc de Bourgogne Philippe le Bon, devient seigneur d'Oricourt. Un intendant gère le domaine en son absence.",
  },
  {
    id: 'mahaut', nom: 'Mahaut', role: 'cuisinière', pos: 'galerie',
    studio: { sexe: 'F', pieces: ['tunique', 'chausses', 'bottes', 'ceinture', 'coupe_mi_longue'], teintes: { etoffe: '#8a5a3a', blason: '#e6dfcc', laine: '#4a3a2a', cuir: '#4a3220', cheveux: '#3a2a1c' }, coiffes: ['coiffe'], couleurCoiffe: 0xf0ead8 },
    activite: { fond: 'attendre', gestes: ['se_rechauffer', 'ranger', 'oui', 'designer'], periode: [6, 13] },
    tenue: { cotte: 0x8a5a3a, chausses: 0x4a3a2a, coiffe: 'coiffe', couleurCoiffe: 0xf0ead8, tablier: 0xe6dfcc },
    accueil: "Ôte-toi de mon seau ! Ah… tu n'es pas d'ici. Je suis Mahaut, je règne sur la grande cuisine. Et ce puits, c'est mon trésor.",
    sujets: [
      { q: "Pourquoi le puits est-il si important ?", r: "Vingt-deux mètres de profond, creusés dans le roc ! Sans eau, pas de soupe, pas de pain, pas de bêtes… et pas de siège tenu. Si l'ennemi encercle le château, on vit sur le puits et sur les réserves." },
      { q: "Que mange-t-on ici ?", r: "Du pain, surtout, et du potage : pois, fèves, choux, raves, avec du lard quand ce n'est pas jour maigre. Les maîtres ont du gibier, du poisson et des épices venues de très loin, qui coûtent une fortune." },
      { q: "C'est quoi, un jour maigre ?", r: "Le vendredi et tout le Carême, l'Église défend la viande. Alors on sert du poisson, des œufs, des légumes. Cela fait bien des jours dans l'année !" },
    ],
    question: { texte: "Lequel de ces aliments Mahaut ne peut PAS cuisiner en 1435 ?", choix: ["Des pois au lard", "Des pommes de terre", "Du pain de seigle"], bonne: 1,
      explication: "La pomme de terre vient d'Amérique, que les Européens n'atteindront qu'en 1492. Pas de tomates, de maïs ni de chocolat non plus !" },
    savoir: "Le puits (22 m) permet de tenir un siège. On mange surtout du pain et du potage ; pas de viande les jours maigres ; aucun aliment venu d'Amérique.",
  },
  {
    id: 'etienne', nom: 'Frère Étienne', role: 'clerc', pos: [8.5, -13.5],
    studio: { sexe: 'M', pieces: ['tunique', 'surcot', 'chausses', 'bottes', 'ceinture', 'coupe_courte'], teintes: { etoffe: '#4a3f36', blason: '#3a302a', laine: '#3a302a', cuir: '#3a2a1c', cheveux: '#5a4030' }, coiffes: ['tonsure'], objet: 'livre' },
    activite: { fond: 'ecouter', gestes: ['prier', 'perplexe', 'oui'], periode: [10, 20] },
    tenue: { cotte: 0x4a3f36, chausses: 0x3a302a, coiffe: 'tonsure', couleurCoiffe: 0x6b4a2f, longue: true },
    accueil: "La paix soit avec toi, enfant. Je suis Étienne. J'écris les lettres de l'intendant et je tiens le livre des comptes, car bien peu de gens ici savent lire.",
    sujets: [
      { q: "Tout le monde ne sait pas lire ?", r: "Oh non ! Les paysans, les gardes, presque personne. On apprend chez les religieux ou dans les écoles des villes. Et les livres sont rares : on les copie à la main, sur du parchemin, qui est de la peau de bête." },
      { q: "Comment savez-vous l'heure ?", r: "Par le soleil et par les cloches. Elles sonnent les heures de la prière, du lever au coucher du jour. Personne n'a d'horloge sur soi : on se lève avec le jour, on se couche avec la nuit." },
      { q: "Avec quelle monnaie compte-t-on ?", r: "En livres, sous et deniers. Douze deniers font un sou, vingt sous font une livre. Mais au village, on paie souvent en grain, en poules ou en journées de travail." },
    ],
    question: { texte: "Sur quoi Frère Étienne écrit-il ses comptes ?", choix: ["Sur du papier imprimé", "Sur du parchemin, fait de peau animale", "Sur une ardoise magique"], bonne: 1,
      explication: "On écrit à la plume sur du parchemin. Le papier commence à se répandre, mais l'imprimerie n'arrivera en Europe que vers 1450." },
    savoir: "Très peu de gens savent lire. On écrit à la main sur du parchemin ; le temps se compte au soleil et aux cloches ; 1 livre = 20 sous = 240 deniers.",
  },
  {
    id: 'perrin', nom: 'Perrin', role: 'guetteur de la tour', pos: [2, -24],
    studio: { sexe: 'M', pieces: ['gambison', 'chausses', 'bottes', 'ceinture_large', 'coupe_courte'], teintes: { etoffe: '#6a6450', cuir: '#4a3220', laine: '#3b3b3b', cheveux: '#4a3220' }, coiffes: ['chapel'], objet: 'lance' },
    activite: { fond: 'guetter', gestes: ['guetter', 's_etirer', 'souffler'], periode: [8, 16] },
    tenue: { cotte: 0x55606a, chausses: 0x3b3b3b, coiffe: 'casque', couleurCoiffe: 0x8b9096, arme: 'lance' },
    accueil: "Qui va là ? … Un enfant. Je suis Perrin, guetteur. Je passe mes journées là-haut, à vingt-cinq mètres, à regarder les chemins.",
    sujets: [
      { q: "À quoi sert cette grande tour ?", r: "À voir et à tenir. De là-haut, je surveille les deux cours, les fossés et tout le pays. Voir l'ennemi de loin, c'est gagner du temps pour fermer les portes et rentrer les bêtes." },
      { q: "Par où entre-t-on dedans ?", r: "Par une porte perchée à huit mètres du sol ! On y monte par une échelle qu'on retire en cas de danger. Les murs ont plus de deux mètres d'épaisseur : une vraie boîte de pierre." },
      { q: "Et ces galeries de bois, tout en haut ?", r: "Ce sont les hourds. Ils avancent au-dessus du vide : par des trous dans le plancher, on surveille le pied du mur et on jette des pierres sur ceux qui voudraient le saper." },
    ],
    question: { texte: "Pourquoi la porte de la tour maîtresse est-elle à 8 mètres du sol ?", choix: ["Pour faire joli", "Pour que l'ennemi ne puisse pas entrer facilement : on retire l'échelle", "Parce que le sol s'est affaissé"], bonne: 1,
      explication: "Une entrée haute, avec une échelle amovible, rend la tour presque imprenable : c'est le dernier refuge." },
    savoir: "La tour maîtresse (≈ 25 m) sert à surveiller et à résister : porte à 8 m avec échelle amovible, murs de plus de 2 m, hourds de bois au sommet.",
  },
  {
    id: 'girard', nom: 'Girard', role: 'maître maçon', pos: [-19, -5],
    studio: { sexe: 'M', pieces: ['tunique', 'chausses', 'bottes', 'ceinture', 'bourse', 'coupe_courte', 'barbe'], teintes: { etoffe: '#9a8a6a', blason: '#6a5a48', laine: '#5a5040', cuir: '#5a3e26', cheveux: '#6b5a48' }, coiffes: ['bonnet'], couleurCoiffe: 0x7a4a3a, objet: 'marteau' },
    activite: { fond: 'attendre_fort', gestes: ['travailler', 'forger', 'designer', 'souffler'], periode: [5, 11] },
    tenue: { cotte: 0x9a8a6a, chausses: 0x5a5040, coiffe: 'bonnet', couleurCoiffe: 0x7a4a3a, tablier: 0x6a5a48, arme: 'marteau' },
    accueil: "Attention aux pierres ! Girard, maçon. J'entretiens les murailles. Elles sont vieilles, tu sais : les premières ont été montées du temps du sire Gaucher, il y a plus de deux cent cinquante ans.",
    sujets: [
      { q: "D'où vient toute cette pierre ?", r: "Du fossé ! En le creusant dans le calcaire, les anciens ont fait d'une pierre deux coups : un obstacle pour l'ennemi, et une carrière pour bâtir le mur juste à côté." },
      { q: "Pourquoi le haut du mur est-il plus clair ?", r: "Bien vu ! En bas, les gros blocs jaunes sont les plus anciens. Plus tard, on a rehaussé le mur de trois mètres, avec des pierres plus petites et plus claires. On voit encore les vieux créneaux pris dans la maçonnerie." },
      { q: "À quoi servent les tours carrées ?", r: "À flanquer les courtines : depuis la tour, on tire le long du mur. Les tours carrées sont simples à bâtir, mais leurs angles sont fragiles. Ailleurs, on fait maintenant des tours rondes." },
    ],
    question: { texte: "D'où vient la pierre des murailles d'Oricourt ?", choix: ["D'une carrière à cent lieues d'ici", "Du fossé creusé au pied des murs", "De la rivière"], bonne: 1,
      explication: "Le fossé est à la fois une défense et une carrière : ce qu'on enlève devient muraille." },
    savoir: "Le fossé a servi de carrière. La courtine a été rehaussée : gros blocs ocre en bas (XIIe siècle), petites pierres claires en haut, anciens créneaux visibles.",
  },
  {
    id: 'huguenin', nom: 'Huguenin', role: 'garde de la porte', pos: 'porte',
    studio: { sexe: 'M', pieces: ['haubert', 'surcot', 'chausses', 'bottes', 'ceinture_large', 'coupe_courte', 'barbe'], teintes: { blason: '#7a2a24', etoffe: '#d9c48a', laine: '#33312e', cuir: '#3a2a1c', cheveux: '#2e2218', metal: '#a8acb0' }, coiffes: ['chapel'], objet: 'lance' },
    activite: { fond: 'attendre_fort', gestes: ['guetter', 's_etirer', 'attendre_agite'], periode: [9, 18] },
    tenue: { cotte: 0x6a2f2a, chausses: 0x33312e, coiffe: 'casque', couleurCoiffe: 0x8b9096, arme: 'lance' },
    accueil: "On ne passe pas sans montrer patte blanche ! Huguenin, garde de la porte. Par les temps qui courent, je ne laisse entrer que ceux que je connais.",
    sujets: [
      { q: "De quoi avez-vous peur ?", r: "Des Écorcheurs ! Des bandes de soldats sans solde qui pillent les campagnes depuis que les princes ont fait la paix. Ils prennent tout, jusqu'à la chemise. Quand ils approchent, les paysans se réfugient ici avec leurs bêtes." },
      { q: "Comment défend-on le château ?", r: "Par étapes. D'abord le fossé et la première enceinte. Si la basse-cour tombe, il reste cette porte, son pont-levis, et la haute-cour. Et enfin la tour. Chaque mètre coûte cher à l'ennemi." },
      { q: "Quelles sont vos armes ?", r: "La vouge, cette lame au bout d'une hampe, l'arbalète pour tirer des murs, et l'épée pour les hommes d'armes. On commence à voir des canons, aussi… et ça, les vieux murs n'aiment pas." },
    ],
    question: { texte: "Que se passe-t-il si des ennemis prennent la basse-cour ?", choix: ["Le château est perdu", "Les défenseurs se replient dans la haute-cour, puis dans la tour", "Tout le monde s'enfuit par le puits"], bonne: 1,
      explication: "C'est la défense en profondeur : plusieurs obstacles successifs, du fossé jusqu'à la tour maîtresse." },
    savoir: "Défense en profondeur : fossé, basse-cour, porte à pont-levis, haute-cour, tour. Vers 1435, les Écorcheurs ravagent les campagnes ; les paysans se réfugient au château.",
  },
  {
    id: 'jehanne', nom: 'Jehanne', role: 'paysanne', pos: [36, -28],
    studio: { sexe: 'F', pieces: ['tunique', 'chausses', 'bottes', 'ceinture', 'coupe_longue'], teintes: { etoffe: '#4f6a7a', blason: '#b8aa8a', laine: '#5a4a3a', cuir: '#5a3e26', cheveux: '#8a5a2c' }, coiffes: ['coiffe'], couleurCoiffe: 0xd9d2bf, objet: 'panier' },
    activite: { fond: 'attendre', gestes: ['recolter', 'ramasser', 'saluer'], periode: [6, 13] },
    tenue: { cotte: 0x4f6a7a, chausses: 0x5a4a3a, coiffe: 'coiffe', couleurCoiffe: 0xd9d2bf, tablier: 0xb8aa8a },
    accueil: "Petit, petit, petit… Oh ! Tu m'as fait peur. Je suis Jehanne. J'apporte les poules de la redevance, et je repars avec moins que je ne suis venue, comme toujours.",
    sujets: [
      { q: "À quoi ressemble ta journée ?", r: "Debout avant le jour. Les bêtes, le potager, les champs, filer la laine le soir. Toute la famille travaille, les enfants aussi : dès sept ou huit ans, on garde les oies ou les moutons." },
      { q: "Que donnes-tu au seigneur ?", r: "Du grain après la moisson, des poules, des œufs, et des journées de corvée sur ses terres. Et le prêtre prend la dîme : une part de la récolte. Il nous reste de quoi tenir l'hiver, si l'année est bonne." },
      { q: "Où habites-tu ?", r: "Dans une maison de bois et de torchis, avec un toit de chaume, au pied du château. Une seule pièce, le feu au milieu, et les bêtes juste à côté : elles tiennent chaud l'hiver !" },
    ],
    question: { texte: "Qu'est-ce qu'une corvée ?", choix: ["Une fête du village", "Des journées de travail gratuit dues au seigneur", "Une sorte de pain"], bonne: 1,
      explication: "Les paysans doivent au seigneur une part de leurs récoltes et des journées de travail : les corvées." },
    savoir: "Les paysans travaillent du lever au coucher du soleil, enfants compris. Ils doivent des redevances, des corvées au seigneur et la dîme à l'Église. Maisons de torchis et de chaume.",
  },
  {
    id: 'colin', nom: 'Colin', role: 'gardien du colombier', pos: 'colombier',
    studio: { sexe: 'M', pieces: ['tunique', 'chausses', 'bottes', 'ceinture', 'coupe_mi_longue'], teintes: { etoffe: '#7a6a3a', blason: '#5a4a30', laine: '#4a4030', cuir: '#5a3e26', cheveux: '#9a7a4a' }, coiffes: ['chapeau'], couleurCoiffe: 0xc9b06a },
    activite: { fond: 'attendre', gestes: ['designer', 'perplexe', 'rire'], periode: [8, 16] },
    tenue: { cotte: 0x7a6a3a, chausses: 0x4a4030, coiffe: 'chapeau', couleurCoiffe: 0xc9b06a },
    accueil: "Chut, tu vas effrayer mes pigeons ! Je suis Colin. Ce colombier, c'est l'orgueil du seigneur… et le malheur des laboureurs.",
    sujets: [
      { q: "Pourquoi élever des pigeons ?", r: "Pour la table du seigneur, d'abord : le pigeonneau est un mets fin. Et pour leur fiente, la colombine : le meilleur engrais qui soit pour les jardins et les vignes." },
      { q: "Tout le monde peut avoir un colombier ?", r: "Que non ! Une grande tour à pigeons comme celle-ci est un privilège de seigneur. Plus elle a de nids, plus on montre qu'on possède de terres." },
      { q: "Pourquoi « le malheur des laboureurs » ?", r: "Parce que mes pigeons vont manger les semences dans les champs des paysans… qui n'ont pas le droit de les chasser. Entre donc voir les nids : on les appelle des boulins." },
    ],
    question: { texte: "Avoir un grand colombier, au Moyen Âge, c'est…", choix: ["Un privilège réservé au seigneur", "Une obligation pour chaque paysan", "Interdit par l'Église"], bonne: 0,
      explication: "Le droit de colombier est un privilège seigneurial : il montre la richesse en terres. Les pigeons, eux, se servaient dans les champs des paysans." },
    savoir: "Le colombier est un privilège du seigneur. Les pigeons fournissent viande et engrais (la colombine) ; leurs nids s'appellent des boulins.",
  },
];

// figurines de secours (formes simples) tant que les modèles du Studio se chargent : [type, x, y, rayon]
export const ANIMAUX = [
  ['poule', 34, -30, 3], ['poule', 37, -26, 3], ['poule', 39, -31, 2.5], ['poule', 33, -25, 2], ['poule', 41, -27, 3], ['coq', 36, -32, 2],
  ['cochon', 44, -36, 3], ['cochon', 47, -33, 2.5], ['chevre', 28, -38, 4], ['chevre', 31, -41, 3], ['oie', 22, -52, 4], ['oie', 25, -55, 3], ['oie', 20, -56, 3],
];

// bêtes animées du Studio : [espèce, x, y, rayon de promenade, robe, échelle]
export const BETES = [
  ['poule', 34, -30, 4, 'rousse'], ['poule', 37, -26, 4, 'blanche'], ['poule', 39, -31, 3.5, 'fauve'], ['poule', 33, -25, 3, 'noire'], ['poule', 41, -27, 4, 'rousse'], ['poule', 36, -32, 3, 'fauve', 1.15],
  ['cochon', 44, -36, 3.5, 'rose'], ['cochon', 47, -33, 3, 'pie'], ['chevre', 28, -38, 5, 'chamoisee'], ['chevre', 31, -41, 4, 'blanche'],
  ['canard', 22, -52, 4], ['canard', 25, -55, 3.5], ['canard', 20, -56, 3.5],
  ['cheval', 42, -22, 3, 'bai'], ['vache', 52, -48, 6, 'pie_rousse'], ['vache', 58, -52, 6, 'froment'],
  ['mouton', 64, -66, 7, 'blanc'], ['mouton', 61, -70, 7, 'ecru'], ['mouton', 67, -71, 7, 'blanc'], ['mouton', 59, -64, 7, 'noir'],
  ['chien', 18, -21, 5, 'fauve'], ['chat', 3, 0, 4, 'roux'],
];

// figurants : habitants sans dialogue, qui vaquent à leurs occupations (chemin = ronde à pied)
export const FIGURANTS = [
  { id: 'palefrenier', pos: [39, -20], studio: { sexe: 'M', pieces: ['tunique', 'chausses', 'bottes', 'ceinture', 'coupe_courte'], teintes: { etoffe: '#6a5a3a', laine: '#3a3328', cuir: '#4a3220', cheveux: '#3a2a1c' }, coiffes: ['bonnet'], couleurCoiffe: 0x5a4a30 },
    activite: { fond: 'attendre', gestes: ['ramasser', 'travailler', 's_etirer'], periode: [5, 10] } },
  { id: 'jardinier', pos: [26, -46], studio: { sexe: 'M', pieces: ['tunique', 'chausses', 'bottes', 'ceinture', 'coupe_mi_longue', 'barbe'], teintes: { etoffe: '#7a7050', laine: '#4a4030', cuir: '#4a3220', cheveux: '#5a4a38' }, coiffes: ['chapeau'] },
    activite: { fond: 'attendre', gestes: ['recolter', 'recolter', 'souffler'], periode: [3, 7] } },
  { id: 'forgeron', pos: [49, -29], studio: { sexe: 'M', pieces: ['tunique', 'chausses', 'bottes', 'ceinture_large', 'coupe_courte', 'barbe'], teintes: { etoffe: '#5a4a3a', laine: '#2e2a26', cuir: '#3a2a1c', cheveux: '#1e1a16' }, objet: 'marteau' },
    activite: { fond: 'attendre_fort', gestes: ['forger', 'forger', 'souffler'], periode: [2.5, 6] } },
  { id: 'porteuse', pos: [-4, -12], studio: { sexe: 'F', pieces: ['tunique', 'chausses', 'bottes', 'ceinture', 'coupe_mi_longue'], teintes: { etoffe: '#8a7a5a', laine: '#4a3a2a', cuir: '#4a3220', cheveux: '#5a3a22' }, coiffes: ['coiffe'] },
    activite: { fond: 'attendre', marche: 'porter', chemin: [[-6, -14], [-9, -3], [-2, 6], [7, 3], [2, -8]] } },
  { id: 'sergent', pos: [24, -32], studio: { sexe: 'M', pieces: ['gambison', 'chausses', 'bottes', 'ceinture_large', 'coupe_courte', 'barbe'], teintes: { etoffe: '#5a5a48', cuir: '#3a2a1c', laine: '#33312e', cheveux: '#3a2a1c' }, coiffes: ['chapel'], objet: 'lance' },
    activite: { fond: 'attendre', marche: 'patrouiller', chemin: [[24, -32], [38, -40], [50, -24], [36, -18]] } },
];

// masures de torchis et de chaume : [x, y, angle en degrés, longueur, largeur]
export const MASURES = [
  [46, -46, 20, 6.5, 4.2], [58, -40, -30, 6, 4], [30, -58, 70, 7, 4.2], [48, -62, 10, 5.5, 3.8], [16, -50, -15, 5, 3.6], [62, -56, 50, 6, 4],
];
