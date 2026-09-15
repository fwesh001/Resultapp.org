/**
 * API Client for communicating with FastAPI backend.
 * Provides typed fetch wrapper with auth, error handling, and base URL config.
 *
 * Env:
 * - NEXT_PUBLIC_API_URL : public backend URL (e.g. https://api.resultapp.org)
 * - API_URL : server-only fallback
 */

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface ApiClientOptions extends Omit<RequestInit, "method" | "body"> {
  params?: Record<string, string | number | boolean | undefined>;
  authToken?: string;
  // If true, will not throw on non-ok status; caller handles manually
  raw?: boolean;
}

export interface ApiError extends Error {
  status: number;
  data?: unknown;
}

function getBaseUrl(): string {
  const url =
    process.env.NEXT_PUBLIC_API_URL ||
    process.env.API_URL ||
    "http://localhost:8000";

  // Remove trailing slash
  return url.replace(/\/$/, "");
}

function buildUrl(
  endpoint: string,
  params?: Record<string, string | number | boolean | undefined>
): string {
  const base = getBaseUrl();
  const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const url = new URL(`${base}${path}`);

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.append(key, String(value));
      }
    });
  }

  return url.toString();
}

async function apiFetch<T>(
  endpoint: string,
  method: HttpMethod = "GET",
  body?: unknown,
  options: ApiClientOptions = {}
): Promise<T> {
  const { params, authToken, headers, raw, ...rest } = options;

  const url = buildUrl(endpoint, params);

  const isFormData = body instanceof FormData;

  const requestHeaders: Record<string, string> = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...(headers as Record<string, string>),
  };

  if (authToken) {
    requestHeaders["Authorization"] = `Bearer ${authToken}`;
  }

  // For server components, forward cookies if available (optional)
  // This is a placeholder - actual cookie forwarding should be done via next/headers when needed

  const response = await fetch(url, {
    method,
    headers: requestHeaders,
    body: body
      ? isFormData
        ? (body as FormData)
        : JSON.stringify(body)
      : undefined,
    ...rest,
    cache: rest.cache ?? "no-store",
  });

  if (raw) {
    return response as unknown as T;
  }

  const contentType = response.headers.get("content-type");
  const isJson = contentType?.includes("application/json");

  const data = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    const error = new Error(
      (data as { message?: string; detail?: string })?.message ||
        (data as { detail?: string })?.detail ||
        `API request failed: ${response.status} ${response.statusText}`
    ) as ApiError;
    (error as ApiError).status = response.status;
    (error as ApiError).data = data;
    throw error;
  }

  return data as T;
}

// Typed convenience methods
export const apiClient = {
  get: <T>(endpoint: string, options?: ApiClientOptions) =>
    apiFetch<T>(endpoint, "GET", undefined, options),

  post: <T>(endpoint: string, body?: unknown, options?: ApiClientOptions) =>
    apiFetch<T>(endpoint, "POST", body, options),

  put: <T>(endpoint: string, body?: unknown, options?: ApiClientOptions) =>
    apiFetch<T>(endpoint, "PUT", body, options),

  patch: <T>(endpoint: string, body?: unknown, options?: ApiClientOptions) =>
    apiFetch<T>(endpoint, "PATCH", body, options),

  delete: <T>(endpoint: string, options?: ApiClientOptions) =>
    apiFetch<T>(endpoint, "DELETE", undefined, options),

  // For uploading files / student CSVs etc.
  upload: <T>(endpoint: string, formData: FormData, options?: ApiClientOptions) =>
    apiFetch<T>(endpoint, "POST", formData, options),
};

// Example backend response wrappers
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data: T;
}
