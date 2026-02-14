/**
 * PDS client helper for E2E tests.
 * Wraps @atproto/api to talk to the local PDS.
 */

export interface Account {
  did: string;
  accessJwt: string;
}

export interface RecordRef {
  uri: string;
  cid: string;
}

/**
 * Create a new account on the local PDS.
 */
export async function createAccount(
  pdsUrl: string,
  handle: string,
  password: string,
): Promise<Account> {
  const resp = await fetch(
    `${pdsUrl}/xrpc/com.atproto.server.createAccount`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        handle,
        password,
        email: `${handle.split(".")[0]}@test.invalid`,
      }),
    },
  );

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`createAccount failed (${resp.status}): ${body}`);
  }

  const data = (await resp.json()) as {
    did: string;
    accessJwt: string;
    handle: string;
  };
  return { did: data.did, accessJwt: data.accessJwt };
}

/**
 * Create a record on the local PDS.
 */
export async function createRecord(
  pdsUrl: string,
  accessJwt: string,
  repo: string,
  collection: string,
  record: unknown,
): Promise<RecordRef> {
  const resp = await fetch(
    `${pdsUrl}/xrpc/com.atproto.repo.createRecord`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessJwt}`,
      },
      body: JSON.stringify({ repo, collection, record }),
    },
  );

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(
      `createRecord failed (${resp.status}) for ${collection}: ${body}`,
    );
  }

  const data = (await resp.json()) as { uri: string; cid: string };
  return { uri: data.uri, cid: data.cid };
}
