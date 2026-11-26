import io
import os
import uuid
from collections.abc import Iterator
from typing import TYPE_CHECKING

import boto3
import pytest
from botocore.config import Config
from PIL import Image

from viajecito_processing import handlers

if TYPE_CHECKING:
    from mypy_boto3_dynamodb import DynamoDBClient
    from mypy_boto3_s3 import S3Client


@pytest.fixture(scope="session")
def endpoint() -> str:
    # Fail, never skip: a skipped test proves nothing (see docs/agents/ticket-pipeline.md).
    url = os.environ.get("AWS_ENDPOINT_URL")
    assert url, "AWS_ENDPOINT_URL must point at Floci (http://localhost:<FLOCI_PORT>)"
    return url


@pytest.fixture
def aws(endpoint: str, monkeypatch: pytest.MonkeyPatch) -> Iterator["Aws"]:
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "test")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "test")
    monkeypatch.setenv("AWS_DEFAULT_REGION", "eu-west-1")
    suffix = uuid.uuid4().hex[:10]
    table, bucket = f"photos-{suffix}", f"photos-{suffix}"
    db = boto3.client("dynamodb", endpoint_url=endpoint)
    s3 = boto3.client("s3", endpoint_url=endpoint, config=Config(s3={"addressing_style": "path"}))
    db.create_table(
        TableName=table,
        AttributeDefinitions=[
            {"AttributeName": "pk", "AttributeType": "S"},
            {"AttributeName": "sk", "AttributeType": "S"},
        ],
        KeySchema=[
            {"AttributeName": "pk", "KeyType": "HASH"},
            {"AttributeName": "sk", "KeyType": "RANGE"},
        ],
        BillingMode="PAY_PER_REQUEST",
    )
    s3.create_bucket(
        Bucket=bucket,
        CreateBucketConfiguration={"LocationConstraint": "eu-west-1"},
    )
    monkeypatch.setenv("TABLE_NAME", table)
    handlers._dynamodb.cache_clear()
    handlers._s3.cache_clear()
    # The handlers build their own clients from the environment, as in Lambda.
    monkeypatch.setattr(handlers, "_s3", lambda: s3)
    monkeypatch.setattr(handlers, "_dynamodb", lambda: db)
    yield Aws(db=db, s3=s3, table=table, bucket=bucket)
    db.delete_table(TableName=table)


class Aws:
    def __init__(self, db: "DynamoDBClient", s3: "S3Client", table: str, bucket: str) -> None:
        self.db = db
        self.s3 = s3
        self.table = table
        self.bucket = bucket


def image_bytes(fmt: str, size: tuple[int, int] = (1200, 800), mode: str = "RGB") -> bytes:
    """A real, non-trivial picture (gradient) encoded as `fmt`."""
    img = Image.new(mode, size)
    px = img.load()
    assert px is not None
    for x in range(0, size[0]):
        for y in range(0, size[1]):
            px[x, y] = (x % 256, y % 256, (x + y) % 256) + ((255,) if mode == "RGBA" else ())
    out = io.BytesIO()
    img.save(out, format=fmt)
    return out.getvalue()
