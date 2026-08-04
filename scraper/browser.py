"""Shared Playwright browser — singleton lifecycle within a scraper run."""

import atexit
from contextlib import contextmanager

from playwright.sync_api import sync_playwright
from playwright_stealth import Stealth

_stealth = Stealth()
_pw = None
_browser = None


def _start():
    global _pw, _browser
    if _browser is None:
        _pw = sync_playwright().start()
        _browser = _pw.chromium.launch(
            headless=True,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-dev-shm-usage",
            ],
        )
        atexit.register(_shutdown)


def _shutdown():
    global _pw, _browser
    if _browser:
        try:
            _browser.close()
        except Exception:
            pass
        _browser = None
    if _pw:
        try:
            _pw.stop()
        except Exception:
            pass
        _pw = None


@contextmanager
def browser_page():
    """Yield a new stealthed Playwright page; close it on exit."""
    _start()
    ctx = _browser.new_context(
        user_agent=(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/131.0.0.0 Safari/537.36"
        ),
        locale="fr-FR",
        timezone_id="Europe/Paris",
        viewport={"width": 1366, "height": 768},
    )
    page = ctx.new_page()
    try:
        _stealth.apply_stealth_sync(page)
        yield page
    finally:
        try:
            ctx.close()
        except Exception:
            pass
