# Document Parser UI

Empty Angular application scaffolding.

## Development

Run `ng serve` for a dev server. Navigate to `http://localhost:4200/`. The application will automatically reload if you change any of the source files.

Local browser configuration is defined in `src/assets/runtime-config.js`. These values are public and are downloaded by every browser; never put client secrets, private keys, passwords, or refresh tokens in this file.

## Build

Run `ng build` to build the project. The build artifacts will be stored in the `dist/` directory.

## Container Configuration

The Docker image generates `assets/runtime-config.js` when the container starts. This allows the same image to be deployed to development, staging, and production without rebuilding Angular.

Set every required environment variable on the deployed container:

```text
API_BASE_URL
FIREBASE_API_KEY
FIREBASE_AUTH_DOMAIN
FIREBASE_DATABASE_URL
FIREBASE_PROJECT_ID
FIREBASE_STORAGE_BUCKET
FIREBASE_MESSAGING_SENDER_ID
FIREBASE_APP_ID
GOOGLE_CLIENT_ID
GOOGLE_PICKER_API_KEY
GOOGLE_SERVICE_ACCOUNT_EMAIL
```

Example:

```powershell
docker run --rm -p 8080:80 `
	-e API_BASE_URL=https://api.example.com/api `
	-e FIREBASE_API_KEY=your-public-web-key `
	-e FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com `
	-e FIREBASE_DATABASE_URL=https://your-project-default-rtdb.firebaseio.com `
	-e FIREBASE_PROJECT_ID=your-project `
	-e FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app `
	-e FIREBASE_MESSAGING_SENDER_ID=your-sender-id `
	-e FIREBASE_APP_ID=your-app-id `
	-e GOOGLE_CLIENT_ID=your-web-client-id `
	-e GOOGLE_PICKER_API_KEY=your-restricted-browser-key `
	-e GOOGLE_SERVICE_ACCOUNT_EMAIL=service-account@example.iam.gserviceaccount.com `
	document-parser-ui
```

Restrict browser API keys by allowed APIs and HTTP referrers. Backend credentials belong in the API service and its secret manager, not in these variables.

## Running Tests

Run `ng test` to execute the unit tests via Karma.
