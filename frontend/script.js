/**
 * ============================================================================
 * SNCF DATA PROJECT - MODULE CARTOGRAPHIQUE INTERACTIF
 * ============================================================================
 * Interface Google Maps pour la visualisation du réseau ferroviaire français,
 * des gares de voyageurs, de la fréquentation, et comparateur de trajets.
 *
 * VERSION 4 : matching trajet ↔ lignes par CODE_LIGNE (exact),
 * remplace l'ancien matching géographique approximatif.
 */

// ============================================================================
// SECTION 1 : VARIABLES GLOBALES - MAP & WINDOW
// ============================================================================
let map;
let infoWindow;

// ============================================================================
// SECTION 2 : VARIABLES - DONNÉES RÉSEAU FERRÉ
// ============================================================================
let reseauData;
let reseauDataLoaded = false;
let reseauVisible = false;
let ligneSelectionnee = null;
let listenerClicCarteAttache = false;

// NOUVEAU v4 : ensemble des CODE_LIGNE empruntés par le trajet calculé.
// Le surlignage compare directement le CODE_LIGNE des features, pas leur
// géométrie — c'est exact et instantané.
let codesLignesDuTrajet = new Set();

// ============================================================================
// SECTION 3 : VARIABLES - DONNÉES GARES
// ============================================================================
let toutesLesGares = [];
let marqueursAffiches = [];
let garesDataLoaded = false;
let garesVisible = false;

// ============================================================================
// SECTION 4 : VARIABLES - DONNÉES COMPLÉMENTAIRES
// ============================================================================
let wifiSet = null;
let heatmap = null;
let frequentationVisible = false;
const cacheWikipedia = new Map();

// ============================================================================
// SECTION 5 : VARIABLES - COMPARATEUR DE TARIFS
// ============================================================================
let tarifsVisible = false;
let grapheInitialise = false;
let indexGares = null;
let adjacence = null;
let trajetActuel = null;

// ============================================================================
// SECTION 6 : GESTION RÉSEAU FERRÉ - Styling et Sélection
// ============================================================================

/**
 * Applique les styles aux lignes du réseau.
 * Quatre modes (par ordre de priorité) :
 *   1. Caché : tout invisible
 *   2. Trajet affiché : lignes du trajet en surbrillance orange
 *   3. Ligne sélectionnée (clic) : focus sur une ligne
 *   4. Normal : couleurs SNCF standards
 */
function appliquerStyleReseau() {
    reseauData.setStyle(function(feature) {
        if (!reseauVisible) return { visible: false };

        const estLGV = (feature.getProperty('CATLIG') === 'Ligne à grande vitesse');
        const couleurBase = estLGV ? '#E20074' : '#0055A4';
        const epaisseurBase = estLGV ? 4 : 1.5;

        // ---------- MODE TRAJET AFFICHÉ (v4 : comparaison par CODE_LIGNE) ----------
        if (codesLignesDuTrajet.size > 0) {
            const codeLigne = feature.getProperty('CODE_LIGNE');
            if (codesLignesDuTrajet.has(codeLigne)) {
                return {
                    strokeColor: '#FF6B00',
                    strokeWeight: epaisseurBase + 4,
                    strokeOpacity: 1.0,
                    zIndex: 100,
                    clickable: false,
                    visible: true
                };
            } else {
                return {
                    strokeColor: '#BBBBBB',
                    strokeWeight: epaisseurBase,
                    strokeOpacity: 0.25,
                    zIndex: 1,
                    clickable: false,
                    visible: true
                };
            }
        }

        // ---------- MODE LIGNE SÉLECTIONNÉE ----------
        if (ligneSelectionnee) {
            if (feature === ligneSelectionnee) {
                return {
                    strokeColor: couleurBase,
                    strokeWeight: epaisseurBase + 3,
                    strokeOpacity: 1.0,
                    zIndex: 100,
                    clickable: false,
                    visible: true
                };
            } else {
                return {
                    strokeColor: '#999999',
                    strokeWeight: epaisseurBase,
                    strokeOpacity: 0.3,
                    zIndex: 1,
                    clickable: false,
                    visible: true
                };
            }
        }

        // ---------- MODE NORMAL ----------
        return {
            strokeColor: couleurBase,
            strokeWeight: epaisseurBase,
            strokeOpacity: 0.8,
            zIndex: estLGV ? 10 : 5,
            clickable: false,
            visible: true
        };
    });
}

