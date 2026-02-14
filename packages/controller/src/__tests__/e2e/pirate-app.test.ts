import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createAccount, createRecord, type Account, type RecordRef } from "./helpers.js";
import { Controller } from "../../index.js";
import { Gateway } from "@avaast/gateway";
import type { Query } from "@avaast/shared";

const PDS_URL = "http://127.0.0.1:2583";
const JETSTREAM_URL = "ws://127.0.0.1:6008/subscribe";
const CONTROLLER_PORT = 3001;
const GATEWAY_PORT = 3000;

/**
 * Pirate query AST equivalent to:
 *
 *   SELECT avast._uri, avast.text, avast.createdAt, COUNT(aye._uri) AS ayeCount
 *   FROM chat.pirate.avast AS avast
 *   LEFT JOIN chat.pirate.aye AS aye ON aye.avast.uri = avast._uri
 *   GROUP BY avast._uri
 *   ORDER BY avast.createdAt DESC
 */
const PIRATE_QUERY: Query = {
  select: [
    {
      alias: "avast._uri",
      value: { type: "fieldRef", source: "avast", field: "_uri" },
    },
    {
      alias: "avast.text",
      value: { type: "fieldRef", source: "avast", field: "text" },
    },
    {
      alias: "avast.createdAt",
      value: { type: "fieldRef", source: "avast", field: "createdAt" },
    },
    {
      alias: "ayeCount",
      value: {
        type: "builtinCall",
        name: "count",
        args: [{ type: "fieldRef", source: "aye", field: "_uri" }],
      },
    },
  ],
  from: { alias: "avast", collection: "chat.pirate.avast" },
  joins: [
    {
      joinType: "left",
      source: { alias: "aye", collection: "chat.pirate.aye" },
      on: {
        type: "comparison",
        op: "eq",
        left: { type: "fieldRef", source: "aye", field: "avast.uri" },
        right: { type: "fieldRef", source: "avast", field: "_uri" },
      },
    },
  ],
  groupBy: [{ type: "fieldRef", source: "avast", field: "_uri" }],
  orderBy: [
    {
      value: { type: "fieldRef", source: "avast", field: "createdAt" },
      direction: "desc",
    },
  ],
};

