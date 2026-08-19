# Deployment

Pushing `main` runs `.github/workflows/docker-image.yml`. The workflow builds and pushes three Docker images, then deploys three Cloud Run services:

| Project | Docker Hub image | Cloud Run service | Port |
| --- | --- | --- | --- |
| `document-parser/` | `breakpointsoftware/document-parser-agent-api` | `document-parser-agent-api-1` | `8000` |
| `document-parser-api/` | `breakpointsoftware/document-parser-api` | `document-parser-api` | `3000` |
| `document-parser-ui/` | `breakpointsoftware/document-parser-ui` | `document-parser-ui` | `80` |

Change the image, service, or region values in the workflow if these names do not match the target environment.

## GitHub Secrets

Configure these under **Settings > Secrets and variables > Actions > Secrets**:

| Secret | Purpose |
| --- | --- |
| `DOCKERHUB_USERNAME` | Docker Hub account used to push images |
| `DOCKERHUB_TOKEN` | Docker Hub access token |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Full Workload Identity Provider resource name |
| `GCP_SERVICE_ACCOUNT` | Google service account used by GitHub Actions |

Do not store application credentials directly in GitHub repository variables or the workflow.

## Google Secret Manager

Create these secrets in the deployment project:

| Secret content | Used by |
| --- | --- |
| Random orchestrator API key | Python processor |
| OpenAI API key | Python processor |
| Firebase service-account JSON | Python processor and Node API |
| Google OAuth client secret | Python processor and Node API |

Configure the GitHub repository variables below with the corresponding Secret Manager **secret names**, not their values:

| Repository variable | Example |
| --- | --- |
| `ORCHESTRATOR_API_KEY_SECRET` | `document-parser-orchestrator-api-key` |
| `OPENAI_API_KEY_SECRET` | `document-parser-openai-api-key` |
| `FIREBASE_SERVICE_ACCOUNT_SECRET` | `document-parser-firebase-service-account` |
| `GOOGLE_CLIENT_SECRET_SECRET` | `document-parser-google-client-secret` |

Grant the Cloud Run runtime service account Secret Manager Secret Accessor access to these secrets. The GitHub deployment service account also needs access to the requested secrets, Cloud Run Admin, and permission to act as the runtime service account.

## GitHub Repository Variables

Configure these under **Settings > Secrets and variables > Actions > Variables**:

| Variable | Suggested value |
| --- | --- |
| `OPENAI_MODEL` | `gpt-4o` |
| `FIREBASE_WORKSPACES_COLLECTION` | `workspaces` |
| `FIREBASE_EXTRACTION_SCHEMES_COLLECTION` | `extraction_schemes` |
| `GOOGLE_DRIVE_INVOICES_BASE_PATH` | `Facturas` |
| `FIREBASE_DATABASE_URL` | Firebase Realtime Database URL |
| `FIREBASE_API_KEY` | Firebase public web API key |
| `FIREBASE_AUTH_DOMAIN` | Firebase web auth domain |
| `FIREBASE_PROJECT_ID` | Firebase project ID |
| `FIREBASE_STORAGE_BUCKET` | Firebase storage bucket |
| `FIREBASE_MESSAGING_SENDER_ID` | Firebase messaging sender ID |
| `FIREBASE_APP_ID` | Firebase web app ID |
| `GOOGLE_CLIENT_ID` | Google OAuth web client ID |
| `GOOGLE_PICKER_API_KEY` | Restricted Google Picker browser key |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Service-account email used for file sharing |
| `UI_ORIGIN` | Optional custom UI origin, without a trailing slash |

The workflow obtains the generated API URL from Cloud Run and injects it into the UI at container startup. It also adds the generated UI URL to API CORS automatically. `UI_ORIGIN` is only needed when a custom UI domain must also be allowed.

The API deployment receives the processor's generated Cloud Run URL as `PROCESSOR_API_URL` and the existing orchestrator API-key secret as `ORCHESTRATOR_API_KEY`. This allows authenticated inbox uploads to be processed without exposing the processor key to the browser.

## Provider Configuration

After the first deployment, add the generated UI URL and any custom domain to:

- Google OAuth authorized JavaScript origins.
- Google OAuth redirect URIs as `<UI_ORIGIN>/auth-callback`.
- Firebase Authentication authorized domains.
- Google browser API-key HTTP referrer restrictions.

Restrict each browser API key to only the APIs it requires. Firebase Security Rules and App Check provide the authorization boundary; Firebase web configuration is public by design.

## Local Development

`npm start` uses `document-parser-ui/src/assets/runtime-config.js`. It contains only public browser configuration and the local API URL. Never add OAuth client secrets, private keys, service-account JSON, passwords, access tokens, or refresh tokens to this file.

The production UI container generates the same file from Cloud Run environment variables. The Angular bundle therefore does not need to be rebuilt for each environment.

## Pre-deployment Checks

From the repository root:

```powershell
Set-Location document-parser-api
npm ci
node --check server.js
Get-ChildItem src -Recurse -Filter *.js | ForEach-Object { node --check $_.FullName }

Set-Location ../document-parser-ui
npm ci
npm run build -- --configuration development

Set-Location ..
docker build -t document-parser-processor ./document-parser
docker build -t document-parser-api ./document-parser-api
docker build -t document-parser-ui ./document-parser-ui
```

Review staged changes with `git diff --cached` before pushing. The repository currently contains broader application changes, so avoid staging everything without review.
