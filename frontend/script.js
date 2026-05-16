/**
 * ============================================================================
 * SNCF DATA PROJECT - MODULE CARTOGRAPHIQUE INTERACTIF (v8)
 * ============================================================================
 * Le comparateur de tarifs affiche le trajet en surlignant les portions de
 * voie ferrée précises (clé 'trace' de chaque arête, pré-calculée par
 * testghps.py via projection sur les tronçons du réseau).
 *
 * - Indépendant du calque "Réseau Ferré" (on dessine nos propres Polylines)
 * - Pas de débordement : la trace s'arrête exactement aux gares
 * - Suit le tracé réel de la voie ferrée
 */

// ============================================================================
// SECTION 1 : VARIABLES GLOBALES
// ============================================================================
let map;
let infoWindow;

let reseauData;
let reseauDataLoaded = false;
let reseauVisible = false;
let ligneSelectionnee = null;
let listenerClicCarteAttache = false;

let toutesLesGares = [];
let marqueursAffiches = [];
let garesDataLoaded = false;
let garesVisible = false;

let wifiSet = null;
let heatmap = null;
let frequentationVisible = false;
const cacheWikipedia = new Map();

let tarifsVisible = false;
let grapheInitialise = false;
let indexGares = null;
let adjacence = null;
let trajetActuel = null;  // { polylines:[], markerDep, markerArr }

// ============================================================================
// SECTION 2 : RÉSEAU FERRÉ (calque on/off, inchangé)
// ============================================================================

function appliquerStyleReseau() {
    reseauData.setStyle(function(feature) {
        if (!reseauVisible) return { visible: false };
        const estLGV = (feature.getProperty('CATLIG') === 'Ligne à grande vitesse');
        const couleurBase = estLGV ? '#E20074' : '#0055A4';
        const epaisseurBase = estLGV ? 4 : 1.5;

        if (ligneSelectionnee) {
            if (feature === ligneSelectionnee) {
                return { strokeColor: couleurBase, strokeWeight: epaisseurBase + 3,
                         strokeOpacity: 1.0, zIndex: 100, clickable: false, visible: true };
            }
            return { strokeColor: '#999999', strokeWeight: epaisseurBase,
                     strokeOpacity: 0.3, zIndex: 1, clickable: false, visible: true };
        }
        return { strokeColor: couleurBase, strokeWeight: epaisseurBase,
                 strokeOpacity: 0.8, zIndex: estLGV ? 10 : 5,
                 clickable: false, visible: true };
    });
}