function selectionnerLigne(feature, latLng) {
    ligneSelectionnee = feature;
    appliquerStyleReseau();

    const typeLigne = feature.getProperty('CATLIG') || 'Inconnu';
    const codeLigne = feature.getProperty('CODE_LIGNE');
    const idLigne = feature.getProperty('LIB_LIGNE') || codeLigne || "Inconnue";
    const estLGV = typeLigne === 'Ligne à grande vitesse';
    const categorie = estLGV ? 'TGV' : 'TER/IC';
    const tarifMoyen = estLGV ? '0,18 €/km' : '0,10 à 0,15 €/km';
    const vitesseMoyenne = estLGV ? '~250 km/h' : '~90 km/h';

    const contenuBulle = `
        <div style="color: #333; font-family: sans-serif; padding: 5px; min-width: 220px;">
            <h3 style="margin: 0 0 8px 0; color: #004696; font-size: 16px;">Ligne ${idLigne}</h3>
            <p style="margin: 4px 0; font-size: 13px;"><strong>Type :</strong> ${typeLigne}</p>
            <hr style="border: 0; border-top: 1px solid #eee; margin: 8px 0;">
            <p style="margin: 4px 0; font-size: 12px;"><strong>Service :</strong> ${categorie}</p>
            <p style="margin: 4px 0; font-size: 12px;"><strong>Tarif moyen :</strong> ${tarifMoyen}</p>
            <p style="margin: 4px 0; font-size: 12px;"><strong>Vitesse commerciale :</strong> ${vitesseMoyenne}</p>
            <p style="margin: 8px 0 0 0; font-size: 11px; color: #888; font-style: italic;">
                Pour un calcul précis entre 2 gares, utilise le Comparateur Tarifs.
            </p>
        </div>
    `;

    infoWindow.setContent(contenuBulle);
    infoWindow.setPosition(latLng);
    infoWindow.open(map);
}

function deselectionnerLigne() {
    if (ligneSelectionnee || infoWindow.getMap()) {
        ligneSelectionnee = null;
        appliquerStyleReseau();
        infoWindow.close();
    }
}

// ============================================================================
// SECTION 7 : CHARGEMENT DES DONNÉES
// ============================================================================

function distancePointSegment(px, py, ax, ay, bx, by) {
    const l2 = Math.pow(ax - bx, 2) + Math.pow(ay - by, 2);
    if (l2 === 0) return Math.sqrt(Math.pow(px - ax, 2) + Math.pow(py - ay, 2));
    const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / l2));
    const projX = ax + t * (bx - ax);
    const projY = ay + t * (by - ay);
    return Math.sqrt(Math.pow(px - projX, 2) + Math.pow(py - projY, 2));
}

function loadLGVLines() {
    if (!reseauDataLoaded) {
        if (typeof reseauGeoJsonData === 'undefined') {
            console.error("Fichier reseau.js manquant.");
            alert("Erreur : reseau.js manquant.");
            return;
        }
        reseauData.addGeoJson(reseauGeoJsonData);
        reseauDataLoaded = true;
    }

    if (!listenerClicCarteAttache) {
        map.addListener('click', function(event) {
            if (!reseauVisible) return;
            if (codesLignesDuTrajet.size > 0) return;

            const clicLat = event.latLng.lat();
            const clicLng = event.latLng.lng();
            let meilleureLigne = null;
            let minDistance = 0.05;

            reseauData.forEach(function(feature) {
                const geo = feature.getGeometry();
                const verifierChemin = (path) => {
                    const pts = path.getArray();
                    for (let i = 0; i < pts.length - 1; i++) {
                        const dist = distancePointSegment(
                            clicLng, clicLat,
                            pts[i].lng(), pts[i].lat(),
                            pts[i+1].lng(), pts[i+1].lat()
                        );
                        if (dist < minDistance) {
                            minDistance = dist;
                            meilleureLigne = feature;
                        }
                    }
                };
                if (geo.getType() === 'LineString') verifierChemin(geo);
                else if (geo.getType() === 'MultiLineString') geo.getArray().forEach(verifierChemin);
            });

            if (meilleureLigne) selectionnerLigne(meilleureLigne, event.latLng);
            else deselectionnerLigne();
        });
        listenerClicCarteAttache = true;
    }

    appliquerStyleReseau();
}

