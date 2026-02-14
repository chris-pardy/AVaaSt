// This module generates the harness script that Deno executes.
// The harness receives function code and dependency config via stdin,
// loads the function, injects dependency handles, and returns the result.

export function generateHarness(controllerBaseUrl: string): string {
  return `
// AVaaSt Function Harness - runs inside Deno subprocess
// Receives: { code: string, input: Record<string, unknown>, dependencies: DependencyConfig[], callerDid?: string, authToken?: string }
// Returns: { output: Record<string, unknown> } or { error: { code: string, message: string } }

const decoder = new TextDecoder();
const encoder = new TextEncoder();

async function readStdin() {
  const chunks = [];
  const reader = Deno.stdin.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(decoder.decode(result));
}

function createComputedHandle(ref) {
  return {
    async query(params = {}) {
      const res = await fetch("${controllerBaseUrl}/internal/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref, params }),
      });
      if (!res.ok) throw new Error("Query failed: " + res.status);
      const data = await res.json();
      return data.results;
    },
  };
}

function createFunctionHandle(ref) {
  return {
    async call(input = {}) {
      const res = await fetch("${controllerBaseUrl}/internal/function", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref, input }),
      });
      if (!res.ok) throw new Error("Function call failed: " + res.status);
      const data = await res.json();
      return data.output;
    },
  };
}

function createSearchHandle(ref) {
  return {
    async search(params = {}) {
      const res = await fetch("${controllerBaseUrl}/internal/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref, params }),
      });
      if (!res.ok) throw new Error("Search failed: " + res.status);
      const data = await res.json();
      return data.results;
    },
  };
}

function createSubscriptionHandle(ref) {
  return {
    async publish(event = {}) {
      const res = await fetch("${controllerBaseUrl}/internal/subscription/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref, event }),
      });
      if (!res.ok) throw new Error("Publish failed: " + res.status);
    },
  };
}

function createCollectionHandle(collection, writeMode, callerDid, authToken) {
  const handle = {
    async list(params = {}) {
      const did = params.did || callerDid;
      const qs = new URLSearchParams({ collection, did: did || "", limit: String(params.limit || 100) });
      const res = await fetch("${controllerBaseUrl}/internal/collection?" + qs.toString());
      if (!res.ok) throw new Error("List failed: " + res.status);
      const data = await res.json();
      return data.records;
    },
    async get(rkey) {
      const qs = new URLSearchParams({ collection, rkey, did: callerDid || "" });
      const res = await fetch("${controllerBaseUrl}/internal/collection/record?" + qs.toString());
      if (!res.ok) throw new Error("Get failed: " + res.status);
      return (await res.json()).value;
    },
  };

  if (writeMode) {
    handle.put = async (rkey, record) => {
      const res = await fetch("${controllerBaseUrl}/internal/collection/record", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + (authToken || "") },
        body: JSON.stringify({ collection, rkey, record, did: callerDid }),
      });
      if (!res.ok) throw new Error("Put failed: " + res.status);
    };
    handle.delete = async (rkey) => {
      const res = await fetch("${controllerBaseUrl}/internal/collection/record", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + (authToken || "") },
        body: JSON.stringify({ collection, rkey, did: callerDid }),
      });
      if (!res.ok) throw new Error("Delete failed: " + res.status);
    };
  }

  return handle;
}

function buildDeps(dependencies, callerDid, authToken, writeMode) {
  const deps = {};
  for (const dep of dependencies) {
    switch (dep.kind) {
      case "computed": deps[dep.name] = createComputedHandle(dep.ref); break;
      case "function": deps[dep.name] = createFunctionHandle(dep.ref); break;
      case "searchIndex": deps[dep.name] = createSearchHandle(dep.ref); break;
      case "subscription": deps[dep.name] = createSubscriptionHandle(dep.ref); break;
      case "collection": deps[dep.name] = createCollectionHandle(dep.collection, writeMode, callerDid, authToken); break;
    }
  }
  return deps;
}

async function main() {
  const request = await readStdin();
  const { code, input, dependencies, callerDid, authToken, writeMode } = request;

  try {
    // Write code to a temp file and import it
    const tempFile = await Deno.makeTempFile({ suffix: ".ts" });
    await Deno.writeTextFile(tempFile, code);

    const mod = await import("file://" + tempFile);
    const fn = mod.default || mod.handler || mod.main;
    if (typeof fn !== "function") {
      throw new Error("Function module must export a default function, or a 'handler' or 'main' function");
    }

    const deps = buildDeps(dependencies || [], callerDid, authToken, writeMode);
    const output = await fn(input, deps);

    await Deno.writeAll(Deno.stdout, encoder.encode(JSON.stringify({ output: output || {} })));
    await Deno.remove(tempFile);
  } catch (err) {
    await Deno.writeAll(Deno.stdout, encoder.encode(JSON.stringify({
      error: { code: "EXECUTION_ERROR", message: err.message || String(err) },
    })));
  }
}

main();
`;
}
