// Variables globales
let map; 

// === RESEAU FERRE ===
let reseauData; // On déclare la variable ici, on l'initialise plus tard
let reseauDataLoaded = false; 
let reseauVisible = false;    

// === GARES ET VILLES ===
let garesData;   
let garesDataLoaded = false;
let garesVisible = false;

// Fonction pour charger et dessiner le réseau ferré
function loadLGVLines() {
    if (!reseauDataLoaded) {
        console.log("Chargement initial du réseau ferré...");
        reseauData.loadGeoJson('reseau.geojson'); 
        reseauDataLoaded = true; 

        reseauData.addListener('click', function(event) { 
            let typeLigne = event.feature.getProperty('CATLIG');
            let idLigne = event.feature.getProperty('LIB_LIGNE');
            alert("Ligne n°" + idLigne + "\nType : " + typeLigne);
        });
    }

    // Appliquer le style et la visibilité
    reseauData.setStyle(function(feature) { 
        if (!reseauVisible) {
            return { visible: false };
        }

        let categorie = feature.getProperty('CATLIG');
        let couleur = '#888888'; 
        let epaisseur = 2;
        let ordreSuperposition = 1;

        if (categorie === 'Ligne à grande vitesse') {
            couleur = '#0055A4'; 
            epaisseur = 4;       
            ordreSuperposition = 10; 
        } 
        else if (categorie === 'Ligne du réseau conventionnel à écartement normal') {
            couleur = '#0088CE'; 
            epaisseur = 1.5;
            ordreSuperposition = 5;
        } 

        return {
            strokeColor: couleur,
            strokeWeight: epaisseur,
            strokeOpacity: 0.8,
            zIndex: ordreSuperposition,
            visible: true
        };
    });
}

// Fonction pour charger et dessiner les gares
function loadGares() {
    if (!garesDataLoaded) {
        console.log("Chargement initial des gares...");
        garesData.loadGeoJson('gares.geojson'); 
        garesDataLoaded = true;

        garesData.addListener('click', function(event) { 
            if (event.feature.getGeometry().getType() === 'Point') { 
                // La colonne dans le CSV s'appelle 'Nom'
                let nomGare = event.feature.getProperty('Nom');
                let uic = event.feature.getProperty('Code(s) UIC');
                alert("Gare : " + nomGare + "\nCode UIC : " + uic);
            }
        });
    }

    garesData.setStyle(function(feature) { 
        if (!garesVisible) {
            return { visible: false };
        }
        
        if (feature.getGeometry().getType() === 'Point') {
            // On peut adapter la taille selon que ce soit une très grande gare (A) ou régionale (B)
            let segment = feature.getProperty('Segment(s) DRG');
            let taillePoint = (segment === 'A') ? 6 : 4; // Plus gros pour les gares nationales
            let couleurPoint = (segment === 'A') ? '#E84E0F' : '#FFB612'; // Orange SNCF pour A, Jaune pour B

            return {
                icon: {
                    path: google.maps.SymbolPath.CIRCLE,
                    scale: taillePoint, 
                    fillColor: couleurPoint, 
                    fillOpacity: 1,
                    strokeColor: '#FFFFFF', // Contour blanc pour bien détacher de la carte
                    strokeWeight: 1.5
                },
                visible: true 
            };
        }
        return { visible: false }; 
    });
}

// Fonction appelée par Google Maps
function initMap() {
    const centreFrance = { lat: 46.603354, lng: 1.888334 };
    const limitesFrance = {
        north: 51.5, south: 41.0, west: -5.5, east: 9.5, 
    };

    map = new google.maps.Map(document.getElementById("app-container"), {
        center: centreFrance,
        zoom: 6, 
        minZoom: 5, 
        mapId: 'def9248b61a9c229f43789e9', 
        restriction: { latLngBounds: limitesFrance, strictBounds: false },
        disableDefaultUI: true, 
        zoomControl: true,      
    });

    // === NOUVEAU : C'EST ICI QU'IL FAUT CRÉER LES CALQUES ===
    // À ce stade, on est sûr que l'API Google Maps est chargée !
    reseauData = new google.maps.Data();
    garesData = new google.maps.Data();

    reseauData.setMap(map);
    garesData.setMap(map);
}

// Gestion des clics sur les boutons du menu
function loadApp(appName) {
    console.log("Lancement du module : " + appName);
    
    if (!map) initMap(); 

    if (appName === 'gares') {
        // On active les gares et on désactive le réseau
        reseauVisible = false;
        garesVisible = true; 
        
        loadLGVLines(); // Met à jour le style (masque)
        loadGares();    // Met à jour le style (affiche)
        map.setZoom(6); 
    } 
    else if (appName === 'reseau') {
        // On active le réseau et on désactive les gares
        garesVisible = false;
        reseauVisible = true; 
        
        loadGares();    // Met à jour le style (masque)
        loadLGVLines(); // Met à jour le style (affiche)
    }
}

window.initMap = initMap;