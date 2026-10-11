let csrfToken;
let tokenRequest;

export class ApiError extends Error {
  constructor(message, status = 0, code = "NETWORK_ERROR") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function clearCsrf() { csrfToken = undefined; }

async function request(path, options = {}) {
  try {
    const response = await fetch(`/api${path}`, {
      ...options,
      credentials: "same-origin",
      signal: options.signal || AbortSignal.timeout(15000),
    });
    let data;
    try { data = await response.json(); } catch {
      throw new ApiError("The server is unavailable or returned an unreadable response. Check Express and your connection.", response.status, "INVALID_RESPONSE");
    }
    if (!response.ok) throw new ApiError(data.error?.message || "The request failed. Please retry.", response.status, data.error?.code);
    if (data.csrfToken) csrfToken = data.csrfToken;
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
    tokenRequest = request("/auth/csrf").then((data) => data.csrfToken).finally(() => { tokenRequest = undefined; });
  }
  return tokenRequest;
}

export async function api(path, { method = "GET", body, signal } = {}) {
  if (method === "GET") return request(path, { signal });
  const send = async () => request(path, {
    method,
    headers: { "Content-Type": "application/json", "x-csrf-token": await getToken() },
    body: JSON.stringify(body || {}),
    signal,
  });
  try { return await send(); } catch (error) {
    // Retry only an explicit CSRF rejection: the protected operation did not run.
    if (error.code !== "CSRF_INVALID") throw error;
    clearCsrf();
    return send();
  }
}