function initialiserWifi() {
    if (wifiSet === null) {
        wifiSet = new Set();
        if (typeof wifiData !== 'undefined' && Array.isArray(wifiData)) {
            wifiData.forEach(g => g && g.nom && wifiSet.add(g.nom.toLowerCase()));
        }
    }
}

function loadGares() {
    if (!garesDataLoaded) {
        if (typeof garesGeoJsonData === 'undefined') {
            console.error("Fichier gares.js manquant.");
            alert("Erreur : gares.js manquant.");
            return;
        }
        toutesLesGares = garesGeoJsonData.features || [];
        garesDataLoaded = true;
        initialiserWifi();
    }
    actualiserAffichageGares();
}

// ============================================================================
// SECTION 8 : AFFICHAGE GARES
// ============================================================================

function actualiserAffichageGares() {
    if (!garesVisible) {
        marqueursAffiches.forEach(m => m.setMap(null));
        marqueursAffiches = [];
        return;
    }

    const currentZoom = map.getZoom();
    const limitesEcran = map.getBounds();
    if (!limitesEcran) return;

    marqueursAffiches.forEach(m => m.setMap(null));
    marqueursAffiches = [];

    toutesLesGares.forEach(feature => {
        const coords = feature.geometry.coordinates;
        const props = feature.properties;
        const segment = props['Segment(s) DRG'];

        const position = new google.maps.LatLng(coords[1], coords[0]);
        if (!limitesEcran.contains(position)) return;
        if (currentZoom < 8 && segment !== 'A') return;
        if (currentZoom < 11 && segment === 'C') return;

        const taillePoint = (segment === 'A') ? 9 : (segment === 'B' ? 7 : 5);
        const couleurPoint = (segment === 'A') ? '#E20074' : (segment === 'B' ? '#0088CE' : '#6C757D');

        const marker = new google.maps.Marker({
            position: position,
            map: map,
            title: props['Nom'],
            icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: taillePoint,
                fillColor: couleurPoint,
                fillOpacity: 0.9,
                strokeColor: '#FFFFFF',
                strokeWeight: 1
            }
        });

        marker.addListener('click', () => afficherBulleGare(marker, props, segment, couleurPoint));
        marqueursAffiches.push(marker);
    });
}

