import asyncio
from pathlib import Path

from browser_use import Agent, BrowserProfile
from browser_use.llm import ChatOpenAI
from dotenv import load_dotenv
from test_cases import RULE_CREATE_EDIT_CASE


load_dotenv(Path(__file__).resolve().parents[1] / "document-parser" / ".env")


async def main():
       # Dedicated Chrome profile for the AI tester
    profile_dir = Path.cwd() / "browser-profile"

    browser_profile = BrowserProfile(
        user_data_dir=str(profile_dir),
        profile_directory="Default",
        headless=False,
        keep_alive=True,
    )

    agent = Agent(
        task=RULE_CREATE_EDIT_CASE,
        llm=ChatOpenAI(
            model="gpt-4o-mini"
        ),
    )

    result = await agent.run()

    print("\n==============================")
    print("TEST RESULT")
    print("==============================")
    print(result)


if __name__ == "__main__":
    asyncio.run(main())