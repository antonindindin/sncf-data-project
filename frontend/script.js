// Variables globales
let map; 
let infoWindow; // <-- NOUVEAU : La bulle d'information

// === RESEAU FERRE (Lignes) ===
let reseauData; 
let reseauDataLoaded = false; 
let reseauVisible = false;    

// === GARES ET VILLES (Points ultra-optimisés) ===
let toutesLesGares = [];      
let marqueursAffiches = [];   
let garesDataLoaded = false;
let garesVisible = false;

// === FREQUENTATION (Heatmap) ===
let heatmap = null;
let frequentationVisible = false;

// 1. Fonction pour le réseau ferré
function loadLGVLines() {
    if (!reseauDataLoaded) {
        reseauData.loadGeoJson('reseau.geojson'); 
        reseauDataLoaded = true; 

        reseauData.addListener('click', function(event) { 
            let typeLigne = event.feature.getProperty('CATLIG');
            let idLigne = event.feature.getProperty('LIB_LIGNE');
            
            // On crée le HTML de la bulle
            let contenuBulle = `
                <div style="color: #333; font-family: sans-serif; padding: 5px;">
                    <h3 style="margin: 0 0 5px 0; color: #004696; font-size: 16px;">Ligne ${idLigne}</h3>
                    <p style="margin: 0; font-size: 14px;"><strong>Type:</strong> ${typeLigne}</p>
                </div>
            `;
            // On met le texte, on la place à l'endroit du clic, et on l'ouvre
            infoWindow.setContent(contenuBulle);
            infoWindow.setPosition(event.latLng);
            infoWindow.open(map);
        });
    }

    reseauData.setStyle(function(feature) { 
        if (!reseauVisible) return { visible: false };
        let estLGV = (feature.getProperty('CATLIG') === 'Ligne à grande vitesse');
        return {
            strokeColor: estLGV ? '#E20074' : '#0055A4',
            strokeWeight: estLGV ? 4 : 1.5,
            strokeOpacity: 0.8,
            zIndex: estLGV ? 10 : 5,
            visible: true
        };
    });
}

// 2. Fonction de téléchargement des gares
async function loadGares() {
    if (!garesDataLoaded) {
        console.log("Téléchargement des données des gares...");
        try {
            const reponse = await fetch('gares.geojson');
            const data = await reponse.json();
            toutesLesGares = data.features; 
            garesDataLoaded = true;
        } catch (erreur) {
            console.error("Erreur de chargement :", erreur);
            return;
        }
    }
    actualiserAffichageGares();
}

// 3. LA FONCTION MAGIQUE (Viewport Culling + Filtre de zoom)
function actualiserAffichageGares() {
    if (!garesVisible) {
        marqueursAffiches.forEach(m => m.setMap(null));
        marqueursAffiches = [];
        return;
    }

    let currentZoom = map.getZoom();
    let limitesEcran = map.getBounds(); 

    if (!limitesEcran) return; 

    marqueursAffiches.forEach(m => m.setMap(null));
    marqueursAffiches = [];

    toutesLesGares.forEach(feature => {
        let coords = feature.geometry.coordinates;
        let props = feature.properties;
        let segment = props['Segment(s) DRG'];
        
        let position = new google.maps.LatLng(coords[1], coords[0]); 

        if (!limitesEcran.contains(position)) return;

        if (currentZoom < 8 && segment !== 'A') return;
        if (currentZoom < 11 && segment === 'C') return;

        let taillePoint = (segment === 'A') ? 9 : (segment === 'B' ? 7 : 5);        
        let couleurPoint = (segment === 'A') ? '#E20074' : (segment === 'B' ? '#0088CE' : '#6C757D');

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

        marker.addListener('click', () => {
            let contenuBulle = `
                <div style="color: #333; font-family: sans-serif; padding: 5px; min-width: 150px;">
                    <h3 style="margin: 0 0 5px 0; color: ${couleurPoint}; font-size: 16px;">${props['Nom']}</h3>
                    <p style="margin: 0; font-size: 14px;"><strong>Code UIC:</strong> ${props['Code(s) UIC']}</p>
                    <p style="margin: 0; font-size: 12px; color: #666;">Catégorie: ${segment}</p>
                </div>
            `;
            infoWindow.setContent(contenuBulle);
            infoWindow.open(map, marker); 
        });
        marqueursAffiches.push(marker); 
    });
}

