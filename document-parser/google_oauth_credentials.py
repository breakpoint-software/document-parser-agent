from __future__ import annotations

import os
from collections.abc import Sequence

from google.oauth2.credentials import Credentials


GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token"
GOOGLE_OAUTH_SCOPES = [
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/drive.metadata.readonly",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/userinfo.email",
]


class GoogleOAuthConfigError(RuntimeError):
    """Raised when Google OAuth configuration is missing."""


def build_google_oauth_credentials(
    refresh_token: str | None,
    scopes: Sequence[str],
) -> Credentials:
    resolved_refresh_token = (refresh_token or os.getenv("GOOGLE_REFRESH_TOKEN") or "").strip()
    client_id = (os.getenv("GOOGLE_CLIENT_ID") or "").strip()
    client_secret = (os.getenv("GOOGLE_CLIENT_SECRET") or "").strip()

    missing = [
        name
        for name, value in (
            ("refresh token", resolved_refresh_token),
            ("GOOGLE_CLIENT_ID", client_id),
            ("GOOGLE_CLIENT_SECRET", client_secret),
        )
        if not value
    ]
    if missing:
        raise GoogleOAuthConfigError(f"Missing Google OAuth configuration: {', '.join(missing)}.")

    # Google refresh grants reuse the scopes approved during login. Supplying
    # scopes here makes google-auth add a scope parameter that Google rejects.
    _ = scopes
    return Credentials(
        token=None,
        refresh_token=resolved_refresh_token,
        token_uri=GOOGLE_TOKEN_URI,
        client_id=client_id,
        client_secret=client_secret,
    )
