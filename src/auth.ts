import http from "node:http";
import { OAuth2Client } from "google-auth-library";
import open from "open";
import {
  OAUTH_CLIENT_PATH,
  OAUTH_PORT,
  OAUTH_REDIRECT,
  SCOPES,
  readJSON,
} from "./config.js";

interface OAuthClient {
  client_id: string;
  client_secret: string;
}

// Doc OAuth client (client_id/secret) tu file do nguoi dung tao trong Google Cloud Console.
export function loadOAuthClient(): OAuthClient {
  const raw = readJSON<any>(OAUTH_CLIENT_PATH, null);
  if (!raw) {
    throw new Error(
      `Chua co OAuth client. Hay nhap Client ID/Secret trong app, hoac tao file ${OAUTH_CLIENT_PATH}`
    );
  }
  const c = raw.installed || raw.web || raw;
  return { client_id: c.client_id, client_secret: c.client_secret };
}

export function makeOAuth2Client(): OAuth2Client {
  const { client_id, client_secret } = loadOAuthClient();
  return new OAuth2Client(client_id, client_secret, OAUTH_REDIRECT);
}

// ===== Dung cho ban WEB (redirect URI tuy y, vd https://domain/oauth/callback) =====
export function oauthClientWithRedirect(redirectUri: string): OAuth2Client {
  const { client_id, client_secret } = loadOAuthClient();
  return new OAuth2Client(client_id, client_secret, redirectUri);
}

export function getAuthUrl(redirectUri: string): string {
  return oauthClientWithRedirect(redirectUri).generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });
}

// Doi code lay tai khoan (email + refreshToken) - dung o route callback cua web
export async function exchangeCode(
  code: string,
  redirectUri: string
): Promise<{ email: string; refreshToken: string }> {
  const oauth2 = oauthClientWithRedirect(redirectUri);
  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) throw new Error("Khong nhan duoc refresh_token. Hay thu lai.");
  let email = "unknown";
  try {
    const r = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const info = (await r.json()) as { email?: string };
    if (info.email) email = info.email;
  } catch {}
  return { email, refreshToken: tokens.refresh_token };
}

// Mo trinh duyet, dang nhap, nhan code qua loopback, doi lay refresh_token.
export async function runOAuthFlow(): Promise<{ email: string; refreshToken: string }> {
  const oauth2 = makeOAuth2Client();
  const authUrl = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });

  const code = await new Promise<string>((resolve, reject) => {
    let timer: NodeJS.Timeout;
    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url || "", OAUTH_REDIRECT);
        if (!url.pathname.startsWith("/callback")) {
          res.writeHead(404).end();
          return;
        }
        const err = url.searchParams.get("error");
        const c = url.searchParams.get("code");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          `<html><body style="font-family:sans-serif;text-align:center;padding-top:60px">` +
            `<h2>${err ? "Loi: " + err : "Da ket noi xong! Ban co the dong tab nay."}</h2></body></html>`
        );
        clearTimeout(timer);
        server.close();
        if (err) reject(new Error(err));
        else if (c) resolve(c);
        else reject(new Error("Khong nhan duoc code"));
      } catch (e) {
        reject(e as Error);
      }
    });
    // Bat loi cua server (vd cong bi chiem) -> bao loi nhe nhang, khong crash app
    server.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (e.code === "EADDRINUSE") {
        reject(
          new Error(
            `Cong ${OAUTH_PORT} dang bi chiem (co the con 1 cua so Driver Cloud khac, ` +
              `hoac lan dang nhap truoc chua xong). Hay dong bot roi thu lai.`
          )
        );
      } else {
        reject(e);
      }
    });
    server.listen(OAUTH_PORT, "127.0.0.1", () => {
      open(authUrl).catch(() => console.log("Mo URL thu cong:\n" + authUrl));
      // Neu sau 5 phut khong dang nhap xong -> dong server, nha cong
      timer = setTimeout(() => {
        server.close();
        reject(new Error("Het thoi gian dang nhap (5 phut). Hay thu lai."));
      }, 5 * 60 * 1000);
    });
  });

  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error("Khong nhan duoc refresh_token. Hay thu lai.");
  }
  oauth2.setCredentials(tokens);

  // Lay email qua endpoint userinfo (dung access token)
  const at = tokens.access_token;
  let email = "unknown";
  try {
    const r = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${at}` },
    });
    const info = (await r.json()) as { email?: string };
    if (info.email) email = info.email;
  } catch {
    /* khong lay duoc email cung khong sao */
  }

  return { email, refreshToken: tokens.refresh_token };
}
