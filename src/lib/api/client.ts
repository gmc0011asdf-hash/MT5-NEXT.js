/**
 * Read-only bridge to FastAPI. Only allowlisted GET paths; no credentials; no trading routes.
 */

const ALLOWED_GET_PATHS = new Set(["/api/health", "/api/monitoring/status"]);

const DEFAULT_TIMEOUT_MS = 10_000;

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; errorAr: string; status?: number; code?: string };

export function getApiBaseUrl(): string | null {
  const raw = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

function assertReadOnlyPath(path: string): void {
  const normalized = path.split("?")[0] ?? path;
  if (!ALLOWED_GET_PATHS.has(normalized)) {
    throw new ReadOnlyPathError(normalized);
  }
}

export class ReadOnlyPathError extends Error {
  constructor(public readonly path: string) {
    super(`read_only_path:${path}`);
    this.name = "ReadOnlyPathError";
  }
}

function arabicFetchError(err: unknown, status?: number): { errorAr: string; code?: string } {
  if (err instanceof ReadOnlyPathError) {
    return {
      errorAr: "المسار غير مسموح في وضع القراءة فقط لهذه الواجهة.",
      code: "PATH_NOT_ALLOWED",
    };
  }
  if (typeof err === "object" && err !== null && "name" in err && (err as Error).name === "AbortError") {
    return { errorAr: "انتهت مهلة الاتصال بالخادم.", code: "TIMEOUT" };
  }
  if (status === 401 || status === 403) {
    return {
      errorAr: "الوصول مرفوض. قد يتطلب الخادم مفتاح API — لا يُرسل من هذه الواجهة.",
      code: "UNAUTHORIZED",
    };
  }
  if (status !== undefined && status >= 500) {
    return { errorAr: "خطأ في الخادم. حاول لاحقاً.", code: "SERVER_ERROR" };
  }
  if (status !== undefined && status >= 400) {
    return { errorAr: `طلب غير صالح (رمز ${status}).`, code: "HTTP_ERROR" };
  }
  return {
    errorAr: "تعذّر الاتصال بالخادم. تحقق من التشغيل وعنوان NEXT_PUBLIC_API_BASE_URL.",
    code: "NETWORK",
  };
}

/**
 * GET JSON from allowlisted path only. Omits credentials; safe for browser.
 */
export async function readOnlyGetJsonSafe<T>(
  path: string,
  options?: { timeoutMs?: number },
): Promise<ApiResult<T>> {
  const base = getApiBaseUrl();
  if (!base) {
    return {
      ok: false,
      errorAr: "لم يُضبط عنوان واجهة البرمجة (NEXT_PUBLIC_API_BASE_URL).",
      code: "NO_BASE_URL",
    };
  }

  try {
    assertReadOnlyPath(path);
  } catch (e) {
    const { errorAr, code } = arabicFetchError(e);
    return { ok: false, errorAr, code };
  }

  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
  } catch (e) {
    const { errorAr, code } = arabicFetchError(e);
    return { ok: false, errorAr, code };
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const { errorAr, code } = arabicFetchError(null, res.status);
    return { ok: false, errorAr, status: res.status, code };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, errorAr: "استجابة JSON غير صالحة من الخادم.", status: res.status, code: "BAD_JSON" };
  }

  return { ok: true, data: body as T };
}
