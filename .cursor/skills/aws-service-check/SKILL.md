---
name: aws-service-check
description: Checks AWS regional availability and the pricing unit before a service is added. Use when selecting or swapping an AWS service for this pipeline.
---

# AWS service check

Before an ADR names a service:

1. Search AWS documentation for the API this pipeline would call.
2. Confirm the service exists in the stage region (`eu-central-1` unless the YAML says otherwise). Use the AWS MCP regional availability tool. Filter names must match the catalog exactly.
3. Record the pricing unit in the ADR (per minute, per character, per request, or a monthly standing charge).
4. Name the serverless option that was set aside when the chosen service is not serverless.

Do not deploy, create resources, or call a mutating API as part of this check.
