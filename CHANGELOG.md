# Changelog

Toutes les modifications notables de Greenweez MCP sont documentées ici.

## 0.2.9 - 2026-08-07

### Corrigé

- Le serveur rend son onglet Camoufox partagé (DELETE /tabs/:id avec userId) sur SIGTERM, SIGINT et à la fin de stdin : le transport stdio du SDK n'émettant jamais onclose quand le client parent meurt, chaque validation AgentVegan laissait fuir un onglet jusqu'à saturer la session.
- Le CLI ferme lui aussi l'onglet partagé à la fin de chaque commande, y compris en erreur.
- La version annoncée au client MCP suit désormais package.json au lieu d'une constante restée à 0.2.1.
- Suppression d'une auto-dépendance accidentelle vers ncleton-petitmaker/greenweez-mcp v0.2.4, dépôt aujourd'hui disparu, qui pouvait faire échouer npm ci et npm install.

## 0.2.1 — 2026-08-03

### Ajouté

- Wizard d’onboarding `connect_greenweez` sur loopback, à URL éphémère, avec connexion à un compte existant et création officielle de compte.
- Prompt MCP `onboard_greenweez`, instructions de démarrage et fermeture du wizard à l’arrêt du serveur.

## 0.2.0 — 2026-08-03

### Ajouté

- Recherche catalogue et lecture détaillée des produits.
- Lecture de panier minimale, sans données de profil, livraison ou paiement.
- Ajout et retrait de panier avec prévisualisation, confirmation unique, verrouillage et relecture réelle.
- Bundle de session chiffré, portable et isolé par identifiant local Camofox.
- Publication GitHub reproductible : CI, audit de confidentialité, vérification d’artefact et release sur tag.