async function waitFor(
  fn: () => boolean | Promise<boolean>,
  timeoutMs = 15_000,
  intervalMs = 250,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

async function pdsHealthy(): Promise<boolean> {
  try {
    const resp = await fetch(`${PDS_URL}/xrpc/_health`);
    return resp.ok;
  } catch {
    return false;
  }
}

describe("Pirate App E2E", () => {
  let controller: Controller;
  let gateway: Gateway;
  let account: Account;

  beforeAll(async () => {
    // Skip if PDS is not running
    if (!(await pdsHealthy())) {
      console.warn("PDS not running at " + PDS_URL + ", skipping E2E tests");
      return;
    }

    // 1. Create a test account on the local PDS
    const suffix = Math.random().toString(36).slice(2, 8);
    account = await createAccount(
      PDS_URL,
      `pirate-${suffix}.test`,
      "password123",
    );

    // 2. Start Controller (connects to Jetstream, watches for app.avaast.* records)
    controller = new Controller({
      pdsEndpoint: PDS_URL,
      watchDid: account.did,
      jetstreamUrl: JETSTREAM_URL,
      controllerPort: CONTROLLER_PORT,
      gatewayUrl: `http://localhost:${GATEWAY_PORT}`,
    });
    await controller.start();

    // 3. Start Gateway on port 3000, pointed at Controller on port 3001
    gateway = new Gateway({
      port: GATEWAY_PORT,
      controllerUrl: `http://localhost:${CONTROLLER_PORT}`,
    });
    await gateway.start();

    // Small delay to let Jetstream connection establish
    await new Promise((r) => setTimeout(r, 1000));

    // 4. Write AVaaSt records to PDS — Jetstream delivers events -> Controller

    // 4a. app.avaast.computed — the pirate query definition
    const computedRef = await createRecord(
      PDS_URL,
      account.accessJwt,
      account.did,
      "app.avaast.computed",
      {
        name: "chat.pirate.getAvasts",
        query: PIRATE_QUERY,
        outputSchema: [
          { name: "avast._uri", schema: { type: "string" } },
          { name: "avast.text", schema: { type: "string" } },
          { name: "avast.createdAt", schema: { type: "datetime" } },
          { name: "ayeCount", schema: { type: "integer" } },
        ],
        createdAt: new Date().toISOString(),
      },
    );

    // 4b. app.avaast.deploy — endpoint mapping
    const deployRef = await createRecord(
      PDS_URL,
      account.accessJwt,
      account.did,
      "app.avaast.deploy",
      {
        endpoints: [
          {
            name: "chat.pirate.getAvasts",
            kind: "computed",
            ref: { did: account.did, cid: computedRef.cid },
          },
        ],
        createdAt: new Date().toISOString(),
      },
    );

    // 4c. app.avaast.appView — traffic rules
    await createRecord(
      PDS_URL,
      account.accessJwt,
      account.did,
      "app.avaast.appView",
      {
        name: "pirate-app",
        trafficRules: [
          {
            deploy: { did: account.did, cid: deployRef.cid },
            weight: 10000,
          },
        ],
        status: "active",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    );

    // 5. Wait for deploy to reach ACTIVE state
    await waitFor(() => {
      const deploys = controller.getOrchestrator().getActiveDeploys();
      return deploys.length > 0;
    });

    // Give gateway time to register endpoints + traffic rules
    await new Promise((r) => setTimeout(r, 1000));

    // 6. Write pirate app data to PDS
    const now = Date.now();

    const avast1 = await createRecord(
      PDS_URL,
      account.accessJwt,
      account.did,
      "chat.pirate.avast",
      {
        text: "Avast! Land ho!",
        createdAt: new Date(now - 2000).toISOString(),
      },
    );

    const avast2 = await createRecord(
      PDS_URL,
      account.accessJwt,
      account.did,
      "chat.pirate.avast",
      {
        text: "Avast! Man the cannons!",
        createdAt: new Date(now - 1000).toISOString(),
      },
    );

    // avast3 is the newest
    await createRecord(
      PDS_URL,
      account.accessJwt,
      account.did,
      "chat.pirate.avast",
      {
        text: "Avast! Treasure ahead!",
        createdAt: new Date(now).toISOString(),
      },
    );

    // 3 ayes for avast1
    for (let i = 0; i < 3; i++) {
      await createRecord(
        PDS_URL,
        account.accessJwt,
        account.did,
        "chat.pirate.aye",
        {
          avast: { uri: avast1.uri, cid: avast1.cid },
          createdAt: new Date().toISOString(),
        },
      );
    }

    // 1 aye for avast2
    await createRecord(
      PDS_URL,
      account.accessJwt,
      account.did,
      "chat.pirate.aye",
      {
        avast: { uri: avast2.uri, cid: avast2.cid },
        createdAt: new Date().toISOString(),
      },
    );

    // avast3 gets 0 ayes
  });

  afterAll(async () => {
    await gateway?.stop();
    await controller?.stop();
  });

  it("returns 3 avasts ordered DESC by createdAt with correct aye counts", async () => {
    if (!account) return; // skip if PDS was not available

    const resp = await fetch(
      `http://localhost:${GATEWAY_PORT}/xrpc/chat.pirate.getAvasts`,
    );
    expect(resp.status).toBe(200);

    const data = (await resp.json()) as {
      results: Array<Record<string, unknown>>;
    };
    expect(data.results).toHaveLength(3);

    // Ordered DESC by createdAt:
    //   [0] = avast3 (newest) → 0 ayes
    //   [1] = avast2          → 1 aye
    //   [2] = avast1 (oldest) → 3 ayes
    expect(data.results[0]!.ayeCount).toBe(0);
    expect(data.results[1]!.ayeCount).toBe(1);
    expect(data.results[2]!.ayeCount).toBe(3);
  });

  it("returns 404 for non-existent endpoint", async () => {
    if (!account) return;

    const resp = await fetch(
      `http://localhost:${GATEWAY_PORT}/xrpc/chat.pirate.nonExistent`,
    );
    expect(resp.status).toBe(404);
  });

  it("avast with 0 ayes has ayeCount: 0", async () => {
    if (!account) return;

    const resp = await fetch(
      `http://localhost:${GATEWAY_PORT}/xrpc/chat.pirate.getAvasts`,
    );
    const data = (await resp.json()) as {
      results: Array<Record<string, unknown>>;
    };

    // avast3 (newest, first in DESC order) has 0 ayes
    const noAyes = data.results[0]!;
    expect(noAyes.ayeCount).toBe(0);
    expect(noAyes["avast.text"]).toBe("Avast! Treasure ahead!");
  });
});
