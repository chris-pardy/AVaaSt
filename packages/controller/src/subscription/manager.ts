import { createLogger } from "@avaast/shared";
import type { SubscriptionRecord } from "@avaast/shared";
import { FilterEvaluator } from "./evaluator.js";
import type { SubscriberConnection } from "./transport.js";

export interface SubscriptionDefinition {
  name: string;
  record: SubscriptionRecord;
}

export class SubscriptionManager {
  private logger = createLogger("subscription-manager");
  private evaluator = new FilterEvaluator();
  private definitions = new Map<string, SubscriptionDefinition>();
  private subscribers = new Map<string, SubscriberConnection>(); // subscriberId -> connection
  // Maps collection NSID to subscription names that watch it
  private collectionToSubscriptions = new Map<string, string[]>();
  // Maps subscription name to subscriber IDs
  private subscriptionToSubscribers = new Map<string, Set<string>>();

  registerSubscription(name: string, record: SubscriptionRecord): void {
    this.definitions.set(name, { name, record });

    const collection = record.source.collection;
    const subs = this.collectionToSubscriptions.get(collection) ?? [];
    subs.push(name);
    this.collectionToSubscriptions.set(collection, subs);
    this.subscriptionToSubscribers.set(name, new Set());

    this.logger.info(
      `Registered subscription: ${name} (source: ${collection})`,
    );
  }

  addSubscriber(
    subscriptionName: string,
    connection: SubscriberConnection,
  ): void {
    this.subscribers.set(connection.id, connection);

    const subscribers = this.subscriptionToSubscribers.get(subscriptionName);
    if (subscribers) {
      subscribers.add(connection.id);
    }

    connection.onClose(() => {
      this.removeSubscriber(connection.id);
    });

    this.logger.info(
      `Subscriber ${connection.id} added to ${subscriptionName}`,
    );
  }

  removeSubscriber(subscriberId: string): void {
    this.subscribers.delete(subscriberId);
    for (const [_name, subscribers] of this.subscriptionToSubscribers) {
      subscribers.delete(subscriberId);
    }
    this.logger.debug(`Subscriber ${subscriberId} removed`);
  }

  onRecordChange(
    collection: string,
    record: Record<string, unknown>,
  ): void {
    const subscriptionNames =
      this.collectionToSubscriptions.get(collection);
    if (!subscriptionNames) return;

    for (const subName of subscriptionNames) {
      const definition = this.definitions.get(subName);
      if (!definition) continue;

      const subscriberIds =
        this.subscriptionToSubscribers.get(subName);
      if (!subscriberIds || subscriberIds.size === 0) continue;

      for (const subscriberId of subscriberIds) {
        const connection = this.subscribers.get(subscriberId);
        if (!connection) continue;

        // Evaluate filter with subscriber's params
        if (definition.record.filter) {
          const matches = this.evaluator.evaluate(
            definition.record.filter,
            record,
            connection.params,
          );
          if (!matches) continue;
        }

        // Project fields
        const projected = this.evaluator.projectFields(
          definition.record.fields,
          record,
          connection.params,
        );

        connection.send({
          type: "subscription",
          subscription: subName,
          data: projected,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  getSubscriberCount(subscriptionName?: string): number {
    if (subscriptionName) {
      return (
        this.subscriptionToSubscribers.get(subscriptionName)?.size ?? 0
      );
    }
    return this.subscribers.size;
  }

  close(): void {
    for (const connection of this.subscribers.values()) {
      connection.close();
    }
    this.subscribers.clear();
    this.subscriptionToSubscribers.clear();
  }
}