async function afficherBulleGare(marker, props, segment, couleurPoint) {
    let nomGare = props['Nom'].replace(/ - /g, '-');
    const commenceParVoyelle = /^[AEIOUYÉÈÊËÀÂÄÎÏÔÖÛÜ]/i.test(nomGare);
    const prefixe = commenceParVoyelle ? "Gare d'" : "Gare de ";
    const nomComplet = prefixe + nomGare;

    const lienWiki = "https://fr.wikipedia.org/w/index.php?search=" + encodeURIComponent(nomComplet);
    const idBulle = props['Code(s) UIC'];
    const aLeWifi = wifiSet && wifiSet.has(props['Nom'].toLowerCase());
    const badgeWifi = aLeWifi
        ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0088CE" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-left: 8px; vertical-align: middle;"><title>Wi-Fi disponible</title><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><path d="M5 12.55a11 11 0 0 1 14.08 0"/><circle cx="12" cy="20" r="1.5" fill="#0088CE" stroke="none"/></svg>`
        : '';

    const contenuBulle = `
        <div style="color: #333; font-family: sans-serif; padding: 5px; min-width: 200px; text-align: center;">
            <div id="wiki-img-${idBulle}" style="min-height: 20px; margin-bottom: 10px;">
                <span style="font-size: 11px; color: #888; font-style: italic;">Recherche d'image… ⏳</span>
            </div>
            <h3 style="margin: 0 0 5px 0; color: ${couleurPoint}; font-size: 16px; display: flex; align-items: center; justify-content: center;">
                ${props['Nom']} ${badgeWifi}
            </h3>
            <p style="margin: 0; font-size: 14px;"><strong>Code UIC :</strong> ${idBulle}</p>
            <p style="margin: 0; font-size: 12px; color: #666;">Catégorie : ${segment}</p>
            <div style="margin-top: 10px; border-top: 1px solid #eee; padding-top: 8px;">
                <a href="${lienWiki}" target="_blank" rel="noopener" style="color: #0055A4; text-decoration: none; font-size: 13px; font-weight: bold;">
                    🌐 Voir sur Wikipédia ↗
                </a>
            </div>
        </div>
    `;

    infoWindow.setContent(contenuBulle);
    infoWindow.open(map, marker);
    chargerImageWikipedia(nomComplet, idBulle);
}

async function chargerImageWikipedia(nomComplet, idBulle) {
    const masquer = () => {
        const c = document.getElementById(`wiki-img-${idBulle}`);
        if (c) c.style.display = 'none';
    };
    const afficher = (url, alt) => {
        const c = document.getElementById(`wiki-img-${idBulle}`);
        if (c) c.innerHTML = `<img src="${url}" alt="${alt}" style="width: 100%; max-height: 140px; object-fit: cover; border-radius: 6px; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">`;
    };

    if (cacheWikipedia.has(nomComplet)) {
        const r = cacheWikipedia.get(nomComplet);
        r === null ? masquer() : afficher(r.url, r.titre);
        return;
    }

    try {
        const urlSearch = "https://fr.wikipedia.org/w/api.php?action=opensearch&search=" + encodeURIComponent(nomComplet) + "&limit=1&format=json&origin=*";
        const dataSearch = await (await fetch(urlSearch)).json();
        if (dataSearch[1] && dataSearch[1].length > 0) {
            const titre = dataSearch[1][0];
            const r = await fetch("https://fr.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(titre));
            if (r.ok) {
                const d = await r.json();
                if (d.thumbnail && d.thumbnail.source) {
                    cacheWikipedia.set(nomComplet, { url: d.thumbnail.source, titre });
                    afficher(d.thumbnail.source, titre);
                    return;
                }
            }
        }
        cacheWikipedia.set(nomComplet, null);
        masquer();
    } catch (e) {
        masquer();
    }
}

// ============================================================================
// SECTION 9 : AFFICHAGE FRÉQUENTATION
// ============================================================================

function loadFrequentation() {
    if (!heatmap) {
        if (typeof frequentationData === 'undefined') {
            alert("Erreur : frequentation.js manquant.");
            return;
        }
        const heatmapData = frequentationData.map(p => ({
            location: new google.maps.LatLng(p.lat, p.lng),
            weight: p.poids
        }));
        heatmap = new google.maps.visualization.HeatmapLayer({
            data: heatmapData, radius: 30, opacity: 0.7, maxIntensity: 5000000,
            gradient: [
                'rgba(0, 0, 255, 0)', 'rgba(65, 105, 225, 1)', 'rgba(0, 255, 255, 1)',
                'rgba(0, 255, 0, 1)', 'rgba(255, 255, 0, 1)', 'rgba(255, 165, 0, 1)',
                'rgba(255, 0, 0, 1)'
            ]
        });
    }
    heatmap.setMap(frequentationVisible ? map : null);
}

// ============================================================================
// SECTION 10 : COMPARATEUR DE TARIFS - Graphe et Dijkstra
// ============================================================================

function normaliserNomGare(nom) {
    return nom
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[-_'"]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function initialiserGraphe() {
    if (grapheInitialise) return true;
    if (typeof grapheSNCF === 'undefined') {
        alert("Erreur : graphe.js manquant.\n\nLance d'abord :\n  python3 traiter_gtfs.py");
        return false;
    }

    indexGares = new Map();
    grapheSNCF.gares.forEach((gare, idx) => {
        indexGares.set(normaliserNomGare(gare.nom), idx);
    });

    // Liste d'adjacence (avec CODE_LIGNE par arête)
    adjacence = Array.from({ length: grapheSNCF.gares.length }, () => []);
    grapheSNCF.aretes.forEach(arete => {
        adjacence[arete.a].push({
            voisin: arete.b, duree: arete.duree, distance: arete.distance,
            cat: arete.cat, code_ligne: arete.code_ligne
        });
        adjacence[arete.b].push({
            voisin: arete.a, duree: arete.duree, distance: arete.distance,
            cat: arete.cat, code_ligne: arete.code_ligne
        });
    });

    // Datalist HTML pour l'autocomplétion
    const datalist = document.getElementById('liste-gares');
    if (datalist) {
        const nomsTries = grapheSNCF.gares.map(g => g.nom).sort();
        datalist.innerHTML = nomsTries.map(n => `<option value="${n.replace(/"/g, '&quot;')}">`).join('');
    }

    grapheInitialise = true;
    console.log(`✓ Graphe initialisé : ${grapheSNCF.gares.length} gares, ${grapheSNCF.aretes.length} arêtes`);
    return true;
}