function selectionnerLigne(feature, latLng) {
    ligneSelectionnee = feature;
    appliquerStyleReseau();
    const typeLigne = feature.getProperty('CATLIG') || 'Inconnu';
    const idLigne = feature.getProperty('LIB_LIGNE') || feature.getProperty('CODE_LIGNE') || "Inconnue";
    const estLGV = typeLigne === 'Ligne à grande vitesse';
    const categorie = estLGV ? 'TGV' : 'TER/IC';
    const tarifMoyen = estLGV ? '0,18 €/km' : '0,10 à 0,15 €/km';
    const vitesseMoyenne = estLGV ? '~250 km/h' : '~90 km/h';
    infoWindow.setContent(`
        <div style="color:#333; font-family:sans-serif; padding:5px; min-width:220px;">
            <h3 style="margin:0 0 8px 0; color:#004696; font-size:16px;">Ligne ${idLigne}</h3>
            <p style="margin:4px 0; font-size:13px;"><strong>Type :</strong> ${typeLigne}</p>
            <hr style="border:0; border-top:1px solid #eee; margin:8px 0;">
            <p style="margin:4px 0; font-size:12px;"><strong>Service :</strong> ${categorie}</p>
            <p style="margin:4px 0; font-size:12px;"><strong>Tarif moyen :</strong> ${tarifMoyen}</p>
            <p style="margin:4px 0; font-size:12px;"><strong>Vitesse :</strong> ${vitesseMoyenne}</p>
        </div>`);
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

function distancePointSegment(px, py, ax, ay, bx, by) {
    const l2 = Math.pow(ax-bx,2) + Math.pow(ay-by,2);
    if (l2 === 0) return Math.sqrt(Math.pow(px-ax,2)+Math.pow(py-ay,2));
    const t = Math.max(0, Math.min(1, ((px-ax)*(bx-ax)+(py-ay)*(by-ay))/l2));
    return Math.sqrt(Math.pow(px-(ax+t*(bx-ax)),2) + Math.pow(py-(ay+t*(by-ay)),2));
}

function loadLGVLines() {
    if (!reseauDataLoaded) {
        if (typeof reseauGeoJsonData === 'undefined') {
            alert("Erreur : reseau.js manquant."); return;
        }
        reseauData.addGeoJson(reseauGeoJsonData);
        reseauDataLoaded = true;
    }
    if (!listenerClicCarteAttache) {
        map.addListener('click', function(event) {
            if (!reseauVisible) return;
            const clicLat = event.latLng.lat(), clicLng = event.latLng.lng();
            let meilleureLigne = null, minDistance = 0.05;
            reseauData.forEach(function(feature) {
                const geo = feature.getGeometry();
                const verif = (path) => {
                    const pts = path.getArray();
                    for (let i = 0; i < pts.length - 1; i++) {
                        const dist = distancePointSegment(clicLng, clicLat,
                            pts[i].lng(), pts[i].lat(), pts[i+1].lng(), pts[i+1].lat());
                        if (dist < minDistance) { minDistance = dist; meilleureLigne = feature; }
                    }
                };
                if (geo.getType() === 'LineString') verif(geo);
                else if (geo.getType() === 'MultiLineString') geo.getArray().forEach(verif);
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
            alert("Erreur : gares.js manquant."); return;
        }
        toutesLesGares = garesGeoJsonData.features || [];
        garesDataLoaded = true;
        initialiserWifi();
    }
    actualiserAffichageGares();
}

// ============================================================================
// SECTION 3 : AFFICHAGE GARES
// ============================================================================

function actualiserAffichageGares() {
    if (!garesVisible) {
        marqueursAffiches.forEach(m => m.setMap(null));
        marqueursAffiches = [];
        return;
    }
    const z = map.getZoom();
    const lim = map.getBounds();
    if (!lim) return;
    marqueursAffiches.forEach(m => m.setMap(null));
    marqueursAffiches = [];

    toutesLesGares.forEach(feature => {
        const c = feature.geometry.coordinates;
        const p = feature.properties;
        const seg = p['Segment(s) DRG'];
        const pos = new google.maps.LatLng(c[1], c[0]);
        if (!lim.contains(pos)) return;
        if (z < 8 && seg !== 'A') return;
        if (z < 11 && seg === 'C') return;
        const taille = (seg === 'A') ? 9 : (seg === 'B' ? 7 : 5);
        const coul = (seg === 'A') ? '#E20074' : (seg === 'B' ? '#0088CE' : '#6C757D');
        const marker = new google.maps.Marker({
            position: pos, map: map, title: p['Nom'],
            icon: { path: google.maps.SymbolPath.CIRCLE, scale: taille,
                    fillColor: coul, fillOpacity: 0.9,
                    strokeColor: '#FFFFFF', strokeWeight: 1 }
        });
        marker.addListener('click', () => afficherBulleGare(marker, p, seg, coul));
        marqueursAffiches.push(marker);
    });
}

async function afficherBulleGare(marker, props, segment, couleurPoint) {
    let nomGare = props['Nom'].replace(/ - /g, '-');
    const voyelle = /^[AEIOUYÉÈÊËÀÂÄÎÏÔÖÛÜ]/i.test(nomGare);
    const nomComplet = (voyelle ? "Gare d'" : "Gare de ") + nomGare;
    const lienWiki = "https://fr.wikipedia.org/w/index.php?search=" + encodeURIComponent(nomComplet);
    const idBulle = props['Code(s) UIC'];
    const aWifi = wifiSet && wifiSet.has(props['Nom'].toLowerCase());
    const badge = aWifi
        ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0088CE" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-left:8px;vertical-align:middle;"><title>Wi-Fi</title><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><path d="M5 12.55a11 11 0 0 1 14.08 0"/><circle cx="12" cy="20" r="1.5" fill="#0088CE" stroke="none"/></svg>`
        : '';
    infoWindow.setContent(`
        <div style="color:#333;font-family:sans-serif;padding:5px;min-width:200px;text-align:center;">
            <div id="wiki-img-${idBulle}" style="min-height:20px;margin-bottom:10px;">
                <span style="font-size:11px;color:#888;font-style:italic;">Recherche d'image… ⏳</span>
            </div>
            <h3 style="margin:0 0 5px 0;color:${couleurPoint};font-size:16px;display:flex;align-items:center;justify-content:center;">
                ${props['Nom']} ${badge}
            </h3>
            <p style="margin:0;font-size:14px;"><strong>Code UIC :</strong> ${idBulle}</p>
            <p style="margin:0;font-size:12px;color:#666;">Catégorie : ${segment}</p>
            <div style="margin-top:10px;border-top:1px solid #eee;padding-top:8px;">
                <a href="${lienWiki}" target="_blank" rel="noopener" style="color:#0055A4;text-decoration:none;font-size:13px;font-weight:bold;">🌐 Voir sur Wikipédia ↗</a>
            </div>
        </div>`);
    infoWindow.open(map, marker);
    chargerImageWikipedia(nomComplet, idBulle);
}

async function chargerImageWikipedia(nomComplet, idBulle) {
    const masquer = () => { const c = document.getElementById(`wiki-img-${idBulle}`); if (c) c.style.display = 'none'; };
    const afficher = (url, alt) => { const c = document.getElementById(`wiki-img-${idBulle}`); if (c) c.innerHTML = `<img src="${url}" alt="${alt}" style="width:100%;max-height:140px;object-fit:cover;border-radius:6px;box-shadow:0 2px 4px rgba(0,0,0,0.2);">`; };
    if (cacheWikipedia.has(nomComplet)) {
        const r = cacheWikipedia.get(nomComplet);
        r === null ? masquer() : afficher(r.url, r.titre);
        return;
    }
    try {
        const us = "https://fr.wikipedia.org/w/api.php?action=opensearch&search=" + encodeURIComponent(nomComplet) + "&limit=1&format=json&origin=*";
        const ds = await (await fetch(us)).json();
        if (ds[1] && ds[1].length > 0) {
            const titre = ds[1][0];
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
    } catch (e) { masquer(); }
}

// ============================================================================
// SECTION 4 : FRÉQUENTATION
// ============================================================================

function loadFrequentation() {
    if (!heatmap) {
        if (typeof frequentationData === 'undefined') {
            alert("Erreur : frequentation.js manquant."); return;
        }
        heatmap = new google.maps.visualization.HeatmapLayer({
            data: frequentationData.map(p => ({
                location: new google.maps.LatLng(p.lat, p.lng), weight: p.poids })),
            radius: 30, opacity: 0.7, maxIntensity: 5000000,
            gradient: ['rgba(0,0,255,0)','rgba(65,105,225,1)','rgba(0,255,255,1)',
                       'rgba(0,255,0,1)','rgba(255,255,0,1)','rgba(255,165,0,1)','rgba(255,0,0,1)']
        });
    }
    heatmap.setMap(frequentationVisible ? map : null);
}

// ============================================================================
// SECTION 5 : COMPARATEUR - Graphe GTFS & Dijkstra
// ============================================================================

function normaliserNomGare(nom) {
    return nom.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[-_'"]/g, ' ').replace(/\s+/g, ' ').trim();
}

function initialiserGraphe() {
    if (grapheInitialise) return true;
    if (typeof grapheSNCF === 'undefined') {
        alert("Erreur : graphe.js manquant.\n\nLance :\n  python3 convertir_lignes_en_js.py\n  python3 testghps.py");
        return false;
    }
    indexGares = new Map();
    grapheSNCF.gares.forEach((g, i) => indexGares.set(normaliserNomGare(g.nom), i));
    adjacence = Array.from({ length: grapheSNCF.gares.length }, () => []);
    grapheSNCF.aretes.forEach(ar => {
        adjacence[ar.a].push({ voisin: ar.b, duree: ar.duree, distance: ar.distance,
                               cat: ar.cat, trace: ar.trace, sens: 1 });
        adjacence[ar.b].push({ voisin: ar.a, duree: ar.duree, distance: ar.distance,
                               cat: ar.cat, trace: ar.trace, sens: -1 });
    });
    const dl = document.getElementById('liste-gares');
    if (dl) {
        dl.innerHTML = grapheSNCF.gares.map(g => g.nom).sort()
            .map(n => `<option value="${n.replace(/"/g, '&quot;')}">`).join('');
    }
    grapheInitialise = true;
    console.log(`✓ Graphe GTFS : ${grapheSNCF.gares.length} gares, ${grapheSNCF.aretes.length} arêtes`);
    return true;
}

function trouverGare(nomSaisi) {
    if (!nomSaisi || !nomSaisi.trim()) return -1;
    const norm = normaliserNomGare(nomSaisi);
    if (indexGares.has(norm)) return indexGares.get(norm);
    for (const [c, i] of indexGares.entries()) if (c.startsWith(norm)) return i;
    for (const [c, i] of indexGares.entries()) if (c.includes(norm)) return i;
    return -1;
}

function dijkstra(depart, arrivee) {
    const n = grapheSNCF.gares.length;
    const dist = new Float64Array(n).fill(Infinity);
    const pred = new Int32Array(n).fill(-1);
    const segPred = new Array(n).fill(null);
    const vu = new Uint8Array(n);
    dist[depart] = 0;
    const heap = new MinHeap();
    heap.push(0, depart);
    while (heap.size() > 0) {
        const [d, u] = heap.pop();
        if (vu[u]) continue;
        vu[u] = 1;
        if (u === arrivee) break;
        for (const ar of adjacence[u]) {
            if (vu[ar.voisin]) continue;
            const nd = d + ar.duree;
            if (nd < dist[ar.voisin]) {
                dist[ar.voisin] = nd;
                pred[ar.voisin] = u;
                segPred[ar.voisin] = ar;
                heap.push(nd, ar.voisin);
            }
        }
    }
    if (dist[arrivee] === Infinity) return null;
    const chemin = [], segments = [];
    let u = arrivee;
    while (u !== -1) {
        chemin.unshift(u);
        if (pred[u] !== -1) {
            segments.unshift({ de: pred[u], vers: u, duree: segPred[u].duree,
                distance: segPred[u].distance, cat: segPred[u].cat,
                trace: segPred[u].trace, sens: segPred[u].sens });
        }
        u = pred[u];
    }
    return { chemin, dureeTotale: dist[arrivee], segments };
}

class MinHeap {
    constructor() { this.d = []; }
    size() { return this.d.length; }
    push(p, v) { this.d.push([p, v]); this._up(this.d.length - 1); }
    pop() { const t = this.d[0], l = this.d.pop();
        if (this.d.length) { this.d[0] = l; this._down(0); } return t; }
    _up(i) { while (i > 0) { const p = (i-1)>>1;
        if (this.d[p][0] <= this.d[i][0]) break;
        [this.d[p], this.d[i]] = [this.d[i], this.d[p]]; i = p; } }
    _down(i) { const n = this.d.length;
        while (true) { const l = 2*i+1, r = 2*i+2; let s = i;
            if (l < n && this.d[l][0] < this.d[s][0]) s = l;
            if (r < n && this.d[r][0] < this.d[s][0]) s = r;
            if (s === i) break;
            [this.d[i], this.d[s]] = [this.d[s], this.d[i]]; i = s; } }
}

// ============================================================================
// SECTION 6 : COMPARATEUR - Interface & affichage du trajet
// ============================================================================

function calculerTrajet() {
    if (!initialiserGraphe()) return;
    const inputDep = document.getElementById('gare-depart').value;
    const inputArr = document.getElementById('gare-arrivee').value;
    const resultat = document.getElementById('tarifs-resultat');
    const idxDep = trouverGare(inputDep);
    const idxArr = trouverGare(inputArr);

    if (idxDep === -1) { resultat.innerHTML = `<div class="resultat-erreur">Gare de départ introuvable : « ${inputDep} »</div>`; return; }
    if (idxArr === -1) { resultat.innerHTML = `<div class="resultat-erreur">Gare d'arrivée introuvable : « ${inputArr} »</div>`; return; }
    if (idxDep === idxArr) { resultat.innerHTML = `<div class="resultat-erreur">Départ et arrivée identiques.</div>`; return; }

    resultat.innerHTML = `<div class="resultat-loading">Calcul en cours…</div>`;
    setTimeout(() => {
        const t0 = performance.now();
        const trajet = dijkstra(idxDep, idxArr);
        const tCalc = (performance.now() - t0).toFixed(0);
        if (!trajet) {
            resultat.innerHTML = `<div class="resultat-erreur">Aucun itinéraire trouvé.</div>`;
            return;
        }
        afficherResultatTrajet(trajet, idxDep, idxArr, tCalc);
        afficherTrajetSurCarte(trajet);
    }, 50);
}

function afficherResultatTrajet(trajet, idxDep, idxArr, tCalc) {
    const resultat = document.getElementById('tarifs-resultat');
    const tk = grapheSNCF.tarifs_km;
    let distT = 0, prixT = 0;
    const cats = new Set();
    trajet.segments.forEach(s => {
        distT += s.distance; prixT += s.distance * tk[s.cat]; cats.add(s.cat);
    });
    const corr = [];
    for (let i = 1; i < trajet.segments.length; i++)
        if (trajet.segments[i].cat !== trajet.segments[i-1].cat)
            corr.push(trajet.segments[i].de);
    const h = Math.floor(trajet.dureeTotale / 60);
    const m = Math.round(trajet.dureeTotale % 60);
    const dF = h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`;
    const gDep = grapheSNCF.gares[idxDep].nom;
    const gArr = grapheSNCF.gares[idxArr].nom;
    const det = trajet.segments.map(s => {
        const nd = grapheSNCF.gares[s.de].nom, nv = grapheSNCF.gares[s.vers].nom;
        return `<div class="segment-trajet">
            <span class="segment-cat segment-cat-${s.cat}">${s.cat}</span>
            <span class="segment-trajet-noms">${nd} → ${nv}</span>
            <span class="segment-trajet-info">${Math.round(s.duree)} min · ${s.distance.toFixed(0)} km</span>
        </div>`;
    }).join('');
    resultat.innerHTML = `
        <div class="resultat-trajet">
            <div class="resultat-header">
                <h4>${gDep} → ${gArr}</h4>
                <span class="resultat-meta">Calculé en ${tCalc} ms</span>
            </div>
            <div class="resultat-chiffres">
                <div class="chiffre-bloc"><span class="chiffre-label">Durée</span><span class="chiffre-valeur">${dF}</span></div>
                <div class="chiffre-bloc"><span class="chiffre-label">Distance</span><span class="chiffre-valeur">${distT.toFixed(0)} km</span></div>
                <div class="chiffre-bloc"><span class="chiffre-label">Prix estimé</span><span class="chiffre-valeur">${prixT.toFixed(2)} €</span></div>
                <div class="chiffre-bloc"><span class="chiffre-label">Correspondances</span><span class="chiffre-valeur">${corr.length}</span></div>
            </div>
            <details class="resultat-details">
                <summary>Détail (${trajet.segments.length} segments)</summary>
                <div class="segments-liste">${det}</div>
            </details>
            <div class="resultat-disclaimer">
                💡 Prix estimé (${[...cats].join(', ')}). Tarifs réels variables selon date/anticipation.
            </div>
        </div>`;
}

function afficherTrajetSurCarte(trajet) {
    effacerTrajetSurCarte();

    // Dessiner la trace de chaque segment (pré-calculée par testghps.py).
    // Chaque trace est une liste de [lat, lng]. On respecte le sens de
    // parcours (l'arête peut être traversée dans un sens ou l'autre).
    const polylineObjects = [];
    let nbPoints = 0;
    trajet.segments.forEach(seg => {
        if (!seg.trace || seg.trace.length < 2) return;
        let pts = seg.trace.map(c => ({ lat: c[0], lng: c[1] }));
        if (seg.sens === -1) pts = pts.slice().reverse();
        nbPoints += pts.length;
        polylineObjects.push(new google.maps.Polyline({
            path: pts, geodesic: false,
            strokeColor: '#FF6B00', strokeOpacity: 0.9,
            strokeWeight: 5, zIndex: 200, map: map
        }));
    });
    console.log(`✓ Trajet dessiné : ${polylineObjects.length} segments, ${nbPoints} points`);

    const gDep = grapheSNCF.gares[trajet.chemin[0]];
    const gArr = grapheSNCF.gares[trajet.chemin[trajet.chemin.length - 1]];
    const markerDep = new google.maps.Marker({
        position: { lat: gDep.lat, lng: gDep.lon }, map: map,
        title: gDep.nom + ' (Départ)',
        label: { text: 'A', color: 'white', fontWeight: 'bold' },
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 14,
                fillColor: '#28a745', fillOpacity: 1,
                strokeColor: '#FFFFFF', strokeWeight: 2 }, zIndex: 300
    });
    const markerArr = new google.maps.Marker({
        position: { lat: gArr.lat, lng: gArr.lon }, map: map,
        title: gArr.nom + ' (Arrivée)',
        label: { text: 'B', color: 'white', fontWeight: 'bold' },
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 14,
                fillColor: '#dc3545', fillOpacity: 1,
                strokeColor: '#FFFFFF', strokeWeight: 2 }, zIndex: 300
    });

    trajetActuel = { polylines: polylineObjects, markerDep, markerArr };

    const bounds = new google.maps.LatLngBounds();
    trajet.segments.forEach(s => {
        if (s.trace) s.trace.forEach(c => bounds.extend({ lat: c[0], lng: c[1] }));
    });
    bounds.extend({ lat: gDep.lat, lng: gDep.lon });
    bounds.extend({ lat: gArr.lat, lng: gArr.lon });
    map.fitBounds(bounds, 80);
}

function effacerTrajetSurCarte() {
    if (trajetActuel) {
        trajetActuel.polylines.forEach(p => p.setMap(null));
        trajetActuel.markerDep.setMap(null);
        trajetActuel.markerArr.setMap(null);
        trajetActuel = null;
    }
}

// ============================================================================
// SECTION 7 : INIT MAP & MENU
// ============================================================================

function initMap() {
    const loader = document.getElementById('map-loading');
    if (loader) loader.remove();
    map = new google.maps.Map(document.getElementById("app-container"), {
        center: { lat: 46.603354, lng: 1.888334 },
        zoom: 6, minZoom: 5, mapId: 'def9248b61a9c229f43789e9',
        restriction: { latLngBounds: { north: 51.5, south: 41.0, west: -5.5, east: 9.5 },
                        strictBounds: false },
        disableDefaultUI: true, zoomControl: true, gestureHandling: 'greedy'
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

function basculerBouton(appName, estActif) {
    const b = document.getElementById("btn-" + appName);
    if (b) b.classList.toggle("active", estActif);
}

function loadApp(appName) {
    if (!map) return;
    if (infoWindow) infoWindow.close();
    if (appName === 'gares') {
        garesVisible = !garesVisible;
        basculerBouton('gares', garesVisible);
        if (garesVisible && !garesDataLoaded) loadGares();
        else actualiserAffichageGares();
    } else if (appName === 'reseau') {
        reseauVisible = !reseauVisible;
        basculerBouton('reseau', reseauVisible);
        loadLGVLines();
        if (!reseauVisible) deselectionnerLigne();
    } else if (appName === 'frequentation') {
        frequentationVisible = !frequentationVisible;
        basculerBouton('frequentation', frequentationVisible);
        loadFrequentation();
    } else if (appName === 'tarifs') {
        tarifsVisible = !tarifsVisible;
        basculerBouton('tarifs', tarifsVisible);
        const panel = document.getElementById('tarifs-panel');
        if (panel) panel.style.display = tarifsVisible ? 'block' : 'none';
        if (tarifsVisible) initialiserGraphe();
        else effacerTrajetSurCarte();
    }
}

function showView(viewName) {
    const dv = document.getElementById('dashboard-view');
    const av = document.getElementById('about-view');
    if (viewName === 'home') {
        dv.style.display = 'block';
        av.style.display = 'none';
        if (map) google.maps.event.trigger(map, 'resize');
    } else if (viewName === 'about') {
        dv.style.display = 'none';
        av.style.display = 'block';
    }
}

window.initMap = initMap;
window.loadApp = loadApp;
window.showView = showView;
window.calculerTrajet = calculerTrajet;