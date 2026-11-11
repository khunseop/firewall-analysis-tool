import asyncio
import json

import httpx
import pytest

from app.services.system_import.client import DashboardFetchError, fetch_assets


def _transport(pages, seen=None, status=200):
    """pages: 페이지 번호(1부터) → 응답 JSON. 요청 URL은 seen 리스트에 기록한다."""
    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request.url)
        page = int(request.url.params.get("page", "1"))
        if status != 200:
            return httpx.Response(status, text="boom")
        return httpx.Response(200, json=pages.get(page, {"total": 0, "page": page, "page_size": 500, "items": []}))
    return httpx.MockTransport(handler)


def _run(base_url="http://dash:5012", **kw):
    return asyncio.run(fetch_assets(base_url, **kw))


def test_pages_are_merged_in_order_until_total_is_reached():
    pages = {
        1: {"total": 3, "items": [{"hostname": "a", "ip": "10.0.0.1"}, {"hostname": "b", "ip": "10.0.0.2"}]},
        2: {"total": 3, "items": [{"hostname": "c", "ip": "10.0.0.3"}]},
    }
    rows = _run(transport=_transport(pages))
    assert [r.hostname for r in rows] == ["a", "b", "c"]


def test_request_includes_retired_and_page_size_but_no_vendor_filter():
    seen = []
    _run(transport=_transport({1: {"total": 1, "items": [{"hostname": "a"}]}}, seen))
    params = seen[0].params
    assert seen[0].path == "/api/assets"
    assert params["retired"] == "1" and params["page_size"] == "500" and params["page"] == "1"
    assert "vendor" not in params


def test_trailing_slash_in_base_url_is_ok():
    seen = []
    _run("http://dash:5012/", transport=_transport({1: {"total": 1, "items": [{"hostname": "a"}]}}, seen))
    assert seen[0].path == "/api/assets"


def test_unknown_columns_are_ignored_and_non_string_values_are_coerced():
    rows = _run(transport=_transport({1: {"total": 1, "items": [{"id": 7, "hostname": "a", "coord_x": 12, "ip": None, "extra": [1]}]}}))
    assert rows[0].hostname == "a" and rows[0].coord_x == "12" and rows[0].ip is None


def test_zero_rows_is_an_error():
    with pytest.raises(DashboardFetchError):
        _run(transport=_transport({1: {"total": 0, "items": []}}))


@pytest.mark.parametrize("payload", [{"total": 1}, {"items": "nope"}, [1, 2], "text"])
def test_malformed_json_shape_is_an_error(payload):
    with pytest.raises(DashboardFetchError):
        _run(transport=_transport({1: payload}))


def test_http_error_status_is_an_error():
    with pytest.raises(DashboardFetchError):
        _run(transport=_transport({}, status=503))


def test_invalid_json_body_is_an_error():
    transport = httpx.MockTransport(lambda r: httpx.Response(200, text="<html>not json</html>"))
    with pytest.raises(DashboardFetchError):
        _run(transport=transport)


def test_connection_error_is_an_error():
    def handler(request):
        raise httpx.ConnectError("refused")
    with pytest.raises(DashboardFetchError):
        _run(transport=httpx.MockTransport(handler))


def test_redirect_is_not_followed_and_is_an_error():
    transport = httpx.MockTransport(lambda r: httpx.Response(302, headers={"location": "http://evil/"}))
    with pytest.raises(DashboardFetchError):
        _run(transport=transport)


def test_non_http_base_url_is_rejected_without_a_request():
    with pytest.raises(DashboardFetchError):
        _run("file:///etc/passwd", transport=_transport({}))
    with pytest.raises(DashboardFetchError):
        _run("  ", transport=_transport({}))


def test_oversized_response_is_an_error(monkeypatch):
    monkeypatch.setattr("app.services.system_import.client.MAX_RESPONSE_BYTES", 50)
    big = {"total": 1, "items": [{"hostname": "x" * 200}]}
    with pytest.raises(DashboardFetchError):
        _run(transport=_transport({1: big}))


def test_server_that_never_ends_is_stopped_by_page_cap(monkeypatch):
    monkeypatch.setattr("app.services.system_import.client.MAX_PAGES", 3)
    forever = {"total": 10_000, "items": [{"hostname": "x"}]}
    transport = httpx.MockTransport(lambda r: httpx.Response(200, json=forever))
    with pytest.raises(DashboardFetchError):
        _run(transport=transport)
