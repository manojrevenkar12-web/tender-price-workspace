/** A small fetch wrapper: bearer token, JSON in and out, errors as ApiError with the server's code. */
import { session } from "../lib/session";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type Method = "GET" | "POST" | "PUT";

export async function request<T>(
  method: Method,
  path: string,
  body?: unknown,
  init: { raw?: string; contentType?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  const token = session.get()?.token;
  if (token) headers["authorization"] = `Bearer ${token}`;
  let payload: string | undefined;
  if (init.raw !== undefined) {
    payload = init.raw;
    headers["content-type"] = init.contentType ?? "application/xml";
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers["content-type"] = "application/json";
  }
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: payload });
  } catch {
    throw new ApiError(0, "network", "The server cannot be reached. Check your connection and try again.");
  }
  if (res.status === 401) session.clear();
  const text = await res.text();
  const data = text && res.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text;
  if (!res.ok) {
    const d = (typeof data === "object" && data) || {};
    throw new ApiError(
      res.status,
      d.error ?? "http_error",
      d.message ?? `Request failed (${res.status})`,
      d.details,
    );
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  postXml: <T>(path: string, xml: string) => request<T>("POST", path, undefined, { raw: xml }),
};

/** A link the browser can open directly (downloads): the token travels as a query parameter. */
export function authedUrl(path: string): string {
  const token = session.get()?.token;
  return token ? `${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}` : path;
}
