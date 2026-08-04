from __future__ import annotations

import math
import os
from typing import Any

import gspread
from dotenv import load_dotenv
from gspread.exceptions import WorksheetNotFound
from google.oauth2.credentials import Credentials

from google_oauth_credentials import GoogleOAuthConfigError, build_google_oauth_credentials


SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]


load_dotenv()


class GoogleSheetsConfigError(RuntimeError):
    """Raised when required Google Sheets environment configuration is missing or invalid."""


def _build_credentials(refresh_token: str | None = None) -> Credentials:
    try:
        return build_google_oauth_credentials(refresh_token, SCOPES)
    except GoogleOAuthConfigError as exc:
        raise GoogleSheetsConfigError(str(exc)) from exc


def _open_worksheet(
    client: gspread.Client,
    spreadsheet_id: str | None = None,
    worksheet_name: str | None = None,
    column_count: int = 0,
):
    resolved_spreadsheet_id = (spreadsheet_id or os.getenv("GOOGLE_SHEETS_SPREADSHEET_ID") or "").strip()
    resolved_worksheet_name = (worksheet_name or os.getenv("GOOGLE_SHEETS_WORKSHEET") or "Sheet1").strip()

    if not resolved_spreadsheet_id:
        raise GoogleSheetsConfigError("Missing GOOGLE_SHEETS_SPREADSHEET_ID.")

    spreadsheet = client.open_by_key(resolved_spreadsheet_id)
    try:
        return spreadsheet.worksheet(resolved_worksheet_name)
    except WorksheetNotFound:
        return spreadsheet.add_worksheet(
            title=resolved_worksheet_name,
            rows=1000,
            cols=max(column_count, 1),
        )


def _normalize_cell_value(value: Any) -> Any:
    if value is None:
        return ""

    # Pandas uses a dedicated NA sentinel that is not JSON serializable.
    if type(value).__name__ == "NAType":
        return ""

    # Convert numpy scalar wrappers into plain Python values when possible.
    if hasattr(value, "item"):
        try:
            value = value.item()
        except Exception:
            pass

    if isinstance(value, float) and not math.isfinite(value):
        return ""

    # Fallback for NaN-like values that are not plain floats.
    try:
        if value != value:
            return ""
    except Exception:
        pass

    return value


def _column_index_to_letter(index: int) -> str:
    if index < 1:
        raise ValueError("Column index must be greater than zero.")

    letters = []
    while index > 0:
        index, remainder = divmod(index - 1, 26)
        letters.append(chr(ord("A") + remainder))
    return "".join(reversed(letters))


def append_row_to_google_sheet(
    row: dict[str, Any],
    ordered_columns: list[str],
    worksheet_name: str | None = None,
    spreadsheet_id: str | None = None,
    credentials: Credentials | None = None,
    refresh_token: str | None = None,
) -> None:
    resolved_credentials = credentials or _build_credentials(refresh_token)
    client = gspread.authorize(resolved_credentials)
    worksheet = _open_worksheet(
        client,
        spreadsheet_id=spreadsheet_id,
        worksheet_name=worksheet_name,
        column_count=len(ordered_columns),
    )

    values = [_normalize_cell_value(row.get(column, "")) for column in ordered_columns]

    # Insert a new row at the end of the table anchored at column A.
    end_column = _column_index_to_letter(len(values))
    table_values = worksheet.get(f"A:{end_column}")
    next_row = len(table_values) + 1
    worksheet.insert_row(values, index=next_row, value_input_option="USER_ENTERED")