// 4. Fonction pour charger la carte de chaleur (Fréquentation)
function loadFrequentation() {
    // Si la heatmap n'est pas encore créée
    if (!heatmap) {
        console.log("Création de la Heatmap...");
        
        // On vérifie que les données sont bien là
        if (typeof frequentationData === 'undefined') {
            console.error("Fichier frequentation.js manquant ou mal chargé.");
            return;
        }

        // On formate les données pour l'API Google
        let heatmapData = frequentationData.map(point => {
            return {
                location: new google.maps.LatLng(point.lat, point.lng),
                weight: point.poids
            };
        });

        
        // On crée la couche visuelle avec des paramètres pour un rendu DIFFUS
        heatmap = new google.maps.visualization.HeatmapLayer({
            data: heatmapData,
            
            // --- CHANGEMENT 1 : LE RAYON ---
            // Passe de 25 à 80 (ou même 100 ou 120 selon tes goûts).
            // Plus c'est grand, plus les points se mélangent en une nappe floue.
            radius: 30,       

            // --- CHANGEMENT 2 : L'OPACITÉ ---
            // Un peu plus transparent pour un effet plus "vaporeux".
            opacity: 0.7,     

            // --- CHANGEMENT 3 : LE PLAFOND D'INTENSITÉ (CRUCIAL) ---
            // On DÉCOMMENTE cette ligne.
            // On fixe le "maximum rouge" à 5 millions (moyenne sur 10 ans).
            // Ainsi, Paris sera rouge, mais Lyon, Bordeaux, Lille le seront aussi,
            // créant des zones de chaleur régionales au lieu d'un seul point à Paris.
            maxIntensity: 5000000, 

            gradient: [
                'rgba(0, 0, 255, 0)',     // Transparent
                'rgba(65, 105, 225, 1)',  // Bleu froid
                'rgba(0, 255, 255, 1)',   // Cyan
                'rgba(0, 255, 0, 1)',     // Vert
                'rgba(255, 255, 0, 1)',   // Jaune
                'rgba(255, 165, 0, 1)',   // Orange
                'rgba(255, 0, 0, 1)'      // Rouge chaud
            ]
        });
    }
// ... fin de la fonction ...

    // On l'affiche ou on la cache en fonction de l'interrupteur
    if (frequentationVisible) {
        heatmap.setMap(map);
    } else {
        heatmap.setMap(null);
    }
}

// 5. Initialisation de la carte
function initMap() {
    map = new google.maps.Map(document.getElementById("app-container"), {
        center: { lat: 46.603354, lng: 1.888334 },
        zoom: 6, 
        minZoom: 5, 
        mapId: 'def9248b61a9c229f43789e9', 
        restriction: { latLngBounds: { north: 51.5, south: 41.0, west: -5.5, east: 9.5 }, strictBounds: false },
        disableDefaultUI: true, 
        zoomControl: true,      
    });

    reseauData = new google.maps.Data();
    reseauData.setMap(map);

    infoWindow = new google.maps.InfoWindow(); // Création de la bulle vide

    // On récupère la légende dans le HTML et on la place en bas à droite de la carte !
    const legend = document.getElementById("map-legend");
    legend.style.display = "block"; // On la rend visible
    map.controls[google.maps.ControlPosition.BOTTOM_LEFT].push(legend);
    map.addListener('idle', function() {
        if (garesVisible) actualiserAffichageGares();
    });
}

// Fonction utilitaire pour allumer/éteindre un bouton HTML
function basculerBouton(appName, estActif) {
    const bouton = document.getElementById("btn-" + appName);
    if (bouton) {
        if (estActif) bouton.classList.add("active");
        else bouton.classList.remove("active");
    }
}

// 6. Gestion des clics sur le menu
function loadApp(appName) {
    if (!map) initMap(); 

    // On ferme la bulle d'info quand on change de menu pour faire propre
    if (infoWindow) infoWindow.close();

    if (appName === 'gares') {
        garesVisible = !garesVisible; 
        basculerBouton('gares', garesVisible); // <-- Mise à jour du bouton
        
        if (!garesDataLoaded && garesVisible) {
            loadGares();    
        } else {
            actualiserAffichageGares(); 
        }
    } 
    else if (appName === 'reseau') {
        reseauVisible = !reseauVisible; 
        basculerBouton('reseau', reseauVisible); // <-- Mise à jour du bouton
        loadLGVLines(); 
    }
    else if (appName === 'frequentation') {
        frequentationVisible = !frequentationVisible; 
        basculerBouton('frequentation', frequentationVisible); // <-- Mise à jour du bouton
        loadFrequentation(); 
    }
}

window.initMap = initMap;
window.loadApp = loadApp;