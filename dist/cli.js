#!/usr/bin/env node
import { CamoufoxGateway } from "./client/camoufox.js";
import { GreenweezClient } from "./client/greenweez.js";
import { GreenweezError } from "./client/errors.js";
function usage() {
    process.stderr.write("Usage: greenweez search <query> [page] | product <reference> <slug> | cart get | cart add-preview <reference> <slug> | cart add-confirm <token> | cart remove-preview <reference> | cart remove-confirm <token> | session login|export|import|status\n");
    process.exit(2);
}
async function main() {
    const [command, ...arguments_] = process.argv.slice(2);
    const gateway = new CamoufoxGateway();
    const client = new GreenweezClient(gateway);
    let payload;
    try {
        if (command === "search") {
            const [query, rawPage] = arguments_;
            if (!query || arguments_.length > 2)
                usage();
            const page = rawPage === undefined ? 1 : Number(rawPage);
            if (!Number.isInteger(page) || page < 1 || page > 100)
                usage();
            payload = await client.search(query, page);
        }
        else if (command === "product") {
            const [reference, slug] = arguments_;
            if (!reference || !slug || arguments_.length !== 2)
                usage();
            payload = await client.product(reference, slug);
        }
        else if (command === "session") {
            const [operation] = arguments_;
            if (arguments_.length !== 1)
                usage();
            if (operation === "login") {
                process.stderr.write("Terminez la connexion dans la fenêtre Greenweez locale. Le mot de passe et le 2FA ne passent jamais par le CLI.\n");
                payload = await gateway.loginAndExportSession();
            }
            else if (operation === "export")
                payload = await gateway.exportSession();
            else if (operation === "import")
                payload = await gateway.importSession();
            else if (operation === "status")
                payload = await gateway.sessionStatus();
            else
                usage();
        }
        else if (command === "cart") {
            const [operation, first, second] = arguments_;
            if (operation === "get" && arguments_.length === 1)
                payload = await client.cart();
            else if (operation === "add-preview" && first && second && arguments_.length === 3)
                payload = await client.previewAddToCart(first, second);
            else if (operation === "add-confirm" && first && arguments_.length === 2)
                payload = await client.confirmAddToCart(first);
            else if (operation === "remove-preview" && first && arguments_.length === 2)
                payload = await client.previewRemoveFromCart(first);
            else if (operation === "remove-confirm" && first && arguments_.length === 2)
                payload = await client.confirmRemoveFromCart(first);
            else
                usage();
        }
        else
            usage();
    }
    finally {
        // Le CLI vit le temps d'une seule commande : sans fermeture explicite,
        // chaque lecture publique abandonnait son onglet partagé dans la session
        // Camoufox jusqu'au plafond d'onglets.
        await gateway.closeSharedTab();
    }
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}
main().catch((cause) => {
    if (cause instanceof GreenweezError) {
        process.stderr.write(`${JSON.stringify({ error: { code: cause.code, message: cause.message, remediation: cause.remediation } })}\n`);
    }
    else
        process.stderr.write(`greenweez-mcp: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    process.exitCode = 1;
});
