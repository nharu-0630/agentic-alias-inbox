export const ERROR_MESSAGES = {
  "not-configured": "設定が未完了です。設定を開いてください",
  unauthorized: "認証に失敗しました。Service Token と Access ポリシーを確認してください",
  exists: "同じアドレスのメールボックスが既に存在します",
  restricted: "Worker の EMAIL_ADDRESSES が設定されているため作成できません",
  "bad-request": "リクエストが拒否されました",
  network: "Worker に接続できませんでした",
  server: "Worker でエラーが発生しました",
};

const KIND_BY_STATUS = {
  400: "bad-request",
  401: "unauthorized",
  403: "unauthorized",
  409: "exists",
  422: "bad-request",
};

export function failure(kind, status, detail) {
  const message = detail ? `${ERROR_MESSAGES[kind]} (${detail})` : ERROR_MESSAGES[kind];
  return status === undefined ? { ok: false, kind, message } : { ok: false, kind, status, message };
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

// Access answers a missing or bad service token with a redirect to its login page, which
// `redirect: "manual"` surfaces as an opaque redirect in browsers and a raw 3xx elsewhere.
async function classifyFailure(response) {
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    return failure("unauthorized", response.status || undefined);
  }
  const body = await readJson(response);
  const serverError = typeof body?.error === "string" ? body.error : undefined;
  if (response.status === 403 && serverError?.includes("EMAIL_ADDRESSES")) {
    return failure("restricted", 403);
  }
  const kind = KIND_BY_STATUS[response.status] ?? "server";
  return failure(kind, response.status, kind === "bad-request" ? serverError : undefined);
}

export function createApiClient(settings, fetchImpl = fetch) {
  async function request(path, init = {}) {
    try {
      return await fetchImpl(settings.workerUrl + path, {
        ...init,
        credentials: "omit",
        redirect: "manual",
        headers: {
          ...init.headers,
          "CF-Access-Client-Id": settings.clientId,
          "CF-Access-Client-Secret": settings.clientSecret,
        },
      });
    } catch (error) {
      return { networkError: error };
    }
  }

  async function call(path, init, expectedStatus, parse) {
    const response = await request(path, init);
    if (response.networkError) return failure("network", undefined, String(response.networkError.message ?? ""));
    if (response.status !== expectedStatus) return classifyFailure(response);
    const value = parse(await readJson(response));
    return value === undefined ? failure("server", response.status, "予期しない応答") : value;
  }

  return {
    createMailbox(email, name) {
      return call(
        "/api/v1/mailboxes",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, name }),
        },
        201,
        (body) => (typeof body?.email === "string" ? { ok: true, mailbox: body } : undefined),
      );
    },
    getConfig() {
      return call("/api/v1/config", { method: "GET" }, 200, (body) =>
        Array.isArray(body?.domains) && Array.isArray(body?.emailAddresses)
          ? { ok: true, config: { domains: body.domains, emailAddresses: body.emailAddresses } }
          : undefined,
      );
    },
  };
}

export function configWarnings(config, domain) {
  const warnings = [];
  if (!config.domains.map((d) => d.toLowerCase()).includes(domain)) {
    warnings.push(`Worker の DOMAINS に ${domain} が含まれていません (現在: ${config.domains.join(", ") || "なし"})`);
  }
  if (config.emailAddresses.length > 0) {
    warnings.push("Worker の EMAIL_ADDRESSES が空ではないため、メールボックスの作成は 403 になります");
  }
  return warnings;
}