function trouverGare(nomSaisi) {
    if (!nomSaisi || !nomSaisi.trim()) return -1;
    const norm = normaliserNomGare(nomSaisi);
    if (indexGares.has(norm)) return indexGares.get(norm);
    for (const [cle, idx] of indexGares.entries()) {
        if (cle.startsWith(norm)) return idx;
    }
    for (const [cle, idx] of indexGares.entries()) {
        if (cle.includes(norm)) return idx;
    }
    return -1;
}

function dijkstra(depart, arrivee) {
    const n = grapheSNCF.gares.length;
    const distances = new Float64Array(n).fill(Infinity);
    const predecesseur = new Int32Array(n).fill(-1);
    const segmentVersPred = new Array(n).fill(null);
    const visite = new Uint8Array(n);

    distances[depart] = 0;
    const heap = new MinHeap();
    heap.push(0, depart);

    while (heap.size() > 0) {
        const [dActu, u] = heap.pop();
        if (visite[u]) continue;
        visite[u] = 1;
        if (u === arrivee) break;

        for (const arete of adjacence[u]) {
            const v = arete.voisin;
            if (visite[v]) continue;
            const nouvelleDist = dActu + arete.duree;
            if (nouvelleDist < distances[v]) {
                distances[v] = nouvelleDist;
                predecesseur[v] = u;
                segmentVersPred[v] = arete;
                heap.push(nouvelleDist, v);
            }
        }
    }

    if (distances[arrivee] === Infinity) return null;

    const chemin = [];
    const segments = [];
    let u = arrivee;
    while (u !== -1) {
        chemin.unshift(u);
        if (predecesseur[u] !== -1) {
            segments.unshift({
                de: predecesseur[u],
                vers: u,
                duree: segmentVersPred[u].duree,
                distance: segmentVersPred[u].distance,
                cat: segmentVersPred[u].cat,
                code_ligne: segmentVersPred[u].code_ligne,
            });
        }
        u = predecesseur[u];
    }
    return { chemin, dureeTotale: distances[arrivee], segments };
}

class MinHeap {
    constructor() { this.data = []; }
    size() { return this.data.length; }
    push(priorite, valeur) {
        this.data.push([priorite, valeur]);
        this._siftUp(this.data.length - 1);
    }
    pop() {
        const top = this.data[0];
        const last = this.data.pop();
        if (this.data.length > 0) {
            this.data[0] = last;
            this._siftDown(0);
        }
        return top;
    }
    _siftUp(i) {
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (this.data[parent][0] <= this.data[i][0]) break;
            [this.data[parent], this.data[i]] = [this.data[i], this.data[parent]];
            i = parent;
        }
    }
    _siftDown(i) {
        const n = this.data.length;
        while (true) {
            const l = 2 * i + 1, r = 2 * i + 2;
            let smallest = i;
            if (l < n && this.data[l][0] < this.data[smallest][0]) smallest = l;
            if (r < n && this.data[r][0] < this.data[smallest][0]) smallest = r;
            if (smallest === i) break;
            [this.data[i], this.data[smallest]] = [this.data[smallest], this.data[i]];
            i = smallest;
        }
    }
}

