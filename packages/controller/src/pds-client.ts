import { createLogger } from "@avaast/shared";

/**
 * PdsClient handles authenticated communication with a PDS.
 *
 * Uses AT Protocol app passwords — revocable credentials created in PDS
 * settings. Handles session creation, refresh, and auto-retry on 401.
 */
export class PdsClient {
  private logger = createLogger("pds-client");
  private pdsEndpoint: string;
  private accessJwt: string | null = null;
  private refreshJwt: string | null = null;
  private did: string | null = null;

  constructor(pdsEndpoint: string) {
    this.pdsEndpoint = pdsEndpoint;
  }

  async createSession(
    identifier: string,
    appPassword: string,
  ): Promise<void> {
    const resp = await fetch(
      `${this.pdsEndpoint}/xrpc/com.atproto.server.createSession`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password: appPassword }),
      },
    );
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`createSession failed (${resp.status}): ${text}`);
    }
    const data = (await resp.json()) as {
      accessJwt: string;
      refreshJwt: string;
      did: string;
    };
    this.accessJwt = data.accessJwt;
    this.refreshJwt = data.refreshJwt;
    this.did = data.did;
    this.logger.info(`Session created for ${this.did}`);
  }

  async refreshSession(): Promise<void> {
    if (!this.refreshJwt) {
      throw new Error("No refresh token available");
    }
    const resp = await fetch(
      `${this.pdsEndpoint}/xrpc/com.atproto.server.refreshSession`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${this.refreshJwt}` },
      },
    );
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`refreshSession failed (${resp.status}): ${text}`);
    }
    const data = (await resp.json()) as {
      accessJwt: string;
      refreshJwt: string;
      did: string;
    };
    this.accessJwt = data.accessJwt;
    this.refreshJwt = data.refreshJwt;
    this.did = data.did;
    this.logger.debug("Session refreshed");
  }

  async putRecord(
    collection: string,
    rkey: string,
    record: unknown,
  ): Promise<{ uri: string; cid: string }> {
    if (!this.accessJwt || !this.did) {
      throw new Error("Not authenticated — call createSession first");
    }

    const doRequest = async (): Promise<Response> => {
      return fetch(
        `${this.pdsEndpoint}/xrpc/com.atproto.repo.putRecord`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.accessJwt}`,
          },
          body: JSON.stringify({
            repo: this.did,
            collection,
            rkey,
            record,
          }),
        },
      );
    };

    let resp = await doRequest();

    // Auto-refresh on 401 and retry once
    if (resp.status === 401) {
      this.logger.debug("Got 401, attempting session refresh");
      try {
        await this.refreshSession();
        resp = await doRequest();
      } catch (refreshErr) {
        throw new Error(
          `putRecord failed after refresh attempt: ${refreshErr}`,
        );
      }
    }

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`putRecord failed (${resp.status}): ${text}`);
    }

    return (await resp.json()) as { uri: string; cid: string };
  }

  getDid(): string | null {
    return this.did;
  }
}
