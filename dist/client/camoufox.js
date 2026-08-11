import { ConfigurationError, ConnectionError, ContractChangedError } from "./errors.js";
import { readEncryptedSessionBundle, sessionBundleExists, writeEncryptedSessionBundle } from "./session-bundle.js";
function asRecord(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new ContractChangedError("Le navigateur local a renvoyé une réponse non reconnue.");
    }
    return value;
}
function requireLocalOrigin(value) {
    let url;
    try {
        url = new URL(value);
    }
    catch {
        throw new ConfigurationError("GREENWEEZ_CAMOFOX_URL doit être une URL HTTP locale valide.", "Démarrez Camofox sur loopback puis définissez GREENWEEZ_CAMOFOX_URL.");
    }
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
        throw new ConfigurationError("GREENWEEZ_CAMOFOX_URL doit désigner uniquement une origine HTTP loopback.", "Utilisez par exemple http://127.0.0.1:9377.");
    }
    return url;
}
export class CamoufoxGateway {
    origin;
    apiKey;
    userId;
    environment;
    sessionImportAttempted = false;
    sharedTabId;
    constructor(environment = process.env) {
        this.environment = environment;
        this.origin = requireLocalOrigin(environment.GREENWEEZ_CAMOFOX_URL ?? "http://127.0.0.1:9377");
        this.apiKey = String(environment.GREENWEEZ_CAMOFOX_API_KEY ?? "").trim();
        if (Buffer.byteLength(this.apiKey, "utf8") < 32) {
            throw new ConfigurationError("GREENWEEZ_CAMOFOX_API_KEY est absent ou trop court.", "Configurez une clé aléatoire d’au moins 32 octets sur le service Camofox local et dans l’environnement du MCP.");
        }
        this.userId = String(environment.GREENWEEZ_CAMOFOX_USER_ID ?? "greenweez-mcp").trim();
        if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(this.userId)) {
            throw new ConfigurationError("GREENWEEZ_CAMOFOX_USER_ID est invalide.", "Utilisez un identifiant local stable composé de lettres, chiffres, points, tirets ou underscores.");
        }
    }
    async requestValue(path, init = {}) {
        const controller = new AbortController();
        // Un premier lancement de navigateur ou une page produit lente dépasse
        // facilement 45 s : ce délai doit couvrir le pire démarrage à froid tout en
        // restant sous les budgets des appelants (150 s côté adaptateur AgentVegan).
        const timeout = setTimeout(() => controller.abort(), 120_000);
        timeout.unref();
        try {
            const response = await fetch(new URL(path, this.origin), {
                ...init,
                headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json", ...init.headers },
                signal: controller.signal,
            });
            const body = await response.json().catch(() => null);
            if (!response.ok) {
                const reason = typeof body === "object" && body !== null && "error" in body ? String(body.error) : `HTTP ${response.status}`;
                throw new ConnectionError(`Le navigateur local a refusé l’opération (${reason}).`, "Vérifiez que Camofox est actif sur loopback, que sa clé correspond à GREENWEEZ_CAMOFOX_API_KEY et que sa version est compatible.");
            }
            return body;
        }
        catch (error) {
            if (error instanceof ConnectionError || error instanceof ContractChangedError)
                throw error;
            throw new ConnectionError("Le navigateur local Camofox est indisponible.", "Démarrez Camofox localement et vérifiez GREENWEEZ_CAMOFOX_URL et GREENWEEZ_CAMOFOX_API_KEY.");
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async request(path, init = {}) {
        return asRecord(await this.requestValue(path, init));
    }
    async waitForDocument(tabId) {
        // Greenweez maintient des requêtes d'analytics ouvertes après que le DOM
        // est prêt. Attendre l'inactivité réseau bloque alors lecture du panier et
        // recherche sans apporter de garantie supplémentaire : chaque appelant
        // vérifie ensuite le contrat précis de la page avec evaluate().
        await this.request(`/tabs/${encodeURIComponent(tabId)}/wait`, {
            method: "POST",
            body: JSON.stringify({ userId: this.userId, timeout: 30_000, waitForNetwork: false }),
        });
    }
    async open(url) {
        if (url.origin !== "https://www.greenweez.com")
            throw new ConfigurationError("Le connecteur a refusé une origine non Greenweez.", "Utilisez uniquement les outils Greenweez fournis par ce MCP.");
        let tabId;
        try {
            const opened = await this.request("/tabs", { method: "POST", body: JSON.stringify({ url: url.toString(), userId: this.userId, sessionKey: "greenweez" }) });
            tabId = typeof opened.tabId === "string" ? opened.tabId : undefined;
            if (!tabId)
                throw new ContractChangedError("Camofox n’a pas retourné l’identifiant d’onglet attendu.");
        }
        catch (error) {
            if (error instanceof ContractChangedError)
                throw error;
            // Un serveur planté ne ferme jamais ses onglets : la session atteint son
            // plafond (« Maximum tabs per session reached ») et plus aucune instance
            // ne peut travailler. Plutôt que d'échouer, on adopte un onglet existant
            // du même utilisateur et on le navigue vers la cible.
            if (!/maximum tabs/i.test(error instanceof Error ? error.message : String(error)))
                throw error;
            const listed = await this.request(`/tabs?userId=${encodeURIComponent(this.userId)}`);
            const tabs = Array.isArray(listed.tabs) ? listed.tabs : [];
            const adopted = tabs.map(tab => (typeof tab.tabId === "string" ? tab.tabId : undefined)).find(Boolean);
            if (!adopted)
                throw error;
            await this.request(`/tabs/${encodeURIComponent(adopted)}/navigate`, { method: "POST", body: JSON.stringify({ userId: this.userId, url: url.toString() }) });
            tabId = adopted;
        }
        await this.waitForDocument(tabId);
        return tabId;
    }
    async close(tabId) {
        await this.request(`/tabs/${encodeURIComponent(tabId)}`, { method: "DELETE", body: JSON.stringify({ userId: this.userId }) }).catch(() => undefined);
    }
    async evaluate(tabId, expression) {
        const result = await this.request(`/tabs/${encodeURIComponent(tabId)}/evaluate-extended`, { method: "POST", body: JSON.stringify({ userId: this.userId, expression, timeout: 30_000 }) });
        if (result.ok !== true || !("result" in result))
            throw new ContractChangedError("Le navigateur n’a pas pu extraire la page Greenweez avec le contrat attendu.");
        return result.result;
    }
    async importPortableSessionIfPresent() {
        if (this.sessionImportAttempted)
            return;
        this.sessionImportAttempted = true;
        if (!sessionBundleExists(this.environment))
            return;
        await this.importSession();
    }
    async exportSession() {
        const tabId = await this.open(new URL("https://www.greenweez.com/mon-compte"));
        try {
            const connected = await this.evaluate(tabId, `(() => { const text=String(document.body.innerText||''); return location.pathname.startsWith('/mon-compte') && !/me connecter|connexion à votre compte/i.test(text); })()`);
            if (connected !== true)
                throw new ConnectionError("La session Greenweez n’est pas connectée.", "Connectez-vous dans la page locale Greenweez, puis relancez l’export.");
            const cookies = await this.requestValue(`/tabs/${encodeURIComponent(tabId)}/cookies?userId=${encodeURIComponent(this.userId)}`);
            writeEncryptedSessionBundle(cookies, this.environment);
            return { exported: true };
        }
        finally {
            await this.close(tabId);
        }
    }
    async loginAndExportSession(timeoutMs = 10 * 60_000) {
        if (!Number.isInteger(timeoutMs) || timeoutMs < 30_000 || timeoutMs > 30 * 60_000)
            throw new ConfigurationError("Le délai de connexion locale est invalide.", "Utilisez un délai compris entre 30 secondes et 30 minutes.");
        const tabId = await this.open(new URL("https://www.greenweez.com/mon-compte"));
        const deadline = Date.now() + timeoutMs;
        try {
            while (Date.now() < deadline) {
                const connected = await this.evaluate(tabId, `(() => { const text=String(document.body.innerText||''); return location.pathname.startsWith('/mon-compte') && !/me connecter|connexion à votre compte/i.test(text); })()`);
                if (connected === true) {
                    const cookies = await this.requestValue(`/tabs/${encodeURIComponent(tabId)}/cookies?userId=${encodeURIComponent(this.userId)}`);
                    writeEncryptedSessionBundle(cookies, this.environment);
                    return { connected: true, exported: true };
                }
                await new Promise((resolve) => setTimeout(resolve, 2_000));
            }
            throw new ConnectionError("La connexion Greenweez locale n’a pas été terminée dans le délai imparti.", "Relancez `greenweez session login` puis terminez la connexion dans la fenêtre locale, sans transmettre vos identifiants au MCP.");
        }
        finally {
            await this.close(tabId);
        }
    }
    async openAccountCreation() {
        await this.importPortableSessionIfPresent();
        await this.open(new URL("https://www.greenweez.com/inscription"));
        return { opened: true };
    }
    async importSession() {
        const cookies = readEncryptedSessionBundle(this.environment);
        const tabId = await this.open(new URL("https://www.greenweez.com/"));
        try {
            await this.request(`/sessions/${encodeURIComponent(this.userId)}/cookies`, { method: "POST", body: JSON.stringify({ cookies, tabId }) });
            await this.request(`/tabs/${encodeURIComponent(tabId)}/navigate`, { method: "POST", body: JSON.stringify({ userId: this.userId, url: "https://www.greenweez.com/mon-compte" }) });
            await this.waitForDocument(tabId);
            const connected = await this.evaluate(tabId, `(() => { const text=String(document.body.innerText||''); return location.pathname.startsWith('/mon-compte') && !/me connecter|connexion à votre compte/i.test(text); })()`);
            if (connected !== true)
                throw new ConnectionError("La session Greenweez importée a expiré ou a été révoquée.", "Reconnectez-vous localement une fois, puis créez un nouveau bundle chiffré.");
            return { imported: true, connected: true };
        }
        finally {
            await this.close(tabId);
        }
    }
    async sessionStatus() {
        await this.importPortableSessionIfPresent();
        const tabId = await this.open(new URL("https://www.greenweez.com/mon-compte"));
        try {
            const connected = await this.evaluate(tabId, `(() => { const text=String(document.body.innerText||''); return location.pathname.startsWith('/mon-compte') && !/me connecter|connexion à votre compte/i.test(text); })()`);
            return { connected: connected === true, portableBundle: sessionBundleExists(this.environment) };
        }
        finally {
            await this.close(tabId);
        }
    }
    // Les lectures publiques réutilisent un seul onglet navigué de page en
    // page : ouvrir puis fermer un onglet à chaque recherche faisait clignoter
    // une fenêtre par opération et multipliait les chargements à froid.
    async navigateSharedTab(url) {
        if (this.sharedTabId) {
            const tabId = this.sharedTabId;
            try {
                await this.request(`/tabs/${encodeURIComponent(tabId)}/navigate`, { method: "POST", body: JSON.stringify({ userId: this.userId, url: url.toString() }) });
                await this.waitForDocument(tabId);
                return tabId;
            }
            catch {
                // L'onglet partagé a pu être fermé hors du connecteur : on le recrée
                // une fois au lieu d'échouer définitivement. L'ancien onglet est
                // toujours libéré côté service, sinon la session atteint son plafond
                // d'onglets (« Maximum tabs per session reached »).
                this.sharedTabId = undefined;
                await this.close(tabId);
            }
        }
        this.sharedTabId = await this.open(url);
        return this.sharedTabId;
    }
    async closeSharedTab() {
        if (!this.sharedTabId)
            return;
        const tabId = this.sharedTabId;
        this.sharedTabId = undefined;
        await this.close(tabId);
    }
    async read(url, expression) {
        if (url.origin !== "https://www.greenweez.com") {
            throw new ConfigurationError("Le connecteur a refusé une origine non Greenweez.", "Utilisez uniquement les outils publics Greenweez fournis par ce MCP.");
        }
        await this.importPortableSessionIfPresent();
        const tabId = await this.navigateSharedTab(url);
        try {
            return await this.evaluate(tabId, expression);
        }
        catch (error) {
            // La fenêtre partagée peut être fermée à la main entre la navigation et
            // l'extraction : on recrée l'onglet et on rejoue une fois au lieu de
            // faire échouer toute la liste de courses.
            if (!/has been closed|Tab not found/i.test(error instanceof Error ? error.message : String(error)))
                throw error;
            this.sharedTabId = undefined;
            await this.close(tabId);
            const retryTabId = await this.navigateSharedTab(url);
            return await this.evaluate(retryTabId, expression);
        }
    }
    async mutate(url, expression) {
        return this.read(url, expression);
    }
}
