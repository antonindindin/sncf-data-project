import csv
import json

# Chemins de tes fichiers (adapte les chemins si besoin selon tes dossiers)
fichier_frequentation = '/home/antonin/Documents/sncf-data-project/data/frequentation-gares.csv' # Ou le chemin exact de ton CSV
fichier_geojson = '/home/antonin/Documents/sncf-data-project/frontend/gares.geojson'
fichier_sortie_js = '/home/antonin/Documents/sncf-data-project/frontend/frequentation.js'

# 1. Lire le CSV et calculer la moyenne
dictionnaire_frequentation = {}
annees = [str(annee) for annee in range(2015, 2025)] # De 2015 à 2024

print("1. Analyse du fichier de fréquentation...")
with open(fichier_frequentation, mode='r', encoding='utf-8') as f:
    lecteur = csv.DictReader(f, delimiter=';')
    
    for ligne in lecteur:
        code_uic = ligne.get('Code UIC', '').strip()
        
        # On calcule la moyenne des voyageurs pour cette gare
        total_voyageurs = 0
        nb_annees_valides = 0
        
        for annee in annees:
            colonne = f"Total Voyageurs {annee}"
            if colonne in ligne and ligne[colonne].strip():
                try:
                    total_voyageurs += float(ligne[colonne])
                    nb_annees_valides += 1
                except ValueError:
                    pass
        
        if nb_annees_valides > 0 and code_uic:
            moyenne = total_voyageurs / nb_annees_valides
            dictionnaire_frequentation[code_uic] = moyenne

print(f"-> {len(dictionnaire_frequentation)} gares analysées avec succès.")

# 2. Lire le GeoJSON et croiser les données
print("2. Croisement avec les coordonnées GPS...")
donnees_heatmap = []

with open(fichier_geojson, mode='r', encoding='utf-8') as f:
    geojson_data = json.load(f)
    
    for feature in geojson_data['features']:
        # Le nom exact de la propriété dépend de ton GeoJSON, on prend les plus courants
        props = feature.get('properties', {})
        code_uic_geo = str(props.get('Code(s) UIC', props.get('code_uic', ''))).strip()
        
        # Si on trouve la fréquentation correspondante à ce code
        if code_uic_geo in dictionnaire_frequentation:
            coords = feature['geometry']['coordinates']
            
            # On ajoute le point (Attention : GeoJSON = [Longitude, Latitude])
            donnees_heatmap.append({
                "lat": coords[1],
                "lng": coords[0],
                "poids": dictionnaire_frequentation[code_uic_geo]
            })

print(f"-> {len(donnees_heatmap)} gares géolocalisées avec leur fréquentation.")

# 3. Créer le fichier JavaScript final
print("3. Création du fichier JS...")
with open(fichier_sortie_js, mode='w', encoding='utf-8') as f:
    f.write("const frequentationData = ")
    json.dump(donnees_heatmap, f)
    f.write(";")

print(f"✅ Terminé ! Le fichier {fichier_sortie_js} est prêt à être utilisé.")