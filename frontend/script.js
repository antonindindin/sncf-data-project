let map; // Variable globale pour stocker la carte
let reseauDataLoaded = false; // Nouveau : Pour savoir si le GeoJSON a déjà été chargé
let reseauVisible = false;    // Nouveau : Pour savoir si le réseau est actuellement visible

// Fonction pour charger et dessiner le réseau ferré (maintenant gère aussi la visibilité)
function loadLGVLines() {
    // 1. Demander à Google Maps de charger le fichier que Python a généré, une seule fois
    if (!reseauDataLoaded) {
        console.log("Chargement initial du réseau ferré...");
        map.data.loadGeoJson('reseau.geojson');
        reseauDataLoaded = true; // Marquer le GeoJSON comme chargé

        // 3. Optionnel : Ajouter une interactivité au clic sur une ligne (une seule fois)
        map.data.addListener('click', function(event) {
            let typeLigne = event.feature.getProperty('CATLIG');
            let idLigne = event.feature.getProperty('LIB_LIGNE');
            alert("Ligne n°" + idLigne + "\nType : " + typeLigne);
        });
    }

    // 2. Appliquer un style (code couleur) selon le type de voie, en tenant compte de la visibilité
    map.data.setStyle(function(feature) {
        // Si le réseau ne doit pas être visible, masquer toutes les fonctionnalités
        if (!reseauVisible) {
            return { visible: false };
        }

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

        // Retourner les instructions de dessin à la carte
        return {
            strokeColor: couleur,
            strokeWeight: epaisseur,
            strokeOpacity: 0.8,
            zIndex: ordreSuperposition,
            visible: true // Rendre visible si reseauVisible est vrai
        };
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
    // Suppression de l'appel direct à loadLGVLines() ici.
    // Le réseau ferré ne se chargera plus automatiquement au démarrage.
}

function loadApp(appName) {
    console.log("Lancement du module : " + appName);
    
    // Assurez-vous que la carte est initialisée si elle ne l'est pas
    if (!map) {
        initMap(); 
    }

    if (appName === 'gares') {
        // Si le réseau ferré était visible, le masquer lors du passage à une autre application
        if (reseauVisible) {
            reseauVisible = false; // Mettre à jour l'état de visibilité
            loadLGVLines();        // Ré-appliquer le style pour cacher le réseau
        }
        map.setZoom(6); // Exemple : Réinitialiser le zoom pour l'application "Gares"
    } else if (appName === 'reseau') {
        reseauVisible = !reseauVisible; // Basculer l'état de visibilité (afficher/masquer)
        loadLGVLines();                 // Charger les données (si pas déjà fait) et ré-appliquer le style en fonction du nouvel état
    }
}

// Rend la fonction initMap disponible globalement pour Google Maps
window.initMap = initMap;