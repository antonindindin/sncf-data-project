"""
============================================================================
SNCF DATA PROJECT - CONVERSION DU CSV DES LIGNES EN reseau.js
============================================================================
Convertit le fichier officiel SNCF "lignes-lgv-et-par-ecartement.csv" en
un fichier reseau.js (variable globale reseauGeoJsonData) enrichi.

Chaque tronçon (feature) reçoit dans ses properties :
    - troncon_id : identifiant SÉQUENTIEL UNIQUE (0, 1, 2, ...) — c'est la
                   seule clé vraiment unique (ni IDGAIA ni (CODE_LIGNE,
                   RG_TRONCON) ne le sont dans ce jeu de données)
    - CODE_LIGNE, LIB_LIGNE, CATLIG, RG_TRONCON, PKD, PKF, IDGAIA
    - X_D_WGS84, Y_D_WGS84, X_F_WGS84, Y_F_WGS84 (extrémités précises,
      indispensables pour reconstruire le graphe des tronçons)

Usage :
    python3 convertir_lignes_en_js.py

Fichier d'entrée attendu (même dossier) :
    lignes-lgv-et-par-ecartement.csv

Fichier généré :
    reseau.js
"""

import csv
import json
import os
import sys

csv.field_size_limit(sys.maxsize)

NOM_CSV = "lignes-lgv-et-par-ecartement.csv"
NOM_SORTIE = "reseau.js"


def main():
    dossier = os.path.dirname(os.path.abspath(__file__))
    chemin_csv = os.path.join(dossier, NOM_CSV)
    chemin_out = os.path.join(dossier, NOM_SORTIE)

    print("=" * 70)
    print("  Conversion CSV des lignes SNCF → reseau.js")
    print("=" * 70)
    print(f"\nDossier : {dossier}\n")

    if not os.path.exists(chemin_csv):
        print(f"✗ Fichier introuvable : {chemin_csv}")
        print(f"  Place '{NOM_CSV}' dans le même dossier que ce script.")
        sys.exit(1)

    print(f"→ Lecture de {NOM_CSV}...")

    features = []
    nb_sans_geom = 0
    nb_total = 0

    with open(chemin_csv, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f, delimiter=';')
        for i, row in enumerate(reader):
            nb_total += 1

            geo_shape_brut = (row.get('Geo Shape') or '').strip()
            if not geo_shape_brut:
                # Tronçon sans géométrie (ligne non exploitée) : on l'ignore
                # pour l'affichage cartographique mais on garde l'info que
                # ce tronçon existe (utile pour la cohérence des troncon_id).
                nb_sans_geom += 1
                geometry = None
            else:
                try:
                    geometry = json.loads(geo_shape_brut)
                except json.JSONDecodeError:
                    nb_sans_geom += 1
                    geometry = None

            # Conversion sûre des coordonnées d'extrémités
            def to_float(v):
                try:
                    return float(v)
                except (TypeError, ValueError):
                    return None

            props = {
                'troncon_id': i,  # IDENTIFIANT UNIQUE SÉQUENTIEL
                'CODE_LIGNE': row.get('CODE_LIGNE', ''),
                'LIB_LIGNE': row.get('LIB_LIGNE', ''),
                'CATLIG': row.get('CATLIG', ''),
                'RG_TRONCON': row.get('RG_TRONCON', ''),
                'PKD': row.get('PKD', ''),
                'PKF': row.get('PKF', ''),
                'IDGAIA': row.get('IDGAIA', ''),
                'X_D_WGS84': to_float(row.get('X_D_WGS84')),
                'Y_D_WGS84': to_float(row.get('Y_D_WGS84')),
                'X_F_WGS84': to_float(row.get('X_F_WGS84')),
                'Y_F_WGS84': to_float(row.get('Y_F_WGS84')),
            }

            features.append({
                'type': 'Feature',
                'properties': props,
                'geometry': geometry,
            })

    geojson = {
        'type': 'FeatureCollection',
        'features': features,
    }

    print(f"  {nb_total} tronçons lus")
    print(f"  {nb_total - nb_sans_geom} avec géométrie, {nb_sans_geom} sans (ignorés à l'affichage)")

    # Écriture du fichier JS
    print(f"→ Génération de {NOM_SORTIE}...")
    contenu = "// Fichier généré automatiquement par convertir_lignes_en_js.py\n"
    contenu += "// Source : lignes-lgv-et-par-ecartement.csv (SNCF Réseau, ODbL)\n"
    contenu += "// Chaque feature possède un 'troncon_id' unique (0..N-1).\n"
    contenu += "const reseauGeoJsonData = "
    contenu += json.dumps(geojson, ensure_ascii=False)
    contenu += ";\n"

    with open(chemin_out, 'w', encoding='utf-8') as f:
        f.write(contenu)

    taille_mo = os.path.getsize(chemin_out) / (1024 * 1024)
    print(f"  ✓ Généré : {NOM_SORTIE} ({taille_mo:.1f} Mo)")
    print()
    print("=" * 70)
    print("  ✓ Conversion terminée")
    print("=" * 70)
    print("\n  Étape suivante : lance  python3 testghps.py")
    print("  pour régénérer graphe.js avec les troncon_id du trajet.")


if __name__ == "__main__":
    main()
