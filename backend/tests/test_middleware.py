"""Tests for streamed request-size enforcement."""

import asyncio

from backend.middleware import CsvUploadSizeLimitMiddleware


def _run_middleware(headers: list[tuple[bytes, bytes]], chunks: list[bytes]):
    messages = [
        {"type": "http.request", "body": chunk, "more_body": index < len(chunks) - 1}
        for index, chunk in enumerate(chunks)
    ]
    sent = []
    received = 0

    async def receive():
        nonlocal received
        message = messages[received]
        received += 1
        return message

    async def send(message):
        sent.append(message)

    async def app(scope, receive, send):
        while (await receive()).get("more_body", False):
            pass
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})

    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/v1/resources/upload-csv",
        "headers": headers,
    }
    asyncio.run(CsvUploadSizeLimitMiddleware(app, max_bytes=8)(scope, receive, send))
    return sent, received


def test_csv_body_limit_rejects_oversized_stream():
    response, received = _run_middleware([], [b"12345", b"67890"])

    assert response[0]["status"] == 413
    assert b"upload size limit" in response[1]["body"]
    assert received == 2


def test_csv_body_limit_rejects_oversized_content_length_before_reading():
    response, received = _run_middleware(
        [(b"content-length", b"9")],
        [b"123456789"],
    )

    assert response[0]["status"] == 413
    assert received == 0
