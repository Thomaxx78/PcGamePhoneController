# ⚽ Foot — manette sur téléphone, jeu sur l'ordi

Jeu de foot vu de haut (passe / tir / tacle), en 1v1, 2v2 ou 3v3.
Le **jeu s'affiche sur l'ordi**, chaque **téléphone devient une manette** (même WiFi).

## Lancer le jeu

Il faut avoir **Node.js** installé (https://nodejs.org).

```bash
npm install      # une seule fois, installe les dépendances
npm start        # démarre le serveur
```

Le terminal affiche deux adresses :

- **Jeu** : ouvre `http://localhost:3000/` dans le navigateur de l'ordi.
- **Manette** : un QR code s'affiche à l'écran du jeu.

## Connecter une manette

1. Vérifie que le téléphone est sur le **même WiFi** que l'ordi.
2. **Scanne le QR code** affiché à l'écran (ou tape l'adresse `http://<ip-de-l-ordi>:3000/controller.html`).
3. Mets le téléphone **en paysage**. Tu apparais sur le terrain.

Chaque nouveau téléphone est ajouté automatiquement à une équipe (alternance Azur / Mandarine).
2 téléphones = 1v1, 4 = 2v2, 6 = 3v3.

## Les commandes (sur le téléphone)

- **Joystick gauche** : se déplacer. La direction sert aussi à viser.
- **Passe** : tir court dans la direction visée.
- **Tir** : tir puissant.
- **Tacle** : courte accélération pour voler le ballon à l'adversaire.

## Régler le feeling

Tout se bidouille en haut de `public/game.js` (section « Réglages de gameplay ») :
vitesse, puissance de tir, durée du tacle, freinage du ballon, etc.

## Structure

```
server.js              -> serveur Node : sert les pages + relaie les entrées
public/game.html/.js   -> le jeu (tourne sur l'ordi, calcule tout)
public/controller.*    -> la manette (tourne sur le téléphone)
```

Le serveur ne calcule rien : il fait juste le pont. Toute la simulation
(joueurs, ballon, buts) tourne dans le navigateur de l'ordi.
```
# PcGamePhoneController
