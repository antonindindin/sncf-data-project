// Variables globales
let map; 

// === RESEAU FERRE (Lignes) ===
let reseauData; 
let reseauDataLoaded = false; 
let reseauVisible = false;    

// === GARES ET VILLES (Points ultra-optimisés) ===
let toutesLesGares = [];      // Va stocker les données brutes
let marqueursAffiches = [];   // Va stocker les gares actuellement dessinées à l'écran
let garesDataLoaded = false;
let garesVisible = false;

// 1. Fonction pour le réseau ferré (On garde le système natif, très bon pour les lignes)
function loadLGVLines() {
    if (!reseauDataLoaded) {
        reseauData.loadGeoJson('reseau.geojson'); 
        reseauDataLoaded = true; 

        reseauData.addListener('click', function(event) { 
            alert("Ligne n°" + event.feature.getProperty('LIB_LIGNE') + "\nType : " + event.feature.getProperty('CATLIG'));
        });
    }

    reseauData.setStyle(function(feature) { 
        if (!reseauVisible) return { visible: false };
        let estLGV = (feature.getProperty('CATLIG') === 'Ligne à grande vitesse');
        return {
            strokeColor: estLGV ? '#0055A4' : '#0088CE',
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
            toutesLesGares = data.features; // On sauvegarde tout en mémoire, sans rien dessiner
            garesDataLoaded = true;
        } catch (erreur) {
            console.error("Erreur de chargement :", erreur);
            return;
        }
    }
    // Une fois téléchargé, on actualise ce qu'on doit voir
    actualiserAffichageGares();
}

// 3. LA FONCTION MAGIQUE (Viewport Culling + Filtre de zoom)
function actualiserAffichageGares() {
    // Si le module n'est pas actif, on nettoie l'écran et on s'arrête
    if (!garesVisible) {
        marqueursAffiches.forEach(m => m.setMap(null));
        marqueursAffiches = [];
        return;
    }

    let currentZoom = map.getZoom();
    let limitesEcran = map.getBounds(); // Récupère le rectangle de l'écran (Nord/Sud/Est/Ouest)

    if (!limitesEcran) return; // Sécurité si la carte n'est pas encore prête

    // On efface les anciens marqueurs
    marqueursAffiches.forEach(m => m.setMap(null));
    marqueursAffiches = [];

    // On parcourt nos 3000 gares stockées en mémoire
    toutesLesGares.forEach(feature => {
        let coords = feature.geometry.coordinates;
        let props = feature.properties;
        let segment = props['Segment(s) DRG'];
        
        // On crée un objet "Position" compréhensible par Google Maps
        let position = new google.maps.LatLng(coords[1], coords[0]); 

        // === FILTRE 1 : LA GARE EST-ELLE DANS L'ÉCRAN ? ===
        // Si elle est hors de l'écran, on passe à la suivante immédiatement
        if (!limitesEcran.contains(position)) return;

        // === FILTRE 2 : NIVEAU DE ZOOM ===
        // Zoom < 8 : On ne garde que les gares majeures (A)
        if (currentZoom < 8 && segment !== 'A') return;
        // Zoom < 11 : On garde les A et les B
        if (currentZoom < 11 && segment === 'C') return;

        // Si on arrive ici, c'est que la gare est DANS l'écran et qu'on a le BON ZOOM.
        // On la dessine !
        let taillePoint = (segment === 'A') ? 5 : (segment === 'B' ? 4 : 3); 
        // Correction de la syntaxe de l'opérateur ternaire pour la couleur
        let couleurPoint = (segment === 'A') ? '#0055A4' : (segment === 'B' ? '#0088CE' : '#0022ce');

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
            alert("Gare : " + props['Nom'] + "\nCode UIC : " + props['Code(s) UIC']);
        });

        marqueursAffiches.push(marker); // On la garde en mémoire pour pouvoir l'effacer plus tard
    });
}

// 4. Initialisation de la carte
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

    // === L'ASTUCE ANTI-LAG EST ICI ===
    // "idle" se déclenche UNIQUEMENT quand l'utilisateur a FINI de bouger ou zoomer.
    // Cela évite de calculer 60 fois par seconde pendant un mouvement.
    map.addListener('idle', function() {
        if (garesVisible) {
            actualiserAffichageGares();
        }
    });
}

// 5. Gestion des clics sur le menu
function loadApp(appName) {
    if (!map) initMap(); 

    if (appName === 'gares') {
        reseauVisible = false;
        garesVisible = true; 
        loadLGVLines(); // Cache les lignes
        loadGares();    // Lance notre super logique d'affichage
    } 
    else if (appName === 'reseau') {
        garesVisible = false;
        reseauVisible = true; 
        actualiserAffichageGares(); // Va nettoyer l'écran des gares
        loadLGVLines(); // Affiche les lignes
    }
}

window.initMap = initMap;
window.loadApp = loadApp;