import { createHash } from "node:crypto";
import { z } from "zod";
import { ConfirmationStore } from "./confirmation-store.js";
import { ConflictError, ConnectionError, ContractChangedError, MutationVerificationError } from "./errors.js";
const GREENWEEZ_HOME = new URL("https://www.greenweez.com/");
const idString = z.string().regex(/^[1-9]\d*$/);
const rawCartSchema = z.object({
    tokenValue: z.string().min(1),
    totalItems: z.number().int().nonnegative(),
    items: z.array(z.object({
        id: idString,
        quantity: z.number().int().positive(),
        offer: z.object({
            id: idString,
            quantityAvailable: z.number().int().nonnegative(),
            status: z.string().min(1),
            pricing: z.object({ price: z.number().nonnegative() }),
            variant: z.object({
                code: z.string().min(1),
                product: z.object({
                    slug: z.string().min(1),
                    name: z.string().min(1),
                    code: z.string().min(1),
                    legacyId: z.number().int(),
                    brand: z.object({ name: z.string().min(1) }).nullable(),
                }),
            }),
        }),
    })),
}).strict();
const cartEvaluationSchema = z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), status: z.literal(200), cart: rawCartSchema }).strict(),
    z.object({ ok: z.literal(false), reason: z.string().min(1), status: z.number().int().optional(), errorCount: z.number().int().nonnegative().optional() }).strict(),
]);
const mutationEvaluationSchema = z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), status: z.literal(200) }).strict(),
    z.object({ ok: z.literal(false), reason: z.string().min(1), status: z.number().int().optional(), errorCount: z.number().int().nonnegative().optional() }).strict(),
]);
const offerSchema = z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), reference: z.string().min(1), offerId: z.number().int().positive(), quantityAvailable: z.number().int().nonnegative(), inStock: z.boolean() }).strict(),
    z.object({ ok: z.literal(false), reason: z.string().min(1) }).strict(),
]);
const CART_DOCUMENT = "query Cart($cartToken: String!) { cart(cartToken: $cartToken) { tokenValue totalItems items { id quantity offer { id quantityAvailable status pricing { price } variant { code product { slug name code legacyId brand { name } } } } } } }";
const ADD_DOCUMENT = "mutation AddToCart($cartToken: String, $offerId: Int, $offers: [OfferWithQuantity]) { addOffersToCart(cartToken: $cartToken, offerId: $offerId, offers: $offers) { orderToken offerId } }";
const REMOVE_DOCUMENT = "mutation DeleteCartItems($cartToken: String!, $cartItemsId: [Int]!) { deleteCartItems(cartToken: $cartToken, cartItemsId: $cartItemsId) { orderToken } }";
function browserGraphqlPreamble() {
    return String.raw `
    const cookie = (name) => document.cookie.split(';').map(value => value.trim()).find(value => value.startsWith(name + '='))?.slice(name.length + 1) || null;
    const cartToken = cookie('cartToken');
    const algoliaToken = cookie('gwz-user-token');
    const sessionResponse = await fetch('/api/auth/session', { credentials: 'include' });
    const session = await sessionResponse.json().catch(() => null);
    const authorization = session?.user?.token;
    if (!sessionResponse.ok || !cartToken || !algoliaToken || !authorization) return { ok: false, reason: 'missing_or_expired_session' };
    const requestId = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18)))).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 21);
    const request = (operationName, query, variables) => new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', 'https://api.greenweez.com/graphql');
      xhr.responseType = 'json';
      xhr.setRequestHeader('source-platform', 'web');
      xhr.setRequestHeader('request-id', requestId);
      xhr.setRequestHeader('apollo-require-preflight', 'true');
      xhr.setRequestHeader('x-algolia-user-token', algoliaToken);
      xhr.setRequestHeader('authorization', 'Bearer ' + authorization);
      xhr.setRequestHeader('content-type', 'application/json');
      xhr.onload = () => resolve({ status: xhr.status, body: xhr.response });
      xhr.onerror = () => resolve({ status: 0, body: null });
      xhr.send(JSON.stringify({ operationName, query, variables }));
    });`;
}
function cartExpression() {
    return `(async () => {${browserGraphqlPreamble()}
    const response = await request('Cart', ${JSON.stringify(CART_DOCUMENT)}, { cartToken });
    if (response.status !== 200 || !response.body || Array.isArray(response.body.errors)) return { ok: false, reason: response.status ? 'graphql_error' : 'network_error', status: response.status, errorCount: Array.isArray(response.body?.errors) ? response.body.errors.length : 0 };
    return { ok: true, status: 200, cart: response.body.data?.cart };
  })()`;
}
function mutationExpression(kind, id, expectedCartTokenHash) {
    const operation = kind === "add" ? "AddToCart" : "DeleteCartItems";
    const document = kind === "add" ? ADD_DOCUMENT : REMOVE_DOCUMENT;
    const variables = kind === "add" ? `{ cartToken, offerId: ${id} }` : `{ cartToken, cartItemsId: [${id}] }`;
    return `(async () => {${browserGraphqlPreamble()}
    const bytes = new TextEncoder().encode(cartToken);
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
    if (digest !== ${JSON.stringify(expectedCartTokenHash)}) return { ok: false, reason: 'cart_token_changed' };
    const response = await request(${JSON.stringify(operation)}, ${JSON.stringify(document)}, ${variables});
    if (response.status !== 200 || !response.body || Array.isArray(response.body.errors)) return { ok: false, reason: response.status ? 'graphql_error' : 'network_error', status: response.status, errorCount: Array.isArray(response.body?.errors) ? response.body.errors.length : 0 };
    const result = ${kind === "add" ? "response.body.data?.addOffersToCart" : "response.body.data?.deleteCartItems"};
    if (!result || typeof result.orderToken !== 'string'${kind === "add" ? " || result.offerId == null" : ""}) return { ok: false, reason: 'response_contract', status: 200, errorCount: 0 };
    return { ok: true, status: 200 };
  })()`;
}
function offerExpression(reference) {
    return String.raw `(() => {
    const reference = ${JSON.stringify(reference)};
    const allButtons = [...document.querySelectorAll('main button')];
    // Quand le produit est déjà dans le panier, la boîte d'achat remplace le
    // bouton « Ajouter au panier » par un compteur dont les boutons portent
    // les aria-labels « increase »/« decrease » (relevé le 2026-08-06). Chaque
    // ancre candidate sert uniquement de point d'entrée vers les données
    // React : le filtre par référence ci-dessous garantit qu'une ancre d'un
    // autre produit ne peut pas résoudre la mauvaise offre.
    const anchors = [
      ...allButtons.filter(element => /^Ajouter au panier\b/i.test(String(element.innerText || element.textContent || '').trim())),
      ...allButtons.filter(element => String(element.getAttribute('aria-label') || '').trim().toLowerCase() === 'increase'),
    ];
    if (!anchors.length) return { ok: false, reason: 'add_control_missing' };
    const candidates = [];
    const seen = new WeakSet();
    let anchorInStock = false;
    const visit = (value, depth = 0) => {
      if (!value || typeof value !== 'object' || depth > 14 || seen.has(value)) return;
      seen.add(value);
      if (!Array.isArray(value) && value.code === reference && value.mainOffer && value.mainOffer.id != null) candidates.push({ offerId: Number(value.mainOffer.id), quantityAvailable: Number(value.mainOffer.quantityAvailable), inStock: value.inStock === true });
      if (!Array.isArray(value) && value.variantCode === reference && value.offerId != null) candidates.push({ offerId: Number(value.offerId), quantityAvailable: Number(value.quantityAvailable ?? 0), inStock: anchorInStock });
      if (Array.isArray(value)) value.forEach(child => visit(child, depth + 1)); else Object.values(value).forEach(child => visit(child, depth + 1));
    };
    let anchorDisabled = true;
    for (const anchor of anchors) {
      anchorInStock = !anchor.disabled;
      let element = anchor;
      for (let level = 0; element && level < 9; level += 1, element = element.parentElement) for (const key of Object.getOwnPropertyNames(element).filter(name => /^__(?:reactProps|reactFiber)\$/.test(name))) visit(element[key]);
      if (candidates.length) { anchorDisabled = anchor.disabled; break; }
    }
    const valid = candidates.filter(candidate => Number.isInteger(candidate.offerId) && candidate.offerId > 0 && Number.isInteger(candidate.quantityAvailable) && candidate.quantityAvailable >= 0);
    const ids = [...new Set(valid.map(candidate => candidate.offerId))];
    if (ids.length !== 1) return { ok: false, reason: ids.length ? 'ambiguous_offer' : 'offer_missing' };
    const matching = valid.find(candidate => candidate.offerId === ids[0]);
    return { ok: true, reference, offerId: ids[0], quantityAvailable: Math.max(...valid.filter(candidate => candidate.offerId === ids[0]).map(candidate => candidate.quantityAvailable)), inStock: !anchorDisabled && (matching?.inStock === true || matching?.quantityAvailable > 0) };
  })()`;
}
function stateVersion(cart) {
    const stable = { tokenValue: cart.tokenValue, totalItems: cart.totalItems, items: [...cart.items].map(item => ({ id: item.id, offerId: item.offer.id, reference: item.offer.variant.code, quantity: item.quantity })).sort((left, right) => left.id.localeCompare(right.id)) };
    return createHash("sha256").update(JSON.stringify(stable), "utf8").digest("hex");
}
function tokenHash(cart) {
    return createHash("sha256").update(cart.tokenValue, "utf8").digest("hex");
}
function publicCart(cart) {
    return {
        totalItems: cart.totalItems,
        items: cart.items.map(item => ({
            reference: item.offer.variant.code,
            slug: item.offer.variant.product.slug,
            name: item.offer.variant.product.name,
            brand: item.offer.variant.product.brand?.name ?? null,
            quantity: item.quantity,
            unitPriceEur: item.offer.pricing.price,
            quantityAvailable: item.offer.quantityAvailable,
            status: item.offer.status,
        })),
    };
}
function quantity(cart, reference) {
    return cart.items.filter(item => item.offer.variant.code === reference).reduce((sum, item) => sum + item.quantity, 0);
}
export class GreenweezCartClient {
    browser;
    confirmations;
    constructor(browser, confirmations = new ConfirmationStore()) {
        this.browser = browser;
        this.confirmations = confirmations;
    }
    async rawCart() {
        const parsed = cartEvaluationSchema.safeParse(await this.browser.read(GREENWEEZ_HOME, cartExpression()));
        if (!parsed.success)
            throw new ContractChangedError("La réponse minimale du panier Greenweez ne correspond plus au contrat observé.");
        if (!parsed.data.ok) {
            if (parsed.data.reason === "missing_or_expired_session")
                throw new ConnectionError("La session Greenweez est absente ou expirée.", "Importez un bundle de session valide ou reconnectez-vous localement, puis réessayez.");
            throw new ConnectionError("L’API panier Greenweez n’a pas répondu correctement.", "Vérifiez la connexion locale et l’état de Greenweez, puis relisez le panier.");
        }
        return parsed.data.cart;
    }
    async getCart() {
        return publicCart(await this.rawCart());
    }
    async previewAdd(product) {
        const rawOffer = offerSchema.safeParse(await this.browser.read(new URL(product.url), offerExpression(product.reference)));
        if (!rawOffer.success)
            throw new ContractChangedError("La fiche produit Greenweez ne fournit plus l’offre avec le contrat observé.");
        if (!rawOffer.data.ok)
            throw new ContractChangedError(`L’offre Greenweez ne peut pas être résolue (${rawOffer.data.reason}).`);
        const cart = await this.rawCart();
        const before = quantity(cart, product.reference);
        if (!rawOffer.data.inStock || rawOffer.data.quantityAvailable <= before)
            throw new ConflictError("Ce produit ne dispose pas d’une unité supplémentaire vérifiée.", "Relisez la fiche produit ou choisissez un autre article disponible.");
        const confirmation = this.confirmations.create({ kind: "add", stateVersion: stateVersion(cart), reference: product.reference, slug: product.slug, offerId: rawOffer.data.offerId, quantityBefore: before });
        return { action: "add_one", ...confirmation, product, quantityBefore: before, quantityAfter: before + 1 };
    }
    async previewRemove(reference) {
        const cart = await this.rawCart();
        const matches = cart.items.filter(item => item.offer.variant.code === reference);
        if (matches.length !== 1)
            throw new ConflictError(matches.length ? "Plusieurs lignes correspondent à cette référence." : "Cette référence n’est pas présente dans le panier.", "Relisez le panier et ciblez une référence présente sur une seule ligne.");
        const item = matches[0];
        const confirmation = this.confirmations.create({ kind: "remove", stateVersion: stateVersion(cart), reference, cartItemId: Number(item.id), quantityBefore: item.quantity });
        return { action: "remove_line", ...confirmation, item: publicCart({ ...cart, totalItems: item.quantity, items: [item] }).items[0], quantityBefore: item.quantity, quantityAfter: 0 };
    }
    async confirm(token, expectedKind) {
        return this.confirmations.withMutationLock(async () => {
            const pending = this.confirmations.take(token);
            if (pending.kind !== expectedKind)
                throw new ConflictError("Le jeton de confirmation ne correspond pas à cette action.", "Utilisez l’outil de confirmation indiqué par la prévisualisation, ou relancez celle-ci.");
            const before = await this.rawCart();
            if (stateVersion(before) !== pending.stateVersion)
                throw new ConflictError("Le panier Greenweez a changé depuis la prévisualisation.", "Relisez le panier et créez une nouvelle prévisualisation ; aucune mutation n’a été envoyée.");
            const expression = pending.kind === "add" ? mutationExpression("add", pending.offerId, tokenHash(before)) : mutationExpression("remove", pending.cartItemId, tokenHash(before));
            const rawMutation = await this.browser.mutate(GREENWEEZ_HOME, expression).catch(() => ({ ok: false, reason: "transport_error" }));
            const mutation = mutationEvaluationSchema.safeParse(rawMutation);
            const after = await this.rawCart();
            const verified = pending.kind === "add" ? quantity(after, pending.reference) === pending.quantityBefore + 1 : quantity(after, pending.reference) === 0;
            if (!verified) {
                if (mutation.success && !mutation.data.ok && mutation.data.reason === "cart_token_changed")
                    throw new ConflictError("Le jeton du panier a changé avant la mutation.", "Relisez le panier et créez une nouvelle prévisualisation ; aucune mutation n’a été appliquée.");
                throw new MutationVerificationError("La mutation Greenweez n’a pas pu être confirmée par la relecture du panier réel.");
            }
            return { applied: true, verified: true, responseReconciled: !(mutation.success && mutation.data.ok), action: pending.kind === "add" ? "add_one" : "remove_line", cart: publicCart(after) };
        });
    }
}
