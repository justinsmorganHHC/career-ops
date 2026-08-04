#!/usr/bin/env node

/**
 * gmail-oauth-setup.mjs — mint the GMAIL_REFRESH_TOKEN the gmail plugin needs.
 *
 * LOCAL ADDITION (not upstream career-ops). Added 2026-07-25 alongside enabling
 * the bundled gmail ingest plugin, because the plugin's setup docs stop at "a
 * refresh token from the consent flow" without shipping a way to get one.
 *
 * Runs the OAuth 2.0 loopback flow for a Desktop client, with PKCE:
 *   1. Spins up a throwaway HTTP server on 127.0.0.1:<random port>.
 *   2. Opens Google's consent screen in your browser.
 *   3. Catches the redirect, exchanges the code, prints the refresh token.
 *
 * Scope is gmail.readonly and nothing else — the plugin only ever reads. This
 * script never writes to .env for you; it prints the line to paste, so the
 * secret never lands somewhere you didn't look at first.
 *
 * Usage:
 *   node gmail-oauth-setup.mjs                       # auto-detects credentials (see below)
 *   node gmail-oauth-setup.mjs --write-env           # ...and writes the 3 vars into .env for you
 *   node gmail-oauth-setup.mjs --client-json <path>  # Google's downloaded client_secret_*.json
 *   node gmail-oauth-setup.mjs --id <id> --secret <secret>
 *
 * Credential resolution order: --id/--secret → --client-json → GMAIL_CLIENT_ID /
 * GMAIL_CLIENT_SECRET already in .env → the newest ~/Downloads/client_secret_*.json
 * (what the Cloud Console's "Download JSON" button gives you). The last one means
 * the usual path is: download the JSON, run this with --write-env, done — the
 * secret never has to be copied by hand.
 *
 * Prereq: an OAuth client of type "Desktop app" at
 * https://console.cloud.google.com/apis/credentials, with the Gmail API enabled
 * on the same project. Desktop clients allow loopback redirects on any port, so
 * there is no redirect URI to register.
 */

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** Pull a KEY=value out of .env, ignoring commented lines. */
function fromEnvFile(key) {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return '';
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`).exec(line);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  return '';
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : '';
}

function flag(name) {
  return process.argv.includes(`--${name}`);
}

/**
 * Read a client id/secret out of the JSON the Cloud Console hands you from
 * "Download JSON". Desktop clients nest under `installed`; web clients under
 * `web` — accept either so a mis-created client fails on the redirect (a clear
 * error) rather than here with a confusing "no credentials" message.
 */
function readClientJson(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const node = raw.installed || raw.web || raw;
  if (!node.client_id || !node.client_secret) {
    throw new Error(`${file} has no client_id/client_secret — is it an OAuth client file?`);
  }
  return { clientId: node.client_id, clientSecret: node.client_secret, source: file };
}

/** Newest ~/Downloads/client_secret_*.json, if any. */
function newestDownloadedClientJson() {
  const dir = path.join(process.env.HOME || '', 'Downloads');
  if (!fs.existsSync(dir)) return '';
  const hits = fs.readdirSync(dir)
    .filter(f => f.startsWith('client_secret_') && f.endsWith('.json'))
    .map(f => path.join(dir, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return hits[0] || '';
}

/**
 * Upsert KEY=value lines into .env, replacing an existing (possibly commented)
 * definition in place so the file doesn't accumulate duplicates. Created with
 * 0600 if absent — this file holds a long-lived credential.
 */
function writeEnv(vars) {
  const envPath = path.join(__dirname, '.env');
  let lines = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8').split('\n') : [];
  for (const [key, value] of Object.entries(vars)) {
    const line = `${key}=${value}`;
    const idx = lines.findIndex(l => new RegExp(`^\\s*#?\\s*${key}\\s*=`).test(l));
    if (idx !== -1) lines[idx] = line;
    else lines.push(line);
  }
  fs.writeFileSync(envPath, lines.join('\n'), { mode: 0o600 });
  try { fs.chmodSync(envPath, 0o600); } catch { /* best effort */ }
  return envPath;
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start' : 'xdg-open';
  spawn(cmd, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' })
    .on('error', () => { /* headless box — the printed URL is the fallback */ })
    .unref();
}

