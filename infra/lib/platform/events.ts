/**
 * The job-outcome event bus, the fan-out topic, and the inbox queue.
 * Failed deliveries land on a dead-letter queue.
 */

import { Duration, RemovalPolicy } from "aws-cdk-lib";
import { EventBus, Rule } from "aws-cdk-lib/aws-events";
import { SnsTopic } from "aws-cdk-lib/aws-events-targets";
import { AnyPrincipal, Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { SqsSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import { Topic } from "aws-cdk-lib/aws-sns";
import { Queue, QueueEncryption } from "aws-cdk-lib/aws-sqs";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import { resourceName, stagified, type NameParts } from "../utils";

export interface LocalizationEventsProps {
  parts: NameParts;
  stage: string;
  removalPolicy: RemovalPolicy;
}

/** Job-outcome bus, the fan-out topic other teams can subscribe to, and the inbox queue. */
export class LocalizationEvents extends Construct {
  readonly bus: EventBus;
  readonly topic: Topic;
  readonly uploadEventDlq: Queue;
  readonly transcribeDlq: Queue;
  readonly fanoutDlq: Queue;
  readonly deadLetterQueues: { queue: Queue; purpose: string }[];

  constructor(scope: Construct, id: string, props: LocalizationEventsProps) {
    super(scope, id);
    const { parts, stage } = props;
    this.bus = new EventBus(this, stagified("JobOutcomeEventBus", stage), {
      eventBusName: resourceName(parts, "JobOutcomeEventBus", stage),
    });
    this.topic = new Topic(this, stagified("JobOutcomeFanoutTopic", stage), {
      topicName: resourceName(parts, "JobOutcomeFanoutTopic", stage),
      enforceSSL: true,
    });
    this.topic.addToResourcePolicy(
      new PolicyStatement({
        effect: Effect.DENY,
        principals: [new AnyPrincipal()],
        actions: ["sns:Publish"],
        resources: [this.topic.topicArn],
        conditions: { Bool: { "aws:SecureTransport": "false" } },
      }),
    );

    const inboxDlq = this.queue("JobOutcomeInboxDeadLetter", props);
    const inbox = this.queue("JobOutcomeInbox", props, inboxDlq);
    this.topic.addSubscription(new SqsSubscription(inbox, { rawMessageDelivery: true }));

    this.uploadEventDlq = this.queue("UploadEventDeadLetter", props);
    this.transcribeDlq = this.queue("TranscribeEventDeadLetter", props);
    this.fanoutDlq = this.queue("JobOutcomeFanoutDeadLetter", props);
    this.deadLetterQueues = [
      { queue: this.uploadEventDlq, purpose: "UploadEventDeadLetter" },
      { queue: this.transcribeDlq, purpose: "TranscribeEventDeadLetter" },
      { queue: this.fanoutDlq, purpose: "JobOutcomeFanoutDeadLetter" },
      { queue: inboxDlq, purpose: "JobOutcomeInboxDeadLetter" },
    ];
    for (const queue of [this.uploadEventDlq, this.transcribeDlq, this.fanoutDlq]) {
      NagSuppressions.addResourceSuppressions(queue, [
        {
          id: "AwsSolutions-SQS3",
          reason: "This queue is the dead-letter target for an EventBridge rule. It is the last stop for an event that could not be delivered.",
        },
      ]);
    }

    new Rule(this, stagified("JobOutcomeFanoutRule", stage), {
      eventBus: this.bus,
      eventPattern: { source: ["bundesliga.localization"] },
      targets: [new SnsTopic(this.topic, { deadLetterQueue: this.fanoutDlq, retryAttempts: 2 })],
    });
  }

  /** A queue with encryption, TLS, and an optional dead-letter queue. */
  private queue(purpose: string, props: LocalizationEventsProps, deadLetterQueue?: Queue): Queue {
    const { parts, stage, removalPolicy } = props;
    return new Queue(this, stagified(purpose, stage), {
      queueName: resourceName(parts, purpose, stage),
      encryption: QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      retentionPeriod: Duration.days(14),
      removalPolicy,
      deadLetterQueue: deadLetterQueue ? { queue: deadLetterQueue, maxReceiveCount: 5 } : undefined,
    });
  }
}