// ============================================================================
// SECTION 11 : COMPARATEUR DE TARIFS - Interface utilisateur
// ============================================================================

function calculerTrajet() {
    if (!initialiserGraphe()) return;

    const inputDep = document.getElementById('gare-depart').value;
    const inputArr = document.getElementById('gare-arrivee').value;
    const resultat = document.getElementById('tarifs-resultat');

    const idxDep = trouverGare(inputDep);
    const idxArr = trouverGare(inputArr);

    if (idxDep === -1) {
        resultat.innerHTML = `<div class="resultat-erreur">Gare de départ introuvable : « ${inputDep} »</div>`;
        return;
    }
    if (idxArr === -1) {
        resultat.innerHTML = `<div class="resultat-erreur">Gare d'arrivée introuvable : « ${inputArr} »</div>`;
        return;
    }
    if (idxDep === idxArr) {
        resultat.innerHTML = `<div class="resultat-erreur">Le départ et l'arrivée sont la même gare.</div>`;
        return;
    }

    // On active automatiquement l'affichage du réseau pour pouvoir surligner
    if (!reseauVisible) {
        reseauVisible = true;
        basculerBouton('reseau', true);
        loadLGVLines();
    }

    resultat.innerHTML = `<div class="resultat-loading">Calcul en cours…</div>`;

    setTimeout(() => {
        const t0 = performance.now();
        const trajet = dijkstra(idxDep, idxArr);
        const tCalc = (performance.now() - t0).toFixed(0);

        if (!trajet) {
            resultat.innerHTML = `<div class="resultat-erreur">Aucun itinéraire trouvé entre ces deux gares dans les données GTFS.</div>`;
            return;
        }

        afficherResultatTrajet(trajet, idxDep, idxArr, tCalc);
        afficherTrajetSurCarte(trajet);
    }, 50);
}

