let map; // Variable globale pour stocker la carte

// Fonction appelée automatiquement par Google Maps quand le script est chargé
function initMap() {
    // Coordonnées du centre de la France (environ)
    const centreFrance = { lat: 46.603354, lng: 1.888334 };

    // Définition des limites de la France métropolitaine
    const limitesFrance = {
        north: 51.5,
        south: 41.0,
        west: -5.5,
        east: 9.5,
    };

    // Création de la carte
    map = new google.maps.Map(document.getElementById("app-container"), {
        center: centreFrance,
        zoom: 6,
        minZoom: 5,
        mapId: 'def9248b61a9c229f43789e9',
        
        // Restriction géographique
        restriction: {
            latLngBounds: limitesFrance,
            strictBounds: false,
        },

        // UI minimaliste
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        zoomControl: true,
    });

    // Ajouter un marqueur sur Paris (Gare de Lyon)
    new google.maps.Marker({
        position: { lat: 48.8443, lng: 2.3744 },
        map: map,
        title: "Gare de Lyon",
    });
}

function loadApp(appName) {
    console.log("Lancement du module : " + appName);
    
    if (appName === 'gares') {
        if (!map) {
            initMap(); 
        } else {
            map.setZoom(6);
        }
    }
}

window.initMap = initMap;

