import {
  getJson,
  HttpError,
  NetworkError,
  ParseError,
  ValidationError,
  postJson,
  type FetchError,
} from "fetch-safe";
import {
  authCheckSuccessSchema,
  ingestionSuccessSchema,
  type AuthCheckSuccess,
  type ClankPayload,
  type IngestionSuccess,
} from "./schemas.js";

export interface CheckAuthOptions {
  readonly apiKey: string;
  readonly endpoint: string;
}

export interface SendClankOptions {
  readonly apiKey: string;
  readonly endpoint: string;
  readonly payload: ClankPayload;
}

export type CheckAuthResult =
  | { readonly ok: true; readonly response: AuthCheckSuccess; readonly url: string }
  | {
      readonly error: FetchError;
      readonly message: string;
      readonly ok: false;
      readonly url: string;
    };

export type SendClankResult =
  | { readonly ok: true; readonly response: IngestionSuccess }
  | { readonly error: FetchError; readonly message: string; readonly ok: false };

export async function checkAuth(options: CheckAuthOptions): Promise<CheckAuthResult> {
  const url = authCheckEndpointFromIngestEndpoint(options.endpoint);
  const result = await getJson<AuthCheckSuccess>(url, {
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
    },
    schema: authCheckSuccessSchema,
  });

  if (!result.ok) {
    const error = result.error ?? new NetworkError("Unknown network error");
    return { error, message: formatAuthCheckError(error), ok: false, url };
  }

  return { ok: true, response: result.value as AuthCheckSuccess, url };
}

export async function sendClank(options: SendClankOptions): Promise<SendClankResult> {
  const result = await postJson<IngestionSuccess>(options.endpoint, options.payload, {
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
    },
    schema: ingestionSuccessSchema,
  });

  if (!result.ok) {
    const error = result.error ?? new NetworkError("Unknown network error");
    return { error, message: formatIngestError(error), ok: false };
  }

  return { ok: true, response: result.value as IngestionSuccess };
}

export function authCheckEndpointFromIngestEndpoint(endpoint: string): string {
  const url = new URL(endpoint);
  url.pathname = url.pathname.replace(/\/v1\/clanks(?:\/batch)?\/?$/u, "/v1/auth/check");
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function formatAuthCheckError(error: FetchError): string {
  if (error instanceof HttpError) {
    if (error.status === 401) {
      return "Authentication failed (401). Check your ClankerLog API key.";
    }

    return `Auth check returned HTTP ${error.status} ${error.statusText}.${formatErrorBody(error.body)}`;
  }

  if (error instanceof NetworkError) {
    return `Network error while contacting ClankerLog: ${error.message}`;
  }

  if (error instanceof ParseError) {
    return "Auth check returned invalid JSON.";
  }

  if (error instanceof ValidationError) {
    return "Auth check response did not match the expected schema.";
  }

  return "Unknown auth check error.";
}

export function formatIngestError(error: FetchError): string {
  if (error instanceof HttpError) {
    return formatHttpError(error);
  }

  if (error instanceof NetworkError) {
    return `Network error while contacting ClankerLog: ${error.message}`;
  }

  if (error instanceof ParseError) {
    return "Ingestion API returned invalid JSON.";
  }

  if (error instanceof ValidationError) {
    return "Ingestion API response did not match the expected schema.";
  }

  return "Unknown ingestion error.";
}

function formatHttpError(error: HttpError): string {
  if (error.status === 401) {
    return "Authentication failed (401). Check your ClankerLog API key.";
  }

  if (error.status === 400) {
    return `Ingestion rejected the clank payload (400).${formatErrorBody(error.body)}`;
  }

  return `Ingestion API returned HTTP ${error.status} ${error.statusText}.${formatErrorBody(error.body)}`;
}

function formatErrorBody(body: string | undefined): string {
  if (!body) {
    return "";
  }

  try {
    const parsed = JSON.parse(body) as { error?: unknown; message?: unknown };
    const message = typeof parsed.error === "string" ? parsed.error : parsed.message;
    return typeof message === "string" ? ` ${message}` : "";
  } catch {
    return ` ${body.slice(0, 200)}`;
  }
}