/** Serve exactly one request: the OAuth redirect. Resolves with the code. */
function waitForCode(server) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out after 5 minutes waiting for consent')), 5 * 60_000);
    server.on('request', (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname !== '/') { res.writeHead(404).end(); return; }
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body style="font-family:system-ui;padding:3rem">
        <h2>${code ? '✅ Authorized' : '❌ Failed'}</h2>
        <p>${code ? 'Refresh token printed in your terminal. You can close this tab.' : `Google said: ${error}`}</p>
      </body></html>`);
      clearTimeout(timer);
      code ? resolve(code) : reject(new Error(`consent denied: ${error}`));
    });
  });
}

async function main() {
  let clientId = arg('id');
  let clientSecret = arg('secret');
  let source = 'command line';

  if (!clientId || !clientSecret) {
    const explicit = arg('client-json');
    if (explicit) {
      ({ clientId, clientSecret, source } = readClientJson(explicit));
    } else if (fromEnvFile('GMAIL_CLIENT_ID') && fromEnvFile('GMAIL_CLIENT_SECRET')) {
      clientId = fromEnvFile('GMAIL_CLIENT_ID');
      clientSecret = fromEnvFile('GMAIL_CLIENT_SECRET');
      source = '.env';
    } else {
      const found = newestDownloadedClientJson();
      if (found) ({ clientId, clientSecret, source } = readClientJson(found));
    }
  }

  if (clientId && clientSecret) console.log(`Using credentials from: ${source}`);

  if (!clientId || !clientSecret) {
    console.error(`Missing client credentials.

Create an OAuth client (type: "Desktop app") here:
  https://console.cloud.google.com/apis/credentials
and make sure the Gmail API is enabled on the same project:
  https://console.cloud.google.com/apis/library/gmail.googleapis.com

Then either uncomment GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET in .env, or run:
  node gmail-oauth-setup.mjs --id <client-id> --secret <client-secret>`);
    process.exit(1);
  }

  // PKCE — recommended for installed apps even when a client secret is present.
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(16).toString('base64url');

  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const redirectUri = `http://127.0.0.1:${server.address().port}`;

  const consentUrl = `${AUTH_URL}?${new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent', // force a refresh token even on re-authorization
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })}`;

  console.log(`\nOpening Google's consent screen (scope: gmail.readonly)...`);
  console.log(`If nothing opens, paste this into your browser:\n\n${consentUrl}\n`);
  openBrowser(consentUrl);

  let code;
  try {
    code = await waitForCode(server);
  } finally {
    server.close();
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${(await res.text()).slice(0, 300)}`);

  const data = await res.json();
  if (!data.refresh_token) {
    throw new Error('Google returned no refresh_token. Revoke prior access at '
      + 'https://myaccount.google.com/permissions and run this again.');
  }

  const vars = {
    GMAIL_CLIENT_ID: clientId,
    GMAIL_CLIENT_SECRET: clientSecret,
    GMAIL_REFRESH_TOKEN: data.refresh_token,
  };

  if (flag('write-env')) {
    const envPath = writeEnv(vars);
    console.log(`\n✅ Done. Wrote GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN to ${envPath} (chmod 600).`);
    console.log('Nothing was printed to the terminal — the secrets went straight to the file.');
  } else {
    console.log(`\n✅ Done. Paste these three lines into .env (or re-run with --write-env):\n`);
    for (const [k, v] of Object.entries(vars)) console.log(`${k}=${v}`);
  }

  console.log(`\nNext: node plugins.mjs run gmail`);
  console.log('Note: while the OAuth app is in "Testing", this refresh token expires in 7 days.');
  console.log('Publish the app (Google Auth Platform → Audience → Publish app) to stop that.');
}

main().catch((err) => {
  console.error(`\nFatal: ${err.message}`);
  process.exit(1);
});
