#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { CamoufoxGateway } from "../client/camoufox.js";
import { GreenweezClient } from "../client/greenweez.js";
import { GreenweezError } from "../client/errors.js";
import { ConfirmationStore } from "../client/confirmation-store.js";
import { GreenweezOnboarding } from "../client/onboarding.js";
function result(value) {
    return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: value };
}
function error(error) {
    const known = error instanceof GreenweezError ? error : new GreenweezError("Erreur interne du connecteur.", "internal_error", "Consultez les diagnostics locaux puis réessayez.");
    return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code: known.code, message: known.message, remediation: known.remediation } }, null, 2) }] };
}
function canOnboard(browser) {
    return "sessionStatus" in browser && typeof browser.sessionStatus === "function" && "loginAndExportSession" in browser && typeof browser.loginAndExportSession === "function" && "openAccountCreation" in browser && typeof browser.openAccountCreation === "function";
}
// La version annoncée au client MCP suit package.json au lieu d'une constante
// recopiée à la main, qui avait dérivé de sept versions.
const { version: packageVersion } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
// Libère les ressources navigateur d'une instance du serveur : le wizard
// local éventuel et l'onglet Camoufox partagé des lectures publiques. Chaque
// fermeture est idempotente et tolère un service déjà arrêté.
export async function closeBrowserSessions(browser, onboarding) {
    if (onboarding)
        await onboarding.close().catch(() => undefined);
    const shared = browser;
    if (typeof shared.closeSharedTab === "function")
        await shared.closeSharedTab().catch(() => undefined);
}
export function createServer(browser = new CamoufoxGateway(), confirmations = new ConfirmationStore(), onboarding = canOnboard(browser) ? new GreenweezOnboarding(browser) : undefined) {
    const client = new GreenweezClient(browser, confirmations);
    const server = new McpServer({ name: "greenweez-mcp", version: packageVersion }, {
        instructions: "Pour toute action nécessitant un compte Greenweez, appelez d’abord connect_greenweez. Cet outil retourne un wizard local avec deux liens directs : connexion à un compte existant et création officielle de compte. Ne demandez jamais de mot de passe, code 2FA, cookie ou jeton dans la conversation.",
    });
    server.registerPrompt("onboard_greenweez", {
        title: "Connecter ou créer un compte Greenweez",
        description: "Démarre le wizard local Greenweez avant toute action de panier ou de compte.",
    }, async () => ({
        messages: [{ role: "user", content: { type: "text", text: "Utilise l’outil connect_greenweez et présente directement les deux liens du wizard : connexion à un compte existant ou création officielle de compte. Ne demande aucun identifiant dans cette conversation." } }],
    }));
    server.registerTool("connect_greenweez", {
        title: "Connecter ou créer un compte Greenweez",
        description: "Retourne un wizard local avec deux liens directs : connexion à un compte existant ou création officielle de compte. Les identifiants restent sur Greenweez.",
        inputSchema: {},
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    }, async () => {
        try {
            if (!onboarding)
                throw new GreenweezError("Le navigateur Greenweez ne prend pas en charge le wizard local.", "configuration_error", "Démarrez le serveur avec le connecteur Camofox Greenweez standard, puis relancez connect_greenweez.");
            return result(await onboarding.begin());
        }
        catch (cause) {
            return error(cause);
        }
    });
    server.server.onclose = () => {
        void closeBrowserSessions(browser, onboarding);
    };
    server.registerTool("search_products", {
        title: "Rechercher des produits Greenweez",
        description: "Recherche publique dans le catalogue Greenweez et retourne une page de produits avec les prix observés.",
        inputSchema: { query: z.string().trim().min(2).max(160), page: z.number().int().min(1).max(100).default(1) },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    }, async ({ query, page }) => {
        try {
            return result(await client.search(query, page));
        }
        catch (cause) {
            return error(cause);
        }
    });
    server.registerTool("get_product", {
        title: "Lire une fiche produit Greenweez",
        description: "Lit une fiche produit publique par sa référence et son slug, y compris les informations alimentaires publiées.",
        inputSchema: { reference: z.string().trim().regex(/^[A-Za-z0-9]+$/).max(64), slug: z.string().trim().regex(/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/).max(240) },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    }, async ({ reference, slug }) => {
        try {
            return result(await client.product(reference, slug));
        }
        catch (cause) {
            return error(cause);
        }
    });
    server.registerTool("get_cart", {
        title: "Lire le panier Greenweez",
        description: "Relit le panier réel du compte connecté sans demander les adresses, paiements ni données de profil.",
        inputSchema: {},
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    }, async () => {
        try {
            return result(await client.cart());
        }
        catch (cause) {
            return error(cause);
        }
    });
    server.registerTool("preview_add_to_cart", {
        title: "Prévisualiser un ajout au panier",
        description: "Relit la fiche, l’offre, le stock et le panier, puis crée une confirmation à usage unique valable deux minutes. Ne modifie pas le panier.",
        inputSchema: { reference: z.string().trim().regex(/^[A-Za-z0-9]+$/).max(64), slug: z.string().trim().regex(/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/).max(240) },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false },
    }, async ({ reference, slug }) => {
        try {
            return result(await client.previewAddToCart(reference, slug));
        }
        catch (cause) {
            return error(cause);
        }
    });
    server.registerTool("confirm_add_to_cart", {
        title: "Confirmer un ajout au panier",
        description: "Consomme une confirmation d’ajout, refuse tout panier modifié entre-temps, ajoute exactement une unité, puis vérifie le panier réel.",
        inputSchema: { confirmationToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/) },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false },
    }, async ({ confirmationToken }) => {
        try {
            return result(await client.confirmAddToCart(confirmationToken));
        }
        catch (cause) {
            return error(cause);
        }
    });
    server.registerTool("preview_remove_from_cart", {
        title: "Prévisualiser le retrait d’une ligne du panier",
        description: "Relit le panier et crée une confirmation à usage unique pour retirer toute la ligne ciblée. Ne modifie pas le panier.",
        inputSchema: { reference: z.string().trim().regex(/^[A-Za-z0-9]+$/).max(64) },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false },
    }, async ({ reference }) => {
        try {
            return result(await client.previewRemoveFromCart(reference));
        }
        catch (cause) {
            return error(cause);
        }
    });
    server.registerTool("confirm_remove_from_cart", {
        title: "Confirmer le retrait d’une ligne du panier",
        description: "Consomme une confirmation de retrait, refuse tout panier modifié entre-temps, retire la ligne ciblée, puis vérifie le panier réel.",
        inputSchema: { confirmationToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/) },
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true, idempotentHint: false },
    }, async ({ confirmationToken }) => {
        try {
            return result(await client.confirmRemoveFromCart(confirmationToken));
        }
        catch (cause) {
            return error(cause);
        }
    });
    return server;
}
// Le transport stdio du SDK n'écoute que « data » et « error » sur stdin : la
// fin de flux laissée par un client parent disparu ne déclenche jamais
// onclose, et le serveur mourait sans libérer son onglet Camoufox partagé. La
// session saturait alors à son plafond (« Maximum tabs per session reached »)
// et chaque instance suivante payait une ouverture échouée puis une adoption.
// On libère donc les sessions navigateur sur SIGTERM, SIGINT et la fin de
// stdin, avec une sortie forcée si Camoufox ne répond plus à temps.
const SHUTDOWN_FORCE_EXIT_MS = 5_000;
function installShutdownHandlers(browser, onboarding) {
    let shuttingDown = false;
    const shutdown = () => {
        if (shuttingDown)
            return;
        shuttingDown = true;
        setTimeout(() => process.exit(0), SHUTDOWN_FORCE_EXIT_MS).unref();
        void closeBrowserSessions(browser, onboarding).finally(() => process.exit(0));
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
    process.stdin.once("end", shutdown);
    process.stdin.once("close", shutdown);
}
async function main() {
    const browser = new CamoufoxGateway();
    const onboarding = new GreenweezOnboarding(browser);
    installShutdownHandlers(browser, onboarding);
    const server = createServer(browser, undefined, onboarding);
    await server.connect(new StdioServerTransport());
}
function isMainModule() {
    if (!process.argv[1])
        return false;
    try {
        return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
    }
    catch {
        return false;
    }
}
if (isMainModule()) {
    main().catch((cause) => {
        const message = cause instanceof Error ? cause.message : String(cause);
        process.stderr.write(`greenweez-mcp: ${message}\n`);
        process.exitCode = 1;
    });
}
