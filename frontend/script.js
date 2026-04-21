/**
 * ============================================================================
 * SNCF DATA PROJECT - MODULE CARTOGRAPHIQUE INTERACTIF
 * ============================================================================
 * Interface Google Maps pour la visualisation du réseau ferroviaire français,
 * des gares de voyageurs et de la fréquentation des stations.
 * 
 * Fonctionnalités principales:
 * - Affichage multi-couche (Réseau, Gares, Fréquentation)
 * - Optimisation du viewport culling pour les marqueurs
 * - Intégration API Wikipedia pour enrichissements dynamiques
 * - Gestion du Wi-Fi dans les gares
 */

// ============================================================================
// SECTION 1 : VARIABLES GLOBALES - MAP & WINDOW
// ============================================================================
let map;              // Instance Google Maps principale
let infoWindow;       // Bulle d'information commune pour tous les marqueurs

// ============================================================================
// SECTION 2 : VARIABLES - DONNÉES RÉSEAU FERRÉ (LGV et Classique)
// ============================================================================
let reseauData;             // Objet Google Data Layer contenant les lignes
let reseauDataLoaded = false; // Flag : données chargées en mémoire ?
let reseauVisible = false;    // Flag : affichage activé actuellement ?
let ligneSelectionnee = null; // Mémorise la ligne sélectionnée (pour focus/estompe)

// ============================================================================
// SECTION 3 : VARIABLES - DONNÉES GARES (Points optimisés)
// ============================================================================
let toutesLesGares = [];      // Cache des features GeoJSON (toutes les gares)
let marqueursAffiches = [];   // Marqueurs actuels visibles (gestion mémoire)
let garesDataLoaded = false;  // Flag : données chargées en mémoire ?
let garesVisible = false;     // Flag : affichage activé actuellement ?

// ============================================================================
// SECTION 4 : VARIABLES - DONNÉES COMPLÉMENTAIRES
// ============================================================================
let wifiData = [];           // Cache des gares équipées de Wi-Fi
let wifiDataLoaded = false;  // Flag : données Wi-Fi chargées ?

let heatmap = null;                  // Couche heatmap (fréquentation)
let frequentationVisible = false;     // Flag : heatmap affichée ?

// ============================================================================
// SECTION 5 : GESTION RÉSEAU FERRÉ - Styling et Sélection
// ============================================================================


/**
 * Applique les styles de couleur et d'épaisseur aux lignes du réseau
 * en fonction de leur type (LGV ou Classique) et de leur sélection.
 * 
 * Utilise le mode FOCUS/ESTOMPE:
 * - Ligne sélectionnée: couleur saturée, épaisseur +3
 * - Autres lignes: grisées et semi-transparentes
 */
// Variables globales
let map; 
let infoWindow; 

// === RESEAU FERRE (Lignes) ===
let reseauData; 
let reseauHitbox; // NOUVEAU : Calque invisible pour capter les clics larges
let reseauDataLoaded = false; 
let reseauVisible = false;    
let ligneSelectionnee = null; // Mémorise la ligne cliquée

// === GARES ET VILLES (Points ultra-optimisés) ===
let toutesLesGares = [];      
let marqueursAffiches = [];   
let garesDataLoaded = false;
let garesVisible = false;

// === NOUVEAU : WI-FI ===
let wifiData = [];
let wifiDataLoaded = false;

// === FREQUENTATION (Heatmap) ===
let heatmap = null;
let frequentationVisible = false;

// --- GESTION DES LIGNES (Focus/Extinction) ---

