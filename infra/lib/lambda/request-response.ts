/**
 * Turns a web client call into a method and a JSON body, and turns a result back into a JSON response.
 * The upload and status handlers use this so they do not repeat that translation.
 */

export interface HttpEvent {
  body?: string;
  isBase64Encoded?: boolean;
  queryStringParameters?: Record<string, string | undefined>;
  requestContext?: { http?: { method?: string } };
}

/** Builds the JSON response Lambda must return. */
export function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  };
}

/** Parses the request body. A base64 body is decoded first. An empty body becomes {}. */
export function readBody(event: HttpEvent): unknown {
  if (!event.body) {
    return {};
  }
  const text = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  return JSON.parse(text) as unknown;
}

/** Reads GET, POST, or whichever method the call used. Defaults to GET. */
export function methodOf(event: HttpEvent): string {
  return event.requestContext?.http?.method ?? "GET";
}
