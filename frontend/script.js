let map; // Variable globale pour stocker la carte

// Fonction pour charger et dessiner le réseau ferré
function loadLGVLines() {
    console.log("Chargement du réseau ferré...");

    // 1. Demander à Google Maps de charger le fichier que Python a généré
    map.data.loadGeoJson('reseau.geojson');

    // 2. Appliquer un style (code couleur) selon le type de voie
    map.data.setStyle(function(feature) {
        // Récupérer la catégorie de la ligne (définie dans le script Python)
        let categorie = feature.getProperty('CATLIG');
        
        let couleur = '#888888'; // Gris par défaut
        let epaisseur = 2;
        let ordreSuperposition = 1;

        // Différencier visuellement les lignes
        if (categorie === 'Ligne à grande vitesse') {
            couleur = '#0055A4'; // Bleu vif pour les TGV
            epaisseur = 4;       // Plus épais
            ordreSuperposition = 10; // Placer les LGV au-dessus du reste
        } 
        else if (categorie === 'Ligne du réseau conventionnel à écartement normal') {
            couleur = '#0088CE'; // Bleu clair/cyan pour les lignes classiques
            epaisseur = 1.5;
            ordreSuperposition = 5;
        } 
        else if (categorie === 'Ligne du réseau conventionnel à voie étroite') {
            couleur = '#E84E0F'; // Orange pour les réseaux locaux/montagne
            epaisseur = 1.5;
            ordreSuperposition = 5;
        }

        // Retourner les instructions de dessin à la carte
        return {
            strokeColor: couleur,
            strokeWeight: epaisseur,
            strokeOpacity: 0.8,
            zIndex: ordreSuperposition
        };
    });

    // 3. Optionnel : Ajouter une interactivité au clic sur une ligne
    map.data.addListener('click', function(event) {
        let typeLigne = event.feature.getProperty('CATLIG');
        let idLigne = event.feature.getProperty('LIB_LIGNE');
        alert("Ligne n°" + idLigne + "\nType : " + typeLigne);
    });
}

// Fonction appelée automatiquement par Google Maps quand le script est chargé
function initMap() {
    // 1. Coordonnées du centre de la France
    const centreFrance = { lat: 46.603354, lng: 1.888334 };

    // 2. On définit la "boîte" invisible qui bloque la caméra autour de la France
    const limitesFrance = {
        north: 51.5, // Frontière Nord
        south: 41.0, // Sud (Corse incluse)
        west: -5.5,  // Ouest (Bretagne)
        east: 9.5,   // Est (Alsace/Alpes)
    };

    // 3. Création et configuration de la carte
    map = new google.maps.Map(document.getElementById("app-container"), {
        center: centreFrance,
        zoom: 6, // Zoom initial
        minZoom: 5, // Empêche l'utilisateur de trop dézoomer pour voir la Terre entière
        
        // ⚠️ TRÈS IMPORTANT : Mets ton vrai Map ID ici pour charger tes couleurs
        mapId: 'def9248b61a9c229f43789e9', 
        
        // 4. On applique le mur invisible (Restriction)
        restriction: {
            latLngBounds: limitesFrance,
            strictBounds: false,
        },

        // 5. Nettoyage de l'interface (UI)
        disableDefaultUI: true, // Cette commande nucléaire désactive TOUT (Satellite, Street View, etc.)
        zoomControl: true,      // Mais on réactive manuellement les boutons + et -
    });
    loadLGVLines(); // Appel de la fonction pour charger les lignes LGV après l'initialisation de la carte
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

// Rend la fonction initMap disponible globalement pour Google Maps
window.initMap = initMap;