function afficherResultatTrajet(trajet, idxDep, idxArr, tCalc) {
    const resultat = document.getElementById('tarifs-resultat');
    const tarifsKm = grapheSNCF.tarifs_km;

    let distanceTotale = 0;
    let prixTotal = 0;
    const categoriesUtilisees = new Set();
    const lignesUtilisees = new Set();
    trajet.segments.forEach(seg => {
        distanceTotale += seg.distance;
        prixTotal += seg.distance * tarifsKm[seg.cat];
        categoriesUtilisees.add(seg.cat);
        if (seg.code_ligne) lignesUtilisees.add(seg.code_ligne);
    });

    const correspondances = [];
    for (let i = 1; i < trajet.segments.length; i++) {
        if (trajet.segments[i].cat !== trajet.segments[i - 1].cat) {
            correspondances.push(trajet.segments[i].de);
        }
    }

    const heures = Math.floor(trajet.dureeTotale / 60);
    const minutes = Math.round(trajet.dureeTotale % 60);
    const dureeFormatee = heures > 0 ? `${heures}h${String(minutes).padStart(2, '0')}` : `${minutes} min`;

    const gareDep = grapheSNCF.gares[idxDep].nom;
    const gareArr = grapheSNCF.gares[idxArr].nom;

    // NOUVEAU v4 : afficher les CODE_LIGNE empruntés dans le détail de chaque segment
    const detailsHTML = trajet.segments.map(seg => {
        const nomDe = grapheSNCF.gares[seg.de].nom;
        const nomVers = grapheSNCF.gares[seg.vers].nom;
        const badgeLigne = seg.code_ligne
            ? `<span class="segment-ligne" title="Ligne ${seg.code_ligne}">L. ${seg.code_ligne}</span>`
            : `<span class="segment-ligne segment-ligne-inconnue" title="Ligne non identifiée">L. ?</span>`;
        return `
            <div class="segment-trajet">
                <span class="segment-cat segment-cat-${seg.cat}">${seg.cat}</span>
                <span class="segment-trajet-noms">${nomDe} → ${nomVers}</span>
                ${badgeLigne}
                <span class="segment-trajet-info">${Math.round(seg.duree)} min · ${seg.distance.toFixed(0)} km</span>
            </div>
        `;
    }).join('');

    // NOUVEAU v4 : récapitulatif des lignes empruntées
    const recapLignes = lignesUtilisees.size > 0
        ? `<div class="resultat-lignes">
             <strong>Lignes empruntées (${lignesUtilisees.size}) :</strong>
             ${[...lignesUtilisees].sort().map(c => `<span class="badge-ligne">${c}</span>`).join('')}
           </div>`
        : '';

    resultat.innerHTML = `
        <div class="resultat-trajet">
            <div class="resultat-header">
                <h4>${gareDep} → ${gareArr}</h4>
                <span class="resultat-meta">Calculé en ${tCalc} ms</span>
            </div>
            <div class="resultat-chiffres">
                <div class="chiffre-bloc">
                    <span class="chiffre-label">Durée totale</span>
                    <span class="chiffre-valeur">${dureeFormatee}</span>
                </div>
                <div class="chiffre-bloc">
                    <span class="chiffre-label">Distance</span>
                    <span class="chiffre-valeur">${distanceTotale.toFixed(0)} km</span>
                </div>
                <div class="chiffre-bloc">
                    <span class="chiffre-label">Prix estimé</span>
                    <span class="chiffre-valeur">${prixTotal.toFixed(2)} €</span>
                </div>
                <div class="chiffre-bloc">
                    <span class="chiffre-label">Correspondances</span>
                    <span class="chiffre-valeur">${correspondances.length}</span>
                </div>
            </div>
            ${recapLignes}
            <details class="resultat-details">
                <summary>Détail du trajet (${trajet.segments.length} segments)</summary>
                <div class="segments-liste">${detailsHTML}</div>
            </details>
            <div class="resultat-disclaimer">
                💡 Le prix est une estimation basée sur ${[...categoriesUtilisees].join(', ')}.
                Les tarifs réels SNCF Connect varient selon la date et l'anticipation.
            </div>
        </div>
    `;
}

/**
 * Affiche le trajet sur la carte :
 *   - Surligne en orange les lignes du réseau ayant un CODE_LIGNE emprunté
 *   - Pose deux marqueurs A (départ) et B (arrivée)
 *   - Recadre la carte sur le trajet
 */
function afficherTrajetSurCarte(trajet) {
    effacerTrajetSurCarte();

    // Collecter les CODE_LIGNE empruntés par le trajet
    codesLignesDuTrajet = new Set();
    trajet.segments.forEach(seg => {
        if (seg.code_ligne !== null && seg.code_ligne !== undefined) {
            codesLignesDuTrajet.add(seg.code_ligne);
        }
    });
    console.log(`✓ Trajet utilise ${codesLignesDuTrajet.size} ligne(s) distincte(s) :`, [...codesLignesDuTrajet]);

    // Réappliquer le style du réseau → surlignage des lignes empruntées
    if (reseauDataLoaded) appliquerStyleReseau();

    // Marqueurs aux extrémités
    const idxDepart = trajet.chemin[0];
    const idxArrivee = trajet.chemin[trajet.chemin.length - 1];
    const gareDep = grapheSNCF.gares[idxDepart];
    const gareArr = grapheSNCF.gares[idxArrivee];

    const markerDep = new google.maps.Marker({
        position: { lat: gareDep.lat, lng: gareDep.lon },
        map: map,
        title: gareDep.nom + ' (Départ)',
        label: { text: 'A', color: 'white', fontWeight: 'bold' },
        icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 14, fillColor: '#28a745', fillOpacity: 1,
            strokeColor: '#FFFFFF', strokeWeight: 2
        },
        zIndex: 300
    });
    const markerArr = new google.maps.Marker({
        position: { lat: gareArr.lat, lng: gareArr.lon },
        map: map,
        title: gareArr.nom + ' (Arrivée)',
        label: { text: 'B', color: 'white', fontWeight: 'bold' },
        icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 14, fillColor: '#dc3545', fillOpacity: 1,
            strokeColor: '#FFFFFF', strokeWeight: 2
        },
        zIndex: 300
    });

    trajetActuel = { markerDep, markerArr };

    // Recadrer la carte
    const bounds = new google.maps.LatLngBounds();
    trajet.chemin.forEach(idx => {
        const g = grapheSNCF.gares[idx];
        bounds.extend({ lat: g.lat, lng: g.lon });
    });
    map.fitBounds(bounds, 80);
}

