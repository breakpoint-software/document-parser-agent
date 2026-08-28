from __future__ import annotations

import shutil
import unittest
from unittest.mock import Mock, patch

from document_orchestrator import _get_openai_api_key_from_env
from firebase_workspace_config import WorkspaceConfig
from google_drive_service import scan_drive_supported_documents
from google_oauth_credentials import build_google_oauth_credentials
from google_sheets_service import append_row_to_google_sheet


class GoogleOAuthTests(unittest.TestCase):
    def test_openai_key_is_read_from_environment(self) -> None:
        with patch.dict("os.environ", {"OPENAI_API_KEY": " env-openai-key "}, clear=False):
            self.assertEqual(_get_openai_api_key_from_env(), "env-openai-key")

    def test_workspace_reads_existing_top_level_refresh_token(self) -> None:
        workspace = WorkspaceConfig.from_dict(
            {
                "active": True,
                "displayName": "Sergio Segovia",
                "credentials": {"openai_api_key": "openai-key"},
                "refresh_token": "saved-refresh-token",
                "execution_mode": "source_by_rule",
            },
            "workspace-123",
        )

        self.assertEqual(workspace.google_refresh_token, "saved-refresh-token")
        self.assertEqual(workspace.credentials.openai_api_key, "openai-key")

    def test_workspace_does_not_read_refresh_token_from_credentials(self) -> None:
        workspace = WorkspaceConfig.from_dict(
            {
                "active": True,
                "credentials": {
                    "openai_api_key": "openai-key",
                    "google_refresh_token": "nested-refresh-token",
                },
                "execution_mode": "source_by_rule",
            },
            "workspace-123",
        )

        self.assertEqual(workspace.google_refresh_token, "")

    def test_builds_user_oauth_credentials(self) -> None:
        with patch.dict(
            "os.environ",
            {
                "GOOGLE_CLIENT_ID": "client-id",
                "GOOGLE_CLIENT_SECRET": "client-secret",
            },
            clear=False,
        ):
            credentials = build_google_oauth_credentials(
                "saved-refresh-token",
                ["drive-scope", "sheets-scope"],
            )

        self.assertEqual(credentials.refresh_token, "saved-refresh-token")
        self.assertEqual(credentials.client_id, "client-id")
        self.assertEqual(credentials.client_secret, "client-secret")
        self.assertIsNone(credentials.scopes)
        self.assertIsNone(credentials.default_scopes)

    @patch("google_drive_service.build_drive_service")
    @patch("google_drive_service._list_files_from_folder", return_value=[])
    def test_drive_scan_uses_supplied_workspace_service(
        self,
        list_files: Mock,
        build_service: Mock,
    ) -> None:
        workspace_service = Mock()
        result = scan_drive_supported_documents(["folder-id"], service=workspace_service)
        self.addCleanup(shutil.rmtree, result.temp_dir, True)

        build_service.assert_not_called()
        list_files.assert_called_once_with(workspace_service, "folder-id", True)

    @patch("google_sheets_service.gspread.authorize")
    def test_sheets_uses_supplied_credentials_and_spreadsheet_id(self, authorize: Mock) -> None:
        credentials = Mock()
        client = authorize.return_value
        spreadsheet = client.open_by_key.return_value
        worksheet = spreadsheet.worksheet.return_value
        worksheet.get.return_value = []

        append_row_to_google_sheet(
            {"total": 10},
            ["total"],
            spreadsheet_id="workspace-sheet-id",
            worksheet_name="Salidas",
            credentials=credentials,
        )

        authorize.assert_called_once_with(credentials)
        client.open_by_key.assert_called_once_with("workspace-sheet-id")
        spreadsheet.worksheet.assert_called_once_with("Salidas")
        worksheet.insert_row.assert_called_once_with([10], index=1, value_input_option="USER_ENTERED")


if __name__ == "__main__":
    unittest.main()
