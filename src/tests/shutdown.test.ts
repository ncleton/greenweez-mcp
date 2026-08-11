import assert from "node:assert/strict";
import test from "node:test";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Ces scénarios reproduisent la mort réelle du serveur pendant une validation
// AgentVegan : le processus est tué ou perd son stdin, et doit rendre son
// onglet Camoufox partagé avant de sortir, sinon la session sature.
const serverModulePath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "mcp", "server.js");
const FIXTURE_USER_ID = "shutdown-fixture";
const FIXTURE_API_KEY = "shutdown-fixture-api-key-0123456789";
const FIXTURE_TAB_ID = "tab-shutdown-1";

type JsonRecord = Record<string, unknown>;

interface RecordedCall {
  method: string;
  path: string;
  body: JsonRecord | null;
}

interface CamoufoxFixture {
  origin: string;
  calls: RecordedCall[];
  close(): Promise<void>;
}

function startCamoufoxFixture(): Promise<CamoufoxFixture> {
  const calls: RecordedCall[] = [];
  const server = createHttpServer((request, response) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => { raw += chunk; });
    request.on("end", () => {
      let body: JsonRecord | null = null;
      try { body = raw ? (JSON.parse(raw) as JsonRecord) : null; } catch { body = null; }
      const method = request.method ?? "";
      const path = request.url ?? "";
      calls.push({ method, path, body });
      const reply = (status: number, value: unknown): void => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(value));
      };
      if (method === "POST" && path === "/tabs") { reply(200, { tabId: FIXTURE_TAB_ID }); return; }
      if (method === "POST" && path.endsWith("/wait")) { reply(200, { ok: true }); return; }
      if (method === "POST" && path.endsWith("/evaluate-extended")) {
        reply(200, { ok: true, result: { query: "tofu bio", total: 1, products: [{ reference: "2WEEZ0443", name: "Tofu bio nature", brand: "Fixture", price: "2,99€", unitPrice: "7,48€ / Kg", url: "https://www.greenweez.com/produit/tofu-bio-nature/2WEEZ0443" }] } });
        return;
      }
      if (method === "DELETE") { reply(200, { ok: true }); return; }
      reply(404, { error: `appel de fixture inattendu : ${method} ${path}` });
    });
  });
  return new Promise((resolveFixture) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolveFixture({
        origin: `http://127.0.0.1:${address.port}`,
        calls,
        close: () => new Promise<void>((resolveClose) => {
          server.close(() => resolveClose());
          server.closeAllConnections();
        }),
      });
    });
  });
}

class JsonLineReader {
  private buffered = "";
  readonly messages: JsonRecord[] = [];

  constructor(stream: NodeJS.ReadableStream) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      this.buffered += chunk;
      let separator: number;
      while ((separator = this.buffered.indexOf("\n")) >= 0) {
        const line = this.buffered.slice(0, separator).trim();
        this.buffered = this.buffered.slice(separator + 1);
        if (line) this.messages.push(JSON.parse(line) as JsonRecord);
      }
    });
  }
}

async function waitFor<T>(probe: () => T | undefined, label: string, context: () => string, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = probe();
    if (found !== undefined) return found;
    if (Date.now() > deadline) throw new Error(`${label} non obtenu avant ${timeoutMs} ms. ${context()}`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
}

async function runShutdownScenario(trigger: (child: ChildProcess) => void): Promise<void> {
  const fixture = await startCamoufoxFixture();
  const child = spawn(process.execPath, [serverModulePath], {
    env: {
      PATH: process.env.PATH ?? "",
      GREENWEEZ_CAMOFOX_URL: fixture.origin,
      GREENWEEZ_CAMOFOX_API_KEY: FIXTURE_API_KEY,
      GREENWEEZ_CAMOFOX_USER_ID: FIXTURE_USER_ID,
      GREENWEEZ_SESSION_DIRECTORY: mkdtempSync(join(tmpdir(), "greenweez-mcp-shutdown-")),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  try {
    const { stdin, stdout, stderr } = child;
    if (!stdin || !stdout || !stderr) throw new Error("Le serveur de test n'expose pas ses flux stdio.");
    let stderrOutput = "";
    stderr.setEncoding("utf8");
    stderr.on("data", (chunk: string) => { stderrOutput += chunk; });
    const context = (): string => `stderr du serveur : ${stderrOutput.trim() || "(vide)"}`;
    const reader = new JsonLineReader(stdout);
    const send = (message: JsonRecord): void => { stdin.write(`${JSON.stringify(message)}\n`); };

    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "shutdown-test", version: "0.0.0" } } });
    await waitFor(() => reader.messages.find((message) => message.id === 1), "la réponse initialize", context);
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "search_products", arguments: { query: "tofu bio" } } });
    const searchResponse = await waitFor(() => reader.messages.find((message) => message.id === 2), "la réponse search_products", context);
    assert.equal((searchResponse.result as JsonRecord | undefined)?.isError, undefined, `search_products a échoué : ${JSON.stringify(searchResponse)}`);
    assert.ok(fixture.calls.some((call) => call.method === "POST" && call.path === "/tabs"), "l'onglet partagé n'a pas été ouvert par la recherche");
    const waits = fixture.calls.filter((call) => call.method === "POST" && call.path.endsWith("/wait"));
    assert.ok(waits.length > 0, "la recherche n'a pas attendu que le document Greenweez soit prêt");
    assert.ok(
      waits.every((call) => call.body?.waitForNetwork === false),
      "le connecteur ne doit pas attendre le réseau inactif : Greenweez garde des requêtes d'analytics ouvertes après le chargement du document",
    );

    const isSharedTabClose = (call: RecordedCall): boolean =>
      call.method === "DELETE" && call.path === `/tabs/${FIXTURE_TAB_ID}` && call.body?.userId === FIXTURE_USER_ID;
    assert.equal(fixture.calls.some(isSharedTabClose), false, "l'onglet partagé a été fermé avant le déclencheur d'arrêt");

    trigger(child);
    let exitOutcome: [number | null, NodeJS.Signals | null];
    try {
      exitOutcome = (await once(child, "exit", { signal: AbortSignal.timeout(10_000) })) as [number | null, NodeJS.Signals | null];
    } catch {
      throw new Error(`Le serveur ne s'est pas arrêté dans les 10 s après le déclencheur. ${context()}`);
    }
    const [code, signal] = exitOutcome;
    assert.equal(signal, null, `le serveur est mort sur le signal ${String(signal)} au lieu de sortir proprement`);
    assert.equal(code, 0, `le serveur est sorti avec le code ${String(code)}. ${context()}`);
    assert.ok(
      fixture.calls.some(isSharedTabClose),
      `l'onglet partagé n'a pas été rendu à l'arrêt. Appels reçus : ${fixture.calls.map((call) => `${call.method} ${call.path}`).join(", ")}`,
    );
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await fixture.close();
  }
}

test("SIGTERM rend l'onglet Camoufox partagé avant la sortie", async () => {
  await runShutdownScenario((child) => { child.kill("SIGTERM"); });
});

test("SIGINT rend l'onglet Camoufox partagé avant la sortie", async () => {
  await runShutdownScenario((child) => { child.kill("SIGINT"); });
});

test("la fin de stdin rend l'onglet Camoufox partagé avant la sortie", async () => {
  await runShutdownScenario((child) => { child.stdin?.end(); });
});