function appliquerStyleReseau() {
    reseauData.setStyle(function(feature) { 
        // Si la couche est cachée, masquer toutes les lignes
        if (!reseauVisible) return { visible: false };
        
        // Déterminer le type et la couleur de base
        let estLGV = (feature.getProperty('CATLIG') === 'Ligne à grande vitesse');
        let couleurBase = estLGV ? '#E20074' : '#0055A4';    // Rose/Bleu SNCF
        let epaisseurBase = estLGV ? 4 : 1.5;

        // ---------- MODE 1 : UNE LIGNE EST SÉLECTIONNÉE ----------
        if (ligneSelectionnee) {
            if (feature === ligneSelectionnee) {
                // Style FOCUS : ligne mise en avant
                return {
                    strokeColor: couleurBase,
                    strokeWeight: epaisseurBase + 3,
                    strokeOpacity: 1.0,
                    zIndex: 100,
                    clickable: true,
                    visible: true
                };
            } else {
                // Style ESTOMPE : autres lignes en arrière-plan
                return {
                    strokeColor: '#999999',
                    strokeWeight: epaisseurBase,
                    strokeOpacity: 0.3,
                    zIndex: 1,
                    clickable: true,
                    visible: true
                };
            }
        }

        // ---------- MODE 2 : AUCUNE LIGNE SÉLECTIONNÉE (Normal) ----------
        return {
            strokeColor: couleurBase,
            strokeWeight: epaisseurBase,
            strokeOpacity: 0.8,
            zIndex: estLGV ? 10 : 5,    // LGV par-dessus les classiques
            clickable: true,
            visible: true
        };
    });
    reseauHitbox.setStyle(function(feature) {
        return {
            strokeWeight: 15,    // Marge d'erreur de clic (ajustez si besoin)
            strokeOpacity: 0.0,  // Totalement invisible ! (ou 0.01 si bug sur certains vieux navigateurs)
            zIndex: 20,          // Au-dessus du réseau visuel
            clickable: true,     // Elle capte la souris
            visible: reseauVisible,
            cursor: 'pointer'
        };
    });
}
/**
 * Sélectionne une ligne du réseau et affiche ses informations.
 * Active le mode FOCUS (autres lignes s'estompent).
 * 
 * @param {google.maps.Data.Feature} feature - La ligne sélectionnée
 * @param {google.maps.LatLng} latLng - Position du clic pour la bulle
 */
function selectionnerLigne(feature, latLng) {
    ligneSelectionnee = feature;
    appliquerStyleReseau();
    
    // Extraire les informations de la ligne
    let typeLigne = feature.getProperty('CATLIG');
    let idLigne = feature.getProperty('LIB_LIGNE') || "Inconnue";
    
    // Créer le contenu HTML de la bulle d'information
    let contenuBulle = `
        <div style="color: #333; font-family: sans-serif; padding: 5px;">
            <h3 style="margin: 0 0 5px 0; color: #004696; font-size: 16px;">Ligne ${idLigne}</h3>
            <p style="margin: 0; font-size: 14px;"><strong>Type:</strong> ${typeLigne}</p>
        </div>
    `;
    
    // Afficher la bulle à la position du clic
    infoWindow.setContent(contenuBulle);
    infoWindow.setPosition(latLng);
    infoWindow.open(map);
}

/**
 * Désélectionne la ligne actuellement sélectionnée.
 * Ferme la bulle et revient au style normal pour toutes les lignes.
 */
function deselectionnerLigne() {
    if (ligneSelectionnee || infoWindow.getMap()) {
        ligneSelectionnee = null;
        appliquerStyleReseau();
        infoWindow.close();
    }
}

// ============================================================================
// SECTION 6 : CHARGEMENT DES DONNÉES - Réseau, Gares, Wi-Fi
// ============================================================================

/**
 * Charge les données du réseau ferré (GeoJSON)
 * et applique initialement les styles (masquées par défaut).
 */
