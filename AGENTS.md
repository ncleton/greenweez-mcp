# MCP Creator instructions

## Mission

Créer des serveurs MCP et CLI réellement utilisables par Codex, Claude Code et tout client MCP compatible. Préférer le transport `stdio`; n'ajouter HTTP que lorsqu'il est nécessaire et le protéger selon le contexte.

## Registre des MCP gérés

Ce registre est le point d’entrée de cet agent pour les MCP de l’organisation. Mettre à jour cette section à la création, au transfert ou à l’archivage d’un MCP ; ne pas déduire son état à partir de clones locaux. Les dépôts GitHub sont les sources de vérité partagées.

### Serveurs MCP autonomes

| MCP | Dépôt / source | Statut de gestion |
| --- | --- | --- |
| Greenweez MCP | [GitHub](https://github.com/ncleton/greenweez-mcp) · [checkout local](./README.md) | Serveur et CLI Greenweez ; publication GitHub sur `main`, releases par tags versionnés. |
| Vegetal Food MCP | [checkout local](./vegetal-food-mcp/README.md) | Serveur et CLI pour le catalogue public Vegetal Food ; dépôt GitHub à créer avant publication. |
| Leclerc Drive MCP | [GitHub](https://github.com/ncleton/leclerc-drive-mcp) | Serveur et CLI web adossés à une session persistante isolée par utilisateur ; onboarding, catalogue, fiches et panier sécurisé ; publication GitHub sur `main`, release `v0.1.1`. |
| Carrefour Drive MCP | [GitHub](https://github.com/ncleton/carrefour-drive-mcp) · [checkout local géré](./carrefour-drive-mcp/README.md) | Serveur MCP et CLI web Carrefour Drive détenus dans ce workspace : profil Chrome dédié et isolé, onboarding, session, catalogue, fiches, panier et ajout confirmé avec réconciliation. Source de vérité partagée : GitHub `main`, tag publié `v0.2.0`. Aucun téléphone ni backend mobile. |
| OVS MCP | [GitHub](https://github.com/ncleton/ovs-mcp) · [checkout local](./ovs-mcp/README.md) | Serveur et CLI Official Vegan Shop ; clone de travail géré ici sur `main`. |
| Freepik MCP Alpic | [GitHub](https://github.com/ncleton/freepik-mcp-alpic) | Serveur MCP Python détenu par l’organisation. |
| Freepik MCP | [GitHub](https://github.com/ncleton/freepik-mcp) | Fork du serveur Freepik : maintenir séparément de l’amont et documenter toute divergence. |

### Serveurs MCP intégrés à des produits

| Produit | Dépôt / chemin du serveur | Statut de gestion |
| --- | --- | --- |
| CRM Petitmaker | [GitHub](https://github.com/ncleton/crmpetitmaker/tree/main/mcp-server) | Paquet interne `@petitmaker/mcp-server`. |
| CRM Maison / Marcelle | [GitHub](https://github.com/ncleton/crmmaison/tree/main/mcp-server) | Paquet interne `@marcelle/mcp-server`. |
| CRMClaw | [GitHub](https://github.com/ncleton/crmclaw/tree/main/mcp-server) | Paquet interne `@petitmaker/mcp-server`, maintenu avec le produit CRMClaw. |
| Yaka Bridge | [GitHub](https://github.com/ncleton/yaka-bridge) | Plateforme qui intègre des workflows MCP ; ce n’est pas un serveur MCP autonome à publier depuis ce workspace. |

Avant toute modification d’un de ces dépôts, ouvrir ses propres `AGENTS.md` et travailler dans son checkout dédié. Pour OVS, le checkout géré ici est `./ovs-mcp`.

## MCP publics et partageables

- Concevoir chaque MCP comme un logiciel public destiné à être publié sur GitHub, installé depuis un clone ou un paquet propre et utilisé par des milliers de personnes, organisations, comptes et machines indépendants.
- Ne jamais optimiser seulement pour le poste, le compte, le profil navigateur, les chemins ou les services du créateur. Toute dépendance d'exécution doit être portable, configurable, documentée et vérifiée sur une installation neuve.
- Isoler strictement les utilisateurs et les comptes : aucune session, clé, donnée privée, cache, confirmation de mutation ou état temporaire ne doit pouvoir être partagé implicitement entre deux installations, utilisateurs ou comptes.
- Fournir le format attendu d'un dépôt GitHub exploitable : licence, README d'installation et d'usage, politique de sécurité, configuration d'exemple sans secret, versions et prérequis explicites, scripts de validation, paquet minimal et règles de contribution communes à Codex et Claude Code.
- Prévoir les erreurs et les opérations à l'échelle d'un produit distribué : limites, pagination, concurrence, migrations de schéma et de session, compatibilité de versions, observabilité expurgée, reprise après incident et messages d'action correctifs.
- Ne considérer une capacité comme livrée que si un utilisateur tiers peut l'installer et l'exécuter sans accès au poste du créateur, sans donnée fictive, sans secret fourni dans le dépôt et sans connaissance implicite de l'environnement de développement.

## Contrat de production

- Partager le même client métier entre CLI et MCP.
- Décrire et valider chaque entrée, sortie, erreur, pagination et mutation. Ne jamais inventer une route, un champ ou une réponse de secours.
- Distinguer les lectures des mutations avec les annotations MCP appropriées.
- Prévisualiser les mutations à effet durable, demander une confirmation liée à l’état courant, sérialiser les écritures et réconcilier une réponse ambiguë avec l’état réel.
- Échouer explicitement quand la connexion, la version ou le schéma observé n’est plus reconnu. Ne jamais retourner de données fictives.
- Vérifier avec un vrai client MCP, des tests automatisés et, quand c’est possible, une preuve réelle sans modifier durablement les données du compte.

## Sessions et données privées

- Pour un connecteur non officiel, exiger une autorisation explicite pour le compte, l’appareil ou la session contrôlés par l’utilisateur.
- Ne jamais demander un mot de passe, code 2FA, cookie, jeton ou capture dans le chat ni dans un formulaire MCP. Préférer une page de connexion locale ou le mécanisme d’authentification officiel adapté.
- Conserver les sessions hors Git, avec permissions `0600` sur les systèmes Unix. Ne jamais afficher, journaliser, tester ou versionner une donnée de compte, une adresse, une commande, un cookie ou une capture brute.
- À partir d’une capture, ne versionner que le contrat expurgé : hôte, méthode, chemins, clés, types, règles de pagination, codes d’erreur et invariants. Jamais les valeurs sensibles.
- Les outils publics ne doivent renvoyer que les champs nécessaires à l’action utilisateur.

## Sources d’observation

- Choisir le canal le moins intrusif qui permet de prouver le contrat : API officielle, site web, Camoufox local, puis app mobile autorisée.
- Ne pas contourner l’authentification, les CAPTCHA, l’épinglage de certificat, les protections d’appareil ou les conditions d’accès. En cas de blocage, l’expliquer et proposer le canal autorisé suivant.
- Garder le moyen d’observation dans la documentation de maintenance privée. La documentation publique décrit l’usage du MCP, pas l’appareil ou l’outil ayant permis d’observer l’API.

## Portabilité et publication

- Ne dépendre d’aucun chemin, secret, binaire ou profil propre au poste du créateur. Déclarer les prérequis dans le dépôt.
- Garder `AGENTS.md` comme source de vérité et créer `CLAUDE.md` avec `@AGENTS.md`.
- Avant publication : lint, types, tests unitaires, test MCP avec SDK officiel, audit de confidentialité, vérification du paquet et installation depuis le dépôt public.
- Ne publier qu’après un commit poussé. Ne jamais réécrire une branche distante existante.
