PROTOCOLE DE DÉVELOPPEMENT - PROJET SNCF
Architecture & Workflow Git pour l'équipe

Ce document décrit la procédure exacte pour configurer son ordinateur et travailler quotidiennement sur le projet.


==================================================
1. LES CONCEPTS CLÉS (À lire avant de taper)
==================================================

Avant de taper du code, comprenez la philosophie :

Le Repository (Repo)
C'est le dossier du projet.
Il est stocké sur votre PC (Local) et sur GitHub (Cloud).

La branche main
C'est la version sacrée du projet.
Le code sur main doit toujours fonctionner.
On ne travaille jamais directement sur main.

Les branches feature
Ce sont des univers parallèles.

Quand tu veux ajouter une fonction (ex : la carte),
tu crées une branche (ex : feature-carte).
Tu peux tout casser dedans, ça ne gêne pas les autres.

Le Pull Request (PR)
C'est le moment où on demande de fusionner notre univers parallèle
avec la branche sacrée main.


==================================================
2. INSTALLATION INITIALE (À faire une seule fois)
==================================================

Pré-requis :
- Être sous Linux (Ubuntu ou Zorin)


--------------------------------------------------
Étape A : Créer son compte GitHub et configurer Git
--------------------------------------------------

1) Créer un compte sur github.com

2) Ouvrir un terminal (Ctrl + Alt + T) et configurer son identité :

git config --global user.name "Prenom Nom"
git config --global user.email "votre_email@exemple.com"


--------------------------------------------------
Étape B : La clé de sécurité (SSH)
--------------------------------------------------

Objectif : éviter de taper le mot de passe à chaque push.

Générer la clé :

ssh-keygen -t ed25519 -C "votre_email@exemple.com"

Appuyez sur Entrée à chaque question (laisser vide).

Afficher la clé publique :

cat ~/.ssh/id_ed25519.pub

Copier le texte affiché (commençant par ssh-ed25519).

Aller sur GitHub :
Settings > SSH and GPG keys > New SSH key
Coller la clé et valider.


--------------------------------------------------
Étape C : Récupérer le projet
--------------------------------------------------

Se placer dans le dossier Documents :

cd ~/Documents

Cloner le projet :

git clone git@github.com:antonindindin/sncf-data-project.git

Entrer dans le dossier :

cd sncf-data-project


--------------------------------------------------
Étape D : Configurer Python
--------------------------------------------------

Nous utilisons un environnement virtuel pour ne pas mélanger les librairies.

Créer l'environnement (si le dossier .venv n'existe pas) :

python3 -m venv backend/.venv


==================================================
3. WORKFLOW QUOTIDIEN (Boucle de travail)
==================================================

À chaque nouvelle fonctionnalité, suivre ces étapes dans l'ordre.


--------------------------------------------------
1. Mise à jour (avant de commencer)
--------------------------------------------------

git checkout main
git pull


--------------------------------------------------
2. Création de branche (nouvelle tâche)
--------------------------------------------------

Exemple : ajouter la lecture d'un CSV

git checkout -b feature-lecture-csv

Vous êtes maintenant sur votre branche.


--------------------------------------------------
3. Coder et activer Python
--------------------------------------------------

Si vous travaillez sur le backend :

source backend/.venv/bin/activate

Pour quitter l'environnement :

deactivate


--------------------------------------------------
4. Sauvegarder (commit)
--------------------------------------------------

git status
git add .
git commit -m "Explication claire de ce que j'ai fait"


--------------------------------------------------
5. Envoyer (push)
--------------------------------------------------

git push origin feature-lecture-csv


--------------------------------------------------
6. Fusionner (sur GitHub)
--------------------------------------------------

1) Aller sur la page du projet GitHub
2) Cliquer sur "Compare & pull request"
3) Écrire un commentaire clair
4) L'équipe valide et clique sur "Merge"
5) Supprimer la branche
6) Recommencer au début


==================================================
4. COMMANDES DE SECOURS (Cheat Sheet)
==================================================

Changer de branche :
git checkout nom-de-la-branche

Voir les branches :
git branch

Annuler les modifications locales :
git checkout .
ATTENTION : remet les fichiers comme au dernier commit.

Conflit Git :
Pas de panique.
Ouvrir VS Code, choisir les lignes à garder,
sauvegarder, puis :

git add .
git commit

Installer une librairie Python :
pip install nomlib

IMPORTANT :
Après installation :
pip freeze > backend/requirements.txt


==================================================
5. RÈGLES D'OR DE L'ÉQUIPE
==================================================

Atomique :
Faire des petits commits.
Mieux vaut 10 commits clairs qu'un seul énorme.

Explicite :
Interdit :
git commit -m "modif"

Obligatoire :
git commit -m "Correction bug affichage carte"

Propre :
Ne jamais pusher du code qui fait planter l'application.
Tester avant d'envoyer.

Communication :
Si vous touchez à un fichier critique (ex : main.py),
prévenez l'équipe sur Discord ou WhatsApp.