// === OUTIL : Calcul de distance mathématique pour la "Hitbox" ===
function distancePointSegment(px, py, ax, ay, bx, by) {
    let l2 = Math.pow(ax - bx, 2) + Math.pow(ay - by, 2);
    if (l2 === 0) return Math.sqrt(Math.pow(px - ax, 2) + Math.pow(py - ay, 2));
    let t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / l2));
    let projX = ax + t * (bx - ax);
    let projY = ay + t * (by - ay);
    return Math.sqrt(Math.pow(px - projX, 2) + Math.pow(py - projY, 2));
}
// 1. Fonction pour le réseau ferré
function loadLGVLines() {
    
    // Fonction de style (qui gère la couleur, l'épaisseur et la surbrillance)
    const appliquerStyle = function(feature) { 
        if (!reseauVisible) return { visible: false };
        let estLGV = (feature.getProperty('CATLIG') === 'Ligne à grande vitesse');
        let couleurBase = estLGV ? '#E20074' : '#0055A4';
        let epaisseurBase = estLGV ? 4 : 1.5;

        // Mode Surbrillance
        if (ligneSelectionnee) {
            if (feature === ligneSelectionnee) {
                return { strokeColor: couleurBase, strokeWeight: epaisseurBase + 4, strokeOpacity: 1.0, zIndex: 100, clickable: false };
            } else {
                return { strokeColor: '#999999', strokeWeight: epaisseurBase, strokeOpacity: 0.3, zIndex: 1, clickable: false };
            }
        }

        // Mode Normal
        return { strokeColor: couleurBase, strokeWeight: epaisseurBase, strokeOpacity: 0.8, zIndex: estLGV ? 10 : 5, clickable: false };
    };

    if (!reseauDataLoaded) {
        reseauData.loadGeoJson('reseau.geojson');
        reseauDataLoaded = true;
        reseauData.loadGeoJson('reseau.geojson'); 
        reseauDataLoaded = true; 

        // LE NOUVEAU CLIC HITBOX (Directement sur la carte)
        map.addListener('click', function(event) {
            if (!reseauVisible) return;

            let clicLat = event.latLng.lat();
            let clicLng = event.latLng.lng();
            
            let meilleureLigne = null;
            // 0.05 degrés représente environ 5 kilomètres. C'est la taille de ta Hitbox !
            let minDistance = 0.05; 

            // On cherche la ligne la plus proche de notre clic
            reseauData.forEach(function(feature) {
                let geo = feature.getGeometry();
                
                const verifierChemin = (path) => {
                    let pts = path.getArray();
                    for (let i = 0; i < pts.length - 1; i++) {
                        let dist = distancePointSegment(
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

                if (geo.getType() === 'LineString') { verifierChemin(geo); } 
                else if (geo.getType() === 'MultiLineString') { geo.getArray().forEach(verifierChemin); }
            });

            if (meilleureLigne) {
                // On a cliqué DANS la Hitbox !
                ligneSelectionnee = meilleureLigne;
                reseauData.setStyle(appliquerStyle); 
                
                let typeLigne = meilleureLigne.getProperty('CATLIG');
                let idLigne = meilleureLigne.getProperty('LIB_LIGNE');
                
                let contenuBulle = `
                    <div style="color: #333; font-family: sans-serif; padding: 5px;">
                        <h3 style="margin: 0 0 5px 0; color: #004696; font-size: 16px;">Ligne ${idLigne}</h3>
                        <p style="margin: 0; font-size: 14px;"><strong>Type:</strong> ${typeLigne}</p>
                    </div>
                `;
                infoWindow.setContent(contenuBulle);
                infoWindow.setPosition(event.latLng); 
                infoWindow.open(map);
            } else {
                // On a cliqué loin de tout (Désélection)
                if (ligneSelectionnee) {
                    ligneSelectionnee = null;
                    reseauData.setStyle(appliquerStyle); 
                    infoWindow.close();
                }
            }
        });
    }

    // On applique le style au chargement
    reseauData.setStyle(appliquerStyle);
}

/**
 * Charge asynchroniquement les données Wi-Fi depuis le fichier JSON.
 * Stocke les résultats en cache pour éviter les appels répétés.
 */
async function loadWifiData() {
    if (!wifiDataLoaded) {
        console.log("Téléchargement des données Wi-Fi...");
        try {
            const reponse = await fetch('gares-equipees-du-wifi.json');
            wifiData = await reponse.json();
            wifiDataLoaded = true;
        } catch (erreur) {
            console.error("Erreur de chargement Wi-Fi :", erreur);
        }
    }
}

/**
 * Charge les données des gares depuis le GeoJSON local.
 * Déclenche aussi le chargement Wi-Fi et la mise à jour d'affichage.
 */
async function loadGares() {
    if (!garesDataLoaded) {
        console.log("Téléchargement des données des gares...");
        try {
            const reponse = await fetch('gares.geojson');
            const data = await reponse.json();
            toutesLesGares = data.features;  // Mettre en cache
            garesDataLoaded = true;
        } catch (erreur) {
            console.error("Erreur de chargement gares:", erreur);
            return;
        }
    }
    
    await loadWifiData();
    actualiserAffichageGares();
}

// ============================================================================
// SECTION 7 : AFFICHAGE GARES - OPTIMISATION VIEWPORT CULLING & ZOOM
// ============================================================================

/**
 * Gère dynamiquement l'affichage des marqueurs des gares selon:
 * - Limites actuelles du viewport (bounds de la carte)
 * - Niveau de zoom (zoom filters appliqués)
 * - Segment/catégorie de la gare (A/B/C)
 * 
 * OPTIMISATION : Utilise le "Viewport Culling" pour n'afficher que les
 * marqueurs visibles, réduisant drastiquement utilisé GPU/mémoire.
 */
function actualiserAffichageGares() {
    // Si les gares ne doivent pas être visibles, supprimer tous les marqueurs
    if (!garesVisible) {
        marqueursAffiches.forEach(m => m.setMap(null));
        marqueursAffiches = [];
        return;
    }

    // Récupérer les paramètres actuels de la carte
    let currentZoom = map.getZoom();
    let limitesEcran = map.getBounds();

    if (!limitesEcran) return;

    // Nettoyer tous les anciens marqueurs avant de redessiner
    marqueursAffiches.forEach(m => m.setMap(null));
    marqueursAffiches = [];

    // Parcourir toutes les gares en cache
    toutesLesGares.forEach(feature => {
        let coords = feature.geometry.coordinates;
        let props = feature.properties;
        let segment = props['Segment(s) DRG'];  // Catégorie A/B/C
        
        let position = new google.maps.LatLng(coords[1], coords[0]);

        // ---- FILTRE 1 : Viewport Culling ----
        // N'afficher que les gares visibles à l'écran
        if (!limitesEcran.contains(position)) return;

        // ---- FILTRE 2 : Zoom filtering ----
        // À zoom faible : afficher seulement les gares catégorie A (nationales)
        if (currentZoom < 8 && segment !== 'A') return;
        
        // À zoom moyen : masquer les gares catégorie C (trop nombreuses)
        if (currentZoom < 11 && segment === 'C') return;

        // ---- STYLES du marqueur selon la catégorie ----
        // Catégories SNCF : A=Nationale/TGV, B=Régionale, C=Locale
        let taillePoint = (segment === 'A') ? 9 : (segment === 'B' ? 7 : 5);
        let couleurPoint = (segment === 'A') ? '#E20074' : 
                          (segment === 'B' ? '#0088CE' : '#6C757D');

        // Créer le marqueur (symbole cercle plutôt qu'icône pour performance)
        let marker = new google.maps.Marker({
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

        // Ajouter l'écouteur de clic pour afficher la bulle d'info
        marker.addListener('click', async () => {
            let nomGare = props['Nom'];
            
            // Normalisation du nom pour le lien Wikipedia
            nomGare = nomGare.replace(/ - /g, '-');
            let commenceParVoyelle = /^[AEIOUYÉÈÊËÀÂÄÎÏÔÖÛÜ]/i.test(nomGare);
            let prefixe = commenceParVoyelle ? "Gare d'" : "Gare de ";
            let nomComplet = prefixe + nomGare;

            let lienWiki = "https://fr.wikipedia.org/w/index.php?search=" + 
                          encodeURIComponent(nomComplet);
            let idBulle = props['Code(s) UIC'];

            // Vérifier si cette gare a le Wi-Fi
            let aLeWifi = wifiData.some(gareWifi => 
                gareWifi.nom.toLowerCase() === props['Nom'].toLowerCase()
            );
            
            // Badge Wi-Fi SVG (s'affiche seulement si disponible)
            let badgeWifi = aLeWifi 
                ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" 
                        stroke="#0088CE" stroke-width="2.5" stroke-linecap="round" 
                        stroke-linejoin="round" style="margin-left: 8px; vertical-align: middle;" 
                        title="Wi-Fi disponible">
                     <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
                     <path d="M5 12.55a11 11 0 0 1 14.08 0"/>
                     <circle cx="12" cy="20" r="1.5" fill="#0088CE" stroke="none"/>
                   </svg>` 
                : '';

            // Créer le contenu HTML de la bulle
            let contenuBulle = `
                <div style="color: #333; font-family: sans-serif; padding: 5px; 
                           min-width: 200px; text-align: center;">
                    
                    <!-- Conteneur pour l'image Wikipedia (chargement asynchrone) -->
                    <div id="wiki-img-${idBulle}" style="min-height: 20px; margin-bottom: 10px;">
                        <span style="font-size: 11px; color: #888; font-style: italic;">
                            Recherche d'image... ⏳
                        </span>
                    </div>

                    <!-- Informations principales de la gare -->
                    <h3 style="margin: 0 0 5px 0; color: ${couleurPoint}; 
                              font-size: 16px; display: flex; align-items: center; 
                              justify-content: center;">
                        ${props['Nom']} ${badgeWifi}
                    </h3>
                    <p style="margin: 0; font-size: 14px;">
                        <strong>Code UIC:</strong> ${idBulle}
                    </p>
                    <p style="margin: 0; font-size: 12px; color: #666;">
                        Catégorie: ${segment}
                    </p>
                    
                    <!-- Lien vers Wikipedia -->
                    <div style="margin-top: 10px; border-top: 1px solid #eee; 
                               padding-top: 8px;">
                        <a href="${lienWiki}" target="_blank" 
                           style="color: #0055A4; text-decoration: none; 
                                  font-size: 13px; font-weight: bold;">
                            🌐 Voir sur Wikipédia ↗
                        </a>
                    </div>
                </div>
            `;
            
            // Afficher la bulle
            infoWindow.setContent(contenuBulle);
            infoWindow.open(map, marker);

            // ---- RÉCUPÉRATION ASYNCHRONE IMAGE WIKIPEDIA ----
            // Chercher l'article exact sur Wikipédia
            try {
                let urlSearch = "https://fr.wikipedia.org/w/api.php?action=opensearch&search=" + 
                               encodeURIComponent(nomComplet) + "&limit=1&format=json&origin=*";
                let reponseSearch = await fetch(urlSearch);
                let dataSearch = await reponseSearch.json();

                let conteneurImage = document.getElementById(`wiki-img-${idBulle}`);

                if (dataSearch[1] && dataSearch[1].length > 0) {
                    let titreExact = dataSearch[1][0];

                    // Récupérer le résumé et l'image de l'article
                    let urlApiWiki = "https://fr.wikipedia.org/api/rest_v1/page/summary/" + 
                                    encodeURIComponent(titreExact);
                    let reponse = await fetch(urlApiWiki);
                    
                    if (reponse.ok && conteneurImage) {
                        let donneesWiki = await reponse.json();
                        
                        // Afficher l'image si disponible
                        if (donneesWiki.thumbnail && donneesWiki.thumbnail.source) {
                            let urlImage = donneesWiki.thumbnail.source;
                            conteneurImage.innerHTML = `<img src="${urlImage}" 
                                alt="${titreExact}" 
                                style="width: 100%; max-height: 140px; object-fit: cover; 
                                       border-radius: 6px; 
                                       box-shadow: 0 2px 4px rgba(0,0,0,0.2);">`;
                        } else {
                            conteneurImage.style.display = 'none';
                        }
                    } else if (conteneurImage) {
                        conteneurImage.style.display = 'none';
                    }
                } else if (conteneurImage) {
                    conteneurImage.style.display = 'none';
                }
            } catch (erreur) {
                // Si erreur lors de la récup Wiki, masquer le conteneur d'image
                let conteneurImage = document.getElementById(`wiki-img-${idBulle}`);
                if (conteneurImage) conteneurImage.style.display = 'none';
            }
        });

        // Ajouter ce marqueur à la liste des affichés
        marqueursAffiches.push(marker);
    });
}

// ============================================================================
// SECTION 8 : AFFICHAGE FRÉQUENTATION - Heatmap Layer
// ============================================================================

/**
 * Crée et gère la couche Heatmap pour visualiser la fréquentation des gares.
 * Utilise le gradient de couleurs: Bleu (faible) → Vert → Jaune → Orange → Rouge (élevé)
 * Les données proviennent de frequentation.js (variable globale pre-chargée)
 */
function loadFrequentation() {
    // Créer la heatmap une seule fois
    if (!heatmap) {
        console.log("Création de la Heatmap...");
        
        // Vérifier que les données de fréquentation sont disponibles
        if (typeof frequentationData === 'undefined') {
            console.error("Fichier frequentation.js manquant ou mal chargé.");
            return;
        }

        // Transformer les données en format Google Maps Heatmap
        let heatmapData = frequentationData.map(point => {
            return {
                location: new google.maps.LatLng(point.lat, point.lng),
                weight: point.poids  // Poids = nombre de voyageurs
            };
        });

        // Initialiser la couche heatmap avec gradient personnalisé
        heatmap = new google.maps.visualization.HeatmapLayer({
            data: heatmapData,
            radius: 30,           // Rayon de lissage (en pixels)
            opacity: 0.7,         // Transparence
            maxIntensity: 5000000, // Seuil d'intensité max
            gradient: [
                'rgba(0, 0, 255, 0)',     // Bleu transparent (très faible)
                'rgba(65, 105, 225, 1)',  // Bleu royal
                'rgba(0, 255, 255, 1)',   // Cyan
                'rgba(0, 255, 0, 1)',     // Vert
                'rgba(255, 255, 0, 1)',   // Jaune
                'rgba(255, 165, 0, 1)',   // Orange
                'rgba(255, 0, 0, 1)'      // Rouge (très intense)
            ]
        });
    }

    // Afficher ou masquer la heatmap selon le flag
    if (frequentationVisible) {
        heatmap.setMap(map);
    } else {
        heatmap.setMap(null);
    }
}

// ============================================================================
// SECTION 9 : INITIALISATION MAP - Configuration Paramètres & Événements
// ============================================================================

/**
 * Point d'entrée principal d'initialisation de la carte Google Maps.
 * Configure les paramètres de base, ajoute les Data Layers, 
 * et définit les écouteurs d'événements.
 */
function initMap() {
    // --- Création de la carte avec paramètres SNCF ---
    map = new google.maps.Map(document.getElementById("app-container"), {
        center: { lat: 46.603354, lng: 1.888334 },  // Centre de la France
        zoom: 6,
        minZoom: 5,
        mapId: 'def9248b61a9c229f43789e9',  // ID style personnalisé
        restriction: { 
            latLngBounds: { 
                north: 51.5, 
                south: 41.0, 
                west: -5.5, 
                east: 9.5 
            }, 
            strictBounds: false 
        },
        disableDefaultUI: true,  // Masquer les contrôles par défaut
        zoomControl: true,       // Garder le zoom
    });

    // --- Initialiser le Data Layer pour le réseau ferré ---
    reseauData = new google.maps.Data();
    reseauData.setMap(map);

    // --- Créer la bulle d'information commune ---
    reseauHitbox = new google.maps.Data();
    reseauHitbox.setMap(map);

    infoWindow = new google.maps.InfoWindow({
        disableAutoPan: true  // Ne pas centrer automatiquement
    });
    
    // --- Afficher et positionner la légende ---
    const legend = document.getElementById("map-legend");
    legend.style.display = "block";
    map.controls[google.maps.ControlPosition.BOTTOM_LEFT].push(legend);
    
    // --- Listener : Redessiner les gares lors du changement de viewport ---
    map.addListener('idle', function() {
        if (garesVisible) actualiserAffichageGares();
    });

    // ========== GESTION DES CLICS (Réseau + Désélection) ==========
    
    let clicSurLigne = false;  // Flag pour éviter les conflits de clics

    // --- Clic sur une ligne du réseau ---
    reseauData.addListener('click', function(event) {
    // 1. Clic NATIF sur une ligne du réseau (Google gère la géométrie tout seul, instantanément)
    // 1. Clic sur la HITBOX (transparente et large)
    reseauHitbox.addListener('click', function(event) {
        if (!reseauVisible) return;
        clicSurLigne = true;
        
        // On récupère le nom de la ligne cliquée sur la hitbox
        let idLigneCliquee = event.feature.getProperty('LIB_LIGNE');
        let featureVisuelle = null;

        // On cherche sa jumelle dans le calque visuel
        reseauData.forEach(function(f) {
            if (f.getProperty('LIB_LIGNE') === idLigneCliquee) {
                featureVisuelle = f;
            }
        });

        // Si on la trouve, on applique la sélection visuelle
        if (featureVisuelle) {
            selectionnerLigne(featureVisuelle, event.latLng);
        }
        
        // Réinitialiser le flag après un court délai
        setTimeout(() => { clicSurLigne = false; }, 100);
    });

    // --- Clic dans le vide pour désélectionner ---
    map.addListener('click', function() {
        if (!clicSurLigne) {
            deselectionnerLigne();
        }
    });
}

/**
 * Bascule l'état "actif" d'un bouton HTML du menu.
 * Ajoute/enlève la classe CSS "active" selon l'état souhaité.
 * 
 * @param {string} appName - Nom de l'app (gares, reseau, frequentation)
 * @param {boolean} estActif - Décider si le bouton doit être marqué comme actif
 */
function basculerBouton(appName, estActif) {
    const bouton = document.getElementById("btn-" + appName);
    if (bouton) {
        if (estActif) {
            bouton.classList.add("active");
        } else {
            bouton.classList.remove("active");
        }
    }
}

// ============================================================================
// SECTION 10 : CONTRÔLE MENU - Basculer Applications & Vues
// ============================================================================

/**
 * Bascule l'affichage d'une couche de données (Gares, Réseau, Fréquentation).
 * Gère l'initialisation de la carte et le chargement des données à la demande.
 * 
 * @param {string} appName - Identifiant de l'app ('gares', 'reseau', 'frequentation')
 */
function loadApp(appName) {
    // Initialiser la carte si ce n'est pas déjà fait
    if (!map) initMap();

    // Fermer les bulles d'info existantes
    if (infoWindow) infoWindow.close();

    // ---------- GESTION GARES ----------
    if (appName === 'gares') {
        garesVisible = !garesVisible;           // Inverser l'état
        basculerBouton('gares', garesVisible);  // Mettre à jour le bouton UI
        
        if (!garesDataLoaded && garesVisible) {
            loadGares();                        // Charger les données
        } else {
            actualiserAffichageGares();         // Juste redessiner
        }
    }
    // ---------- GESTION RÉSEAU ----------
    else if (appName === 'reseau') {
        reseauVisible = !reseauVisible;
        basculerBouton('reseau', reseauVisible);
        loadLGVLines();
        if (!reseauVisible) deselectionnerLigne();
    }
    // ---------- GESTION FRÉQUENTATION ----------
    else if (appName === 'frequentation') {
        frequentationVisible = !frequentationVisible;
        basculerBouton('frequentation', frequentationVisible);
        loadFrequentation();
    }
}

/**
 * Gère le changement de vue dans l'interface (Accueil, À Propos, etc.).
 * Affiche/masque les sections appropriées.
 * 
 * @param {string} viewName - Nom de la vue à afficher ('home', 'about')
 */
function showView(viewName) {
    const dashboardView = document.getElementById('dashboard-view');
    const aboutView = document.getElementById('about-view');

    if (viewName === 'home') {
        // Afficher le tableau de bord avec la carte
        dashboardView.style.display = 'block';
        aboutView.style.display = 'none';
        
        // Redimensionner la carte (Google Maps a besoin d'être notifiée)
        if (map) {
            google.maps.event.trigger(map, 'resize');
        }
    } else if (viewName === 'about') {
        // Afficher la page À Propos
        dashboardView.style.display = 'none';
        aboutView.style.display = 'block';
    }
}

// ============================================================================
// SECTION 11 : EXPORT FONCTIONS GLOBALES
// ============================================================================
// Exposer les fonctions au scope global pour l'HTML inline onclick=

window.initMap = initMap;
window.loadApp = loadApp;
window.showView = showView;
