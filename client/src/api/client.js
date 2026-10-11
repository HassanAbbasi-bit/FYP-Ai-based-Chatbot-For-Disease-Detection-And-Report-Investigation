let csrfToken;
let tokenRequest;
let sessionVersion = 0;

export class ApiError extends Error {
  constructor(message, status = 0, code = "NETWORK_ERROR") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function clearCsrf() { sessionVersion++; csrfToken = undefined; tokenRequest = undefined; }

async function request(path, options = {}) {
  const version = sessionVersion;
  try {
    const response = await fetch(`/api${path}`, {
      ...options,
      credentials: "same-origin",
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    });
    let data;
    try { data = await response.json(); } catch {
      throw new ApiError("The server is unavailable or returned an unreadable response. Check Express and your connection.", response.status, "INVALID_RESPONSE");
    }
    if (!response.ok) throw new ApiError(data.error?.message || "The request failed. Please retry.", response.status, data.error?.code);
    if (data.csrfToken && version === sessionVersion) csrfToken = data.csrfToken;
    return data;
  } catch (error) {
    if (error instanceof ApiError || error.name === "AbortError") throw error;
    throw new ApiError(error.name === "TimeoutError"
      ? "The request timed out. Its result could not be confirmed; please retry or sign in again."
      : "Could not reach the server. Check your connection and start Express, then retry.");
  }
}

async function getToken() {
  if (csrfToken) return csrfToken;
  if (!tokenRequest) {
    const pending = request("/auth/csrf").then((data) => data.csrfToken).finally(() => { if (tokenRequest === pending) tokenRequest = undefined; });
    tokenRequest = pending;
  }
  return tokenRequest;
}

export async function api(path, { method = "GET", body, signal } = {}) {
  if (method === "GET") return request(path, { signal });
  const send = async () => {
    const version = sessionVersion;
    const token = await getToken();
    if (version !== sessionVersion || signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
    return request(path, {
      method,
      headers: { "Content-Type": "application/json", "x-csrf-token": token },
      body: JSON.stringify(body || {}),
      signal,
    });
  };
  try { return await send(); } catch (error) {
    // Retry only an explicit CSRF rejection: the protected operation did not run.
    if (error.code !== "CSRF_INVALID") throw error;
    clearCsrf();
    return send();
  }
}
