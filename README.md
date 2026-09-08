# 🛒 Greenweez MCP

<p align="center">
  <img src="assets/greenweez-mcp-banner.svg" alt="Greenweez MCP — catalogue et panier sécurisé" width="760" />
</p>

<p align="center">
  <a href="https://github.com/ncleton/greenweez-mcp/actions/workflows/ci.yml"><img src="https://github.com/ncleton/greenweez-mcp/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/ncleton/greenweez-mcp/releases"><img src="https://img.shields.io/github/v/release/ncleton/greenweez-mcp?display_name=tag&sort=semver" alt="GitHub release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/ncleton/greenweez-mcp" alt="MIT License" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-%3E%3D22.12.0-339933?logo=nodedotjs&logoColor=white" alt="Node.js 22.12+" /></a>
  <a href="https://modelcontextprotocol.io/"><img src="https://img.shields.io/badge/MCP-stdio-10a37f" alt="Model Context Protocol over stdio" /></a>
</p>

Serveur [Model Context Protocol](https://modelcontextprotocol.io/) non officiel pour Greenweez. Il permet à Codex, Claude Code et tout client MCP compatible de rechercher le catalogue, lire les fiches produit et gérer un panier réel avec une confirmation sûre.

> [!IMPORTANT]
> Projet indépendant, sans affiliation avec Greenweez. Le connecteur ne valide jamais une commande et ne déclenche aucun paiement.

## Ce que le MCP apporte

| Capacité | Ce qui est retourné ou garanti |
| --- | --- |
| 🔎 Catalogue | Nom, marque, référence, URL, prix et prix unitaire. |
| 🧾 Fiche produit | Description, ingrédients, allergènes, nutrition, origine et livraison lorsqu’ils sont publiés. |
| 🛒 Panier | Lignes, quantités, prix, disponibilité et statut — jamais l’adresse ni le paiement. |
| ✅ Mutations sûres | Prévisualisation, confirmation unique de deux minutes, contrôle de conflit et relecture réelle. |

## Installation rapide — Codex, Claude Code et clients MCP

Prérequis : Node.js 22.12 ou supérieur, ainsi qu’un service Camofox local sur loopback. La même configuration `stdio` fonctionne dans Codex, Claude Code et les clients compatibles :

```json
{
  "mcpServers": {
    "greenweez": {
      "command": "npx",
      "args": [
        "-y",
        "--package=github:ncleton/greenweez-mcp#v0.2.1",
        "greenweez-mcp"
      ]
    }
  }
}
```

Le processus MCP hérite de `GREENWEEZ_CAMOFOX_API_KEY`, `GREENWEEZ_CAMOFOX_URL` et, si utilisé, `GREENWEEZ_SESSION_DIRECTORY` depuis le gestionnaire de secrets de votre système. Ne mettez jamais leurs valeurs dans Git ou dans une conversation.

## Premier démarrage : wizard de connexion

Le serveur fournit le prompt `onboard_greenweez` et l’outil `connect_greenweez`. Lorsqu’un client MCP l’appelle, il retourne immédiatement un wizard local avec deux liens directs :

- **J’ai un compte — me connecter** : ouvre Greenweez dans le navigateur local du connecteur et attend une session vérifiée.
- **Créer un compte Greenweez** : ouvre la page officielle d’inscription, puis permet de revenir à la connexion.

Les clients MCP ne possèdent pas de mécanisme universel pour ouvrir automatiquement une page au simple ajout d’un serveur. Codex et Claude Code reçoivent l’instruction d’appeler cet outil avant une action de compte ; si votre client ne l’affiche pas de lui-même, demandez simplement « Connecte Greenweez ». Le mot de passe et le 2FA restent exclusivement dans Greenweez.

## Prérequis

Greenweez bloque les clients HTTP directs : ce connecteur nécessite donc un service [Camofox Browser](https://www.npmjs.com/package/camofox-browser) local, exclusivement sur loopback, avec une clé API forte.

```sh
npx camofox-browser
export GREENWEEZ_CAMOFOX_URL=http://127.0.0.1:9377
export GREENWEEZ_CAMOFOX_API_KEY='votre-cle-aleatoire-d-au-moins-32-octets'
```

Ne mettez jamais cette clé dans la configuration MCP, dans Git ou dans une conversation. Gardez-la dans le gestionnaire de secrets de votre système.

## Session persistante et migration

Le mot de passe Greenweez n’est jamais stocké par le MCP. Pour la première connexion, lancez la commande ci-dessous puis saisissez vous-même les identifiants et l’éventuel 2FA dans la fenêtre Greenweez locale :

```sh
greenweez session login
```

La commande attend la preuve réelle de connexion et exporte ensuite automatiquement un bundle chiffré. Pour réexporter une session déjà connectée ou vérifier son état :

```sh
greenweez session export
greenweez session status
```

Deux fichiers privés sont créés dans le répertoire de données de l’utilisateur : un bundle AES-256-GCM et sa clé. Pour une autre machine, copiez ces deux fichiers par un canal sécurisé dans le même répertoire, ou pointez vers leur dossier avec `GREENWEEZ_SESSION_DIRECTORY`, puis exécutez :

```sh
greenweez session import
```

Le MCP importe ensuite automatiquement ce bundle à chaque nouveau démarrage. Les fichiers sont créés en permissions `0600` et ne doivent jamais être placés dans Git, un message ou un gestionnaire de configuration non chiffré. Une session est portable, mais pas permanente : Greenweez peut l’expirer ou la révoquer côté serveur. Dans ce cas, aucune conservation sûre du mot de passe ne permet de contourner la reconnexion ; le connecteur échoue explicitement et demande une nouvelle connexion locale.

Pour plusieurs comptes Greenweez sur une même machine, attribuez à chacun un `GREENWEEZ_CAMOFOX_USER_ID` stable et distinct. Les bundles, clés, confirmations et verrous sont alors nommés séparément. Utilisez aussi des `GREENWEEZ_SESSION_DIRECTORY` distincts si les comptes sont exploités par des utilisateurs système différents. Ne réutilisez jamais le bundle d’un compte pour un autre.

## Outils

- `connect_greenweez()` : vérifie la session ou retourne le wizard local et les liens officiels de connexion et de création de compte.
- `search_products(query, page?)` : recherche le catalogue public, 1 à 100.
- `get_product(reference, slug)` : lit une fiche produit publique.
- `get_cart()` : relit uniquement le résumé et les lignes du panier connecté.
- `preview_add_to_cart(reference, slug)` : vérifie la fiche, l’offre, le stock et l’état courant, sans modifier le panier.
- `confirm_add_to_cart(confirmationToken)` : ajoute exactement une unité si le panier n’a pas changé, puis vérifie le résultat réel.
- `preview_remove_from_cart(reference)` : prévisualise le retrait de toute la ligne correspondant à la référence.
- `confirm_remove_from_cart(confirmationToken)` : retire la ligne confirmée si le panier n’a pas changé, puis vérifie son absence.

Les confirmations sont aléatoires, à usage unique, valables deux minutes et conservées en `0600`. Les mutations sont sérialisées entre processus. Une confirmation périmée, réutilisée ou liée à un panier modifié est refusée avant l’appel GraphQL. Si la réponse réseau est perdue, le connecteur réconcilie le résultat par une nouvelle lecture du panier.

Le même client métier et le même gestionnaire de session sont disponibles en CLI :

```sh
npx -y --package=github:ncleton/greenweez-mcp#v0.2.1 greenweez search "pâte à tartiner" 1
npx -y --package=github:ncleton/greenweez-mcp#v0.2.1 greenweez cart get
```

Le CLI et le serveur MCP utilisent exactement le même client métier et le même registre privé de confirmations. Le connecteur ne propose ni passage de commande, ni validation de livraison, ni paiement.

Si la structure du site, Camofox ou l’accès est modifié, le connecteur échoue explicitement avec une marche à suivre. Il ne retourne jamais de données de substitution.

## Développement et publication

```sh
git clone https://github.com/ncleton/greenweez-mcp.git
cd greenweez-mcp
npm ci
npm run verify
```

La branche `main` est protégée par la CI : types, tests MCP, audit de confidentialité, vérification du contenu npm et contrôle que `dist/` est à jour. Une release se crée en poussant un tag `vX.Y.Z` cohérent avec `package.json` ; elle joint le paquet `.tgz` vérifié à GitHub. Consultez [CONTRIBUTING.md](CONTRIBUTING.md) pour le processus complet.

## Sécurité et support

Consultez [SECURITY.md](SECURITY.md) pour signaler une vulnérabilité en privé. Pour une question d’utilisation ou une amélioration, ouvrez une [discussion GitHub](https://github.com/ncleton/greenweez-mcp/discussions) ou une issue sans aucune donnée de compte.

Licence [MIT](LICENSE).
