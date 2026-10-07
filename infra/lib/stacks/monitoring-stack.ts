/**
 * Alarms and one dashboard for job outcomes, crashed executions, dead-letter queues, and the monthly budget.
 */

import { Duration } from "aws-cdk-lib";
import { CfnBudget } from "aws-cdk-lib/aws-budgets";
import {
  Alarm,
  ComparisonOperator,
  Dashboard,
  GraphWidget,
  type IMetric,
  SingleValueWidget,
  TextWidget,
  TreatMissingData,
} from "aws-cdk-lib/aws-cloudwatch";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import { AnyPrincipal, Effect, PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { FilterPattern, type ILogGroup, MetricFilter } from "aws-cdk-lib/aws-logs";
import { Topic } from "aws-cdk-lib/aws-sns";
import type { IQueue } from "aws-cdk-lib/aws-sqs";
import type { IStateMachine } from "aws-cdk-lib/aws-stepfunctions";
import type { Construct } from "constructs";
import { resourceName, stagified, type NameParts } from "../utils";
import { NamedStack, type AppStackProps } from "./named-stack";

const OUTCOME_NAMESPACE = "Bundesliga/Localization";

export interface MonitoringStackProps extends AppStackProps {
  stateMachine: IStateMachine;
  workflowLogs: ILogGroup;
  deadLetterQueues: { queue: IQueue; purpose: string }[];
}

export class MonitoringStack extends NamedStack {
  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);
    const { stage, config, stateMachine, workflowLogs, deadLetterQueues } = props;
    const parts = { service: config.service, name: config.name };
    const topic = new Topic(this, stagified("Alarms", stage), {
      topicName: resourceName(parts, "alarms", stage),
      enforceSSL: true,
    });
    topic.addToResourcePolicy(
      new PolicyStatement({
        effect: Effect.DENY,
        principals: [new AnyPrincipal()],
        actions: ["sns:Publish"],
        resources: [topic.topicArn],
        conditions: { Bool: { "aws:SecureTransport": "false" } },
      }),
    );
    topic.addToResourcePolicy(
      new PolicyStatement({
        principals: [new ServicePrincipal("budgets.amazonaws.com")],
        actions: ["sns:Publish"],
        resources: [topic.topicArn],
        conditions: { StringEquals: { "aws:SourceAccount": this.account } },
      }),
    );

    const action = new SnsAction(topic);
    const minute = { period: Duration.minutes(1), statistic: "Sum" };
    const crashed = stateMachine.metricFailed(minute);
    const crashedAlarm = new Alarm(this, stagified("WorkflowFailed", stage), {
      alarmName: resourceName(parts, "workflow-failed", stage),
      metric: crashed,
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });
    crashedAlarm.addAlarmAction(action);

    const jobsFailed = outcomeCount(this, parts, stage, workflowLogs, "SaveFailed", "JobFailed");
    const jobsFailedAlarm = new Alarm(this, stagified("JobFailed", stage), {
      alarmName: resourceName(parts, "job-failed", stage),
      metric: jobsFailed,
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });
    jobsFailedAlarm.addAlarmAction(action);

    const queueTitles: Record<string, string> = {
      UploadEventDeadLetter: "Upload events not delivered",
      TranscribeEventDeadLetter: "Transcription events not delivered",
      JobOutcomeFanoutDeadLetter: "Job announcements not delivered",
      JobOutcomeInboxDeadLetter: "Inbox copies not delivered",
    };
    const queueWidgets = deadLetterQueues.map(({ queue, purpose }) => {
      const visible = queue.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(1), statistic: "Maximum" });
      const alarm = new Alarm(this, stagified(purpose, stage), {
        alarmName: resourceName(parts, purpose, stage),
        metric: queue.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(5), statistic: "Maximum" }),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      });
      alarm.addAlarmAction(action);
      return new GraphWidget({
        title: queueTitles[purpose] ?? queue.queueName,
        left: [visible],
        width: 6,
        height: 6,
      });
    });

    new Dashboard(this, stagified("WorkflowHealthDashboard", stage), {
      dashboardName: resourceName(parts, "WorkflowHealthDashboard", stage),
      widgets: [
        [
          new TextWidget({
            width: 24,
            height: 3,
            markdown: [
              "## How to read this board",
              "",
              "A job can fail while the workflow execution still succeeds. That is a stored job failure, and it shows under **Jobs failed**.",
              "**Executions crashed** is a run that stopped with an error. The numbers are the total for the time range selected above.",
              "On the dead-letter charts, zero means the event was delivered. A rise means an event could not be delivered after the retries.",
            ].join("\n"),
          }),
        ],
        [
          countWidget("Jobs failed", jobsFailed),
          countWidget("Jobs completed", outcomeCount(this, parts, stage, workflowLogs, "SaveCompleted", "JobCompleted")),
          countWidget("Jobs needing review", outcomeCount(this, parts, stage, workflowLogs, "SaveNeedsReview", "JobNeedsReview")),
          countWidget("Jobs with no speech", outcomeCount(this, parts, stage, workflowLogs, "SaveEmpty", "JobEmpty")),
        ],
        [
          countWidget("Executions started", stateMachine.metricStarted(minute)),
          countWidget("Executions succeeded", stateMachine.metricSucceeded(minute)),
          countWidget("Executions crashed", crashed),
          countWidget("Executions timed out", stateMachine.metricTimedOut(minute)),
        ],
        queueWidgets,
      ],
    });

    new CfnBudget(this, stagified("MonthlyCostBudget", stage), {
      budget: {
        budgetName: resourceName(parts, "MonthlyCostBudget", stage),
        budgetType: "COST",
        timeUnit: "MONTHLY",
        budgetLimit: { amount: config.budgetUsd, unit: "USD" },
      },
      notificationsWithSubscribers: [
        {
          notification: {
            comparisonOperator: "GREATER_THAN",
            notificationType: "ACTUAL",
            threshold: 80,
            thresholdType: "PERCENTAGE",
          },
          subscribers: [{ subscriptionType: "SNS", address: topic.topicArn }],
        },
      ],
    });
  }
}

/** Counts one save state in the workflow log. That is the moment the job row gets this status. */
function outcomeCount(
  scope: Construct,
  parts: NameParts,
  stage: string,
  workflowLogs: ILogGroup,
  state: string,
  metricName: string,
): IMetric {
  const stateName = stagified(state, stage);
  const filter = new MetricFilter(scope, stagified(`${metricName}Filter`, stage), {
    logGroup: workflowLogs,
    filterName: resourceName(parts, metricName, stage),
    metricNamespace: OUTCOME_NAMESPACE,
    metricName,
    filterPattern: FilterPattern.all(
      FilterPattern.stringValue("$.type", "=", "TaskStateEntered"),
      FilterPattern.stringValue("$.details.name", "=", stateName),
    ),
    metricValue: "1",
  });
  return filter.metric({ period: Duration.minutes(1), statistic: "Sum", label: metricName });
}

/** One number for the time range selected on the dashboard. */
function countWidget(title: string, metric: IMetric): SingleValueWidget {
  return new SingleValueWidget({
    title,
    metrics: [metric],
    width: 6,
    height: 4,
    setPeriodToTimeRange: true,
  });
}
