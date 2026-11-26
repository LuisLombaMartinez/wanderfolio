"""Lambda entry points of the photo-processing workflow (Step Functions Express, ADR-0004).

Chain: mark_processing -> (Choice on `gone`) -> process_image -> mark_ready.
Any Task's Catch goes to mark_failed.
Every step receives and returns a plain JSON object; see backend/processing/README or the
ticket handoff for the contract. `gone: true` means "this Photo no longer exists or is not
ours": the workflow ends quietly and leaves the original untouched.
"""

import os
from datetime import UTC, datetime
from functools import cache
from typing import TYPE_CHECKING, Any, NotRequired, TypedDict

import boto3

from . import photos
from .images import UnreadableImage, make_web_versions
from .keys import PhotoRef, parse_original_key
from .status import Outcome

if TYPE_CHECKING:
    from mypy_boto3_dynamodb import DynamoDBClient
    from mypy_boto3_s3 import S3Client

Event = dict[str, Any]


class StartInput(TypedDict):
    bucket: str
    key: str


class GoneOutput(TypedDict):
    gone: bool


class StartOutput(TypedDict):
    gone: bool
    bucket: str
    key: str
    tripId: str
    photoId: str


class ProcessOutput(TypedDict):
    gone: bool
    tripId: str
    photoId: str
    width: int
    height: int
    takenAt: str


class ClosingOutput(TypedDict):
    status: Outcome


class CaughtError(TypedDict):
    Error: str
    Cause: NotRequired[str]


class FailInput(TypedDict, total=False):
    """Whatever state the Catch fired in: either tripId+photoId, or the original's key."""

    tripId: str
    photoId: str
    key: str
    error: CaughtError


CACHE_CONTROL = "public, max-age=31536000, immutable"


@cache
def _dynamodb() -> "DynamoDBClient":
    return boto3.client("dynamodb")


@cache
def _s3() -> "S3Client":
    return boto3.client("s3")


def _ref(event: Any) -> PhotoRef:
    return PhotoRef(trip_id=event["tripId"], photo_id=event["photoId"])


def mark_processing(event: StartInput, _context: object = None) -> StartOutput | GoneOutput:
    """Input `{bucket, key}`. Output `{gone: true}` (Photo missing, or already ready/failed)
    or the next step's input (see module doc)."""
    ref = parse_original_key(event["key"])
    if ref is None:
        return {"gone": True}
    if not photos.mark_processing(_dynamodb(), os.environ["TABLE_NAME"], ref):
        return {"gone": True}
    return {
        "gone": False,
        "bucket": event["bucket"],
        "key": event["key"],
        "tripId": ref.trip_id,
        "photoId": ref.photo_id,
    }


def process_image(event: StartOutput, _context: object = None) -> ProcessOutput:
    """Input is mark_processing's output. Writes thumb.webp and large.webp (original only read).

    Raises `UnreadableImage` when the original cannot be decoded; the Catch routes to mark_failed.
    """
    ref = _ref(event)
    s3 = _s3()
    original = s3.get_object(Bucket=event["bucket"], Key=event["key"])
    try:
        body = original["Body"].read()
    finally:
        original["Body"].close()
    versions = make_web_versions(body)
    # Date taken: EXIF DateTimeOriginal (UTC), else the upload time.
    taken_at = versions.taken_at or original.get("LastModified") or datetime.now(UTC)
    for key, data in ((ref.thumb_key, versions.thumb), (ref.large_key, versions.large)):
        s3.put_object(
            Bucket=event["bucket"],
            Key=key,
            Body=data,
            ContentType="image/webp",
            CacheControl=CACHE_CONTROL,
        )
    return {
        "gone": False,
        "tripId": ref.trip_id,
        "photoId": ref.photo_id,
        "width": versions.width,
        "height": versions.height,
        "takenAt": photos.format_taken_at(taken_at),
    }


def mark_ready(event: ProcessOutput, _context: object = None) -> ClosingOutput:
    """Input is process_image's output. Output `{status}`: `ready`, or `gone`."""
    ok = photos.mark_ready(
        _dynamodb(),
        os.environ["TABLE_NAME"],
        _ref(event),
        taken_at=event["takenAt"],
        width=event["width"],
        height=event["height"],
    )
    return {"status": Outcome.READY if ok else Outcome.GONE}


def _failure_reason(error: CaughtError | None) -> str:
    """A short code, then the exception class: `unreadable-image: UnreadableImage`."""
    name = error["Error"] if error else "Unknown"
    name = "".join(ch for ch in name if ch.isalnum() or ch in "._$")[:80] or "Unknown"
    code = "unreadable-image" if name == UnreadableImage.__name__ else "processing-error"
    return f"{code}: {name}"


def mark_failed(event: FailInput, _context: object = None) -> ClosingOutput:
    """The Catch target. Input: the failed state's input (it has `tripId`+`photoId`, or, for
    mark_processing itself, `key`) plus `error` (`{Error, Cause}`, via ResultPath `$.error`).
    Output `{status}`: `status` is `failed`, or `gone` when the Photo no longer exists or
    is already ready/failed (then nothing changes)."""
    trip_id, photo_id, key = event.get("tripId"), event.get("photoId"), event.get("key")
    if trip_id and photo_id:
        ref: PhotoRef | None = PhotoRef(trip_id=trip_id, photo_id=photo_id)
    else:
        ref = parse_original_key(key or "")
    if ref is None:
        return {"status": Outcome.GONE}
    ok = photos.mark_failed(
        _dynamodb(), os.environ["TABLE_NAME"], ref, _failure_reason(event.get("error"))
    )
    return {"status": Outcome.FAILED if ok else Outcome.GONE}