function effacerTrajetSurCarte() {
    if (trajetActuel) {
        trajetActuel.markerDep.setMap(null);
        trajetActuel.markerArr.setMap(null);
        trajetActuel = null;
    }
    if (codesLignesDuTrajet.size > 0) {
        codesLignesDuTrajet = new Set();
        if (reseauDataLoaded) appliquerStyleReseau();
    }
}

// ============================================================================
// SECTION 12 : INITIALISATION MAP
// ============================================================================

function initMap() {
    const loader = document.getElementById('map-loading');
    if (loader) loader.remove();

    map = new google.maps.Map(document.getElementById("app-container"), {
        center: { lat: 46.603354, lng: 1.888334 },
        zoom: 6,
        minZoom: 5,
        mapId: 'def9248b61a9c229f43789e9',
        restriction: {
            latLngBounds: { north: 51.5, south: 41.0, west: -5.5, east: 9.5 },
            strictBounds: false
        },
        disableDefaultUI: true,
        zoomControl: true,
        gestureHandling: 'greedy'
    });

    reseauData = new google.maps.Data();
    reseauData.setMap(map);
    infoWindow = new google.maps.InfoWindow({ disableAutoPan: true });

    const legend = document.getElementById("map-legend");
    if (legend) {
        legend.style.display = "block";
        map.controls[google.maps.ControlPosition.BOTTOM_LEFT].push(legend);
    }

    map.addListener('idle', function() {
        if (garesVisible) actualiserAffichageGares();
    });
}

// ============================================================================
// SECTION 13 : CONTRÔLE MENU
// ============================================================================

function basculerBouton(appName, estActif) {
    const bouton = document.getElementById("btn-" + appName);
    if (bouton) bouton.classList.toggle("active", estActif);
}

function loadApp(appName) {
    if (!map) return;
    if (infoWindow) infoWindow.close();

    if (appName === 'gares') {
        garesVisible = !garesVisible;
        basculerBouton('gares', garesVisible);
        if (garesVisible && !garesDataLoaded) loadGares();
        else actualiserAffichageGares();
    }
    else if (appName === 'reseau') {
        reseauVisible = !reseauVisible;
        basculerBouton('reseau', reseauVisible);
        loadLGVLines();
        if (!reseauVisible) deselectionnerLigne();
    }
    else if (appName === 'frequentation') {
        frequentationVisible = !frequentationVisible;
        basculerBouton('frequentation', frequentationVisible);
        loadFrequentation();
    }
    else if (appName === 'tarifs') {
        tarifsVisible = !tarifsVisible;
        basculerBouton('tarifs', tarifsVisible);
        const panel = document.getElementById('tarifs-panel');
        if (panel) panel.style.display = tarifsVisible ? 'block' : 'none';
        if (tarifsVisible) {
            initialiserGraphe();
        } else {
            effacerTrajetSurCarte();
        }
    }
}

function showView(viewName) {
    const dashboardView = document.getElementById('dashboard-view');
    const aboutView = document.getElementById('about-view');

    if (viewName === 'home') {
        dashboardView.style.display = 'block';
        aboutView.style.display = 'none';
        if (map) google.maps.event.trigger(map, 'resize');
    } else if (viewName === 'about') {
        dashboardView.style.display = 'none';
        aboutView.style.display = 'block';
    }
}

// ============================================================================
// SECTION 14 : EXPORT FONCTIONS GLOBALES
// ============================================================================
window.initMap = initMap;
window.loadApp = loadApp;
window.showView = showView;
window.calculerTrajet = calculerTrajet;