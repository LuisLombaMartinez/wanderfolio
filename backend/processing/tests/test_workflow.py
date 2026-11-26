"""The workflow steps, called the way Step Functions calls them, against Floci S3 and DynamoDB."""

import io
import re
import uuid
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, cast

import pillow_heif
import pytest
from mypy_boto3_s3.type_defs import GetObjectOutputTypeDef
from PIL import Image

from tests.conftest import Aws, image_bytes
from viajecito_processing import handlers
from viajecito_processing.handlers import CaughtError, ProcessOutput, StartInput, StartOutput
from viajecito_processing.images import UnreadableImage, _parse_offset, read_taken_at
from viajecito_processing.keys import PhotoRef
from viajecito_processing.status import PhotoStatus

TRIP = uuid.uuid4().hex
FIXTURES = Path(__file__).parent / "fixtures"


def _key(trip: str, photo: str) -> dict[str, Any]:
    ref = PhotoRef(trip_id=trip, photo_id=photo)
    return {"pk": {"S": ref.pk}, "sk": {"S": ref.sk}}


def seed_photo(aws: Aws, data: bytes, status: str = PhotoStatus.AWAITING_UPLOAD) -> tuple[str, str]:
    """What the API and the browser leave behind: a Photo item plus the uploaded original."""
    photo = uuid.uuid4().hex
    aws.db.put_item(
        TableName=aws.table,
        Item={
            **_key(TRIP, photo),
            "id": {"S": photo},
            "status": {"S": str(status)},
            "filename": {"S": "beach.jpg"},
            "expiresAt": {"N": "1999999999"},
        },
    )
    aws.s3.put_object(
        Bucket=aws.bucket, Key=f"originals/{TRIP}/{photo}", Body=data, ContentType="image/jpeg"
    )
    return TRIP, photo


def event_for(aws: Aws, trip: str, photo: str) -> StartInput:
    return {"bucket": aws.bucket, "key": f"originals/{trip}/{photo}"}


def start(aws: Aws, trip: str, photo: str) -> StartOutput:
    """Run mark_processing and return the next step's input (the Photo must be live)."""
    started = handlers.mark_processing(event_for(aws, trip, photo))
    assert started["gone"] is False
    return cast(StartOutput, started)


def status_of(aws: Aws, trip: str, photo: str) -> str:
    return str(item(aws, trip, photo)["status"]["S"])


def run_workflow(aws: Aws, trip: str, photo: str) -> dict[str, Any]:
    started = handlers.mark_processing(event_for(aws, trip, photo))
    if started["gone"]:
        return dict(started)
    processed = handlers.process_image(cast(StartOutput, started))
    return dict(handlers.mark_ready(processed))


def pixel(image: Image.Image, xy: tuple[int, int]) -> tuple[int, ...]:
    value = image.getpixel(xy)
    assert isinstance(value, tuple)
    return value


def item(aws: Aws, trip: str, photo: str) -> dict[str, Any]:
    got = aws.db.get_item(TableName=aws.table, Key=_key(trip, photo))
    return dict(got["Item"])


def web_version(
    aws: Aws, trip: str, photo: str, name: str
) -> tuple[Image.Image, GetObjectOutputTypeDef]:
    got = aws.s3.get_object(Bucket=aws.bucket, Key=f"media/{trip}/{photo}/{name}")
    return Image.open(io.BytesIO(got["Body"].read())), got


@pytest.mark.parametrize("fmt", ["JPEG", "PNG", "WEBP"])
def test_upload_becomes_ready_with_web_versions(aws: Aws, fmt: str) -> None:
    original = image_bytes(fmt, (3000, 2000))
    trip, photo = seed_photo(aws, original)

    result = run_workflow(aws, trip, photo)

    assert result == {"status": "ready"}
    saved = item(aws, trip, photo)
    assert saved["status"] == {"S": "ready"}
    assert saved["width"] == {"N": "3000"} and saved["height"] == {"N": "2000"}
    assert saved["thumbKey"] == {"S": f"media/{trip}/{photo}/thumb.webp"}
    assert saved["largeKey"] == {"S": f"media/{trip}/{photo}/large.webp"}
    assert "expiresAt" not in saved and "failureReason" not in saved
    datetime.strptime(saved["takenAt"]["S"], "%Y-%m-%dT%H:%M:%SZ")  # exact format, else raises

    thumb, thumb_obj = web_version(aws, trip, photo, "thumb.webp")
    large, large_obj = web_version(aws, trip, photo, "large.webp")
    assert thumb.format == "WEBP" and large.format == "WEBP"
    assert thumb.size == (400, 267)
    assert large.size == (2048, 1365)
    assert thumb_obj["ContentType"] == "image/webp" and large_obj["ContentType"] == "image/webp"
    assert "immutable" in large_obj["CacheControl"]


def test_small_image_is_not_upscaled(aws: Aws) -> None:
    trip, photo = seed_photo(aws, image_bytes("JPEG", (300, 200)))

    run_workflow(aws, trip, photo)

    assert web_version(aws, trip, photo, "thumb.webp")[0].size == (300, 200)
    assert web_version(aws, trip, photo, "large.webp")[0].size == (300, 200)


def test_portrait_image_fits_the_same_box(aws: Aws) -> None:
    trip, photo = seed_photo(aws, image_bytes("PNG", (2000, 3000), "RGBA"))

    run_workflow(aws, trip, photo)

    assert web_version(aws, trip, photo, "thumb.webp")[0].size == (267, 400)
    assert item(aws, trip, photo)["height"] == {"N": "3000"}


def test_original_is_left_untouched(aws: Aws) -> None:
    original = image_bytes("JPEG")
    trip, photo = seed_photo(aws, original)

    run_workflow(aws, trip, photo)

    kept = aws.s3.get_object(Bucket=aws.bucket, Key=f"originals/{trip}/{photo}")
    assert kept["Body"].read() == original


def test_date_taken_falls_back_to_upload_time(aws: Aws) -> None:
    trip, photo = seed_photo(aws, image_bytes("JPEG", (100, 100)))
    uploaded = aws.s3.head_object(Bucket=aws.bucket, Key=f"originals/{trip}/{photo}")

    run_workflow(aws, trip, photo)

    expected = uploaded["LastModified"].strftime("%Y-%m-%dT%H:%M:%SZ")
    assert item(aws, trip, photo)["takenAt"] == {"S": expected}


def test_step_marks_processing_before_the_work(aws: Aws) -> None:
    trip, photo = seed_photo(aws, image_bytes("JPEG", (100, 100)))

    started = handlers.mark_processing(event_for(aws, trip, photo))

    assert started["gone"] is False
    saved = item(aws, trip, photo)
    assert saved["status"] == {"S": "processing"}
    assert "expiresAt" not in saved
    since = saved["processingSince"]["S"]
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", since)
    age = datetime.now(UTC) - datetime.strptime(since, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)
    assert timedelta(seconds=-2) < age < timedelta(seconds=30)


def test_deleted_photo_is_not_resurrected(aws: Aws) -> None:
    trip, photo = seed_photo(aws, image_bytes("JPEG", (100, 100)))
    aws.db.delete_item(TableName=aws.table, Key=_key(trip, photo))

    result = run_workflow(aws, trip, photo)

    assert result == {"gone": True}
    assert "Item" not in aws.db.get_item(TableName=aws.table, Key=_key(trip, photo))


def test_photo_deleted_mid_processing_is_not_resurrected_by_ready(aws: Aws) -> None:
    trip, photo = seed_photo(aws, image_bytes("JPEG", (100, 100)))
    started = start(aws, trip, photo)
    processed = handlers.process_image(started)
    aws.db.delete_item(TableName=aws.table, Key=_key(trip, photo))

    assert handlers.mark_ready(processed) == {"status": "gone"}


def test_key_outside_the_original_layout_is_ignored(aws: Aws) -> None:
    result = handlers.mark_processing({"bucket": aws.bucket, "key": "media/x/y/thumb.webp"})

    assert result == {"gone": True}


def test_unreadable_original_raises_and_writes_no_web_versions(aws: Aws) -> None:
    # The step must fail loudly (the Catch routes to mark_failed), not write junk.
    trip, photo = seed_photo(aws, b"this is not an image")
    started = start(aws, trip, photo)

    with pytest.raises(UnreadableImage):
        handlers.process_image(started)

    listed = aws.s3.list_objects_v2(Bucket=aws.bucket, Prefix="media/")
    assert listed["KeyCount"] == 0


def exif_jpeg(size: tuple[int, int], orientation: int, gps: bool = False) -> bytes:
    img = Image.new("RGB", size, (200, 30, 30))
    exif = Image.Exif()
    exif[0x0112] = orientation
    if gps:
        exif[0x8825] = {1: "N", 2: (28.0, 6.0, 0.0), 3: "W", 4: (15.0, 25.0, 0.0)}
    out = io.BytesIO()
    img.save(out, format="JPEG", exif=exif)
    return out.getvalue()


def test_rotated_jpeg_is_turned_upright_and_dimensions_swap(aws: Aws) -> None:
    # Orientation 6: the sensor is landscape 1200x800 but the photo is meant to be portrait.
    trip, photo = seed_photo(aws, exif_jpeg((1200, 800), 6))

    run_workflow(aws, trip, photo)

    saved = item(aws, trip, photo)
    assert saved["width"] == {"N": "800"} and saved["height"] == {"N": "1200"}
    assert web_version(aws, trip, photo, "large.webp")[0].size == (800, 1200)
    assert web_version(aws, trip, photo, "thumb.webp")[0].size == (267, 400)


def test_web_versions_carry_no_metadata(aws: Aws) -> None:
    trip, photo = seed_photo(aws, exif_jpeg((600, 400), 1, gps=True))

    run_workflow(aws, trip, photo)

    for name in ("thumb.webp", "large.webp"):
        image, _ = web_version(aws, trip, photo, name)
        assert not image.getexif(), "EXIF (GPS included) must be stripped"
        assert "exif" not in image.info and "icc_profile" not in image.info


def test_png_alpha_survives(aws: Aws) -> None:
    out = io.BytesIO()
    Image.new("RGBA", (500, 300), (255, 0, 0, 0)).save(out, format="PNG")  # fully transparent
    trip, photo = seed_photo(aws, out.getvalue())

    run_workflow(aws, trip, photo)

    image, _ = web_version(aws, trip, photo, "large.webp")
    assert image.mode == "RGBA"
    assert pixel(image, (10, 10))[3] == 0


def test_palette_png_with_transparency_keeps_alpha(aws: Aws) -> None:
    palette = Image.new("P", (200, 100), 0)
    palette.putpalette([255, 0, 0, 0, 255, 0] + [0] * 762)
    out = io.BytesIO()
    palette.save(out, format="PNG", transparency=0)
    trip, photo = seed_photo(aws, out.getvalue())

    run_workflow(aws, trip, photo)

    image, _ = web_version(aws, trip, photo, "large.webp")
    assert image.mode == "RGBA"
    assert pixel(image, (0, 0))[3] == 0  # the transparent colour


def test_cmyk_jpeg_becomes_rgb(aws: Aws) -> None:
    out = io.BytesIO()
    Image.new("CMYK", (300, 200), (0, 255, 255, 0)).save(out, format="JPEG")  # red-ish
    trip, photo = seed_photo(aws, out.getvalue())

    run_workflow(aws, trip, photo)

    image, _ = web_version(aws, trip, photo, "large.webp")
    assert image.mode == "RGB"
    r, g, b = pixel(image, (10, 10))[:3]
    assert r > 150 and g < 100 and b < 100


def test_icc_profile_is_applied_then_dropped(aws: Aws) -> None:
    from PIL import ImageCms

    profile = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
    out = io.BytesIO()
    Image.new("RGB", (300, 200), (10, 120, 240)).save(out, format="JPEG", icc_profile=profile)
    trip, photo = seed_photo(aws, out.getvalue())

    run_workflow(aws, trip, photo)

    image, _ = web_version(aws, trip, photo, "large.webp")
    assert "icc_profile" not in image.info
    r, g, b = pixel(image, (5, 5))[:3]
    assert abs(r - 10) < 8 and abs(g - 120) < 8 and abs(b - 240) < 8


def test_oversized_dimensions_are_refused_before_decoding(aws: Aws) -> None:
    out = io.BytesIO()
    Image.new("L", (8000, 8000)).save(out, format="PNG")  # 64 Mpx of black: tiny file, huge decode
    trip, photo = seed_photo(aws, out.getvalue())
    started = start(aws, trip, photo)

    with pytest.raises(UnreadableImage):
        handlers.process_image(started)

    assert aws.s3.list_objects_v2(Bucket=aws.bucket, Prefix="media/")["KeyCount"] == 0


def test_truncated_image_is_unreadable(aws: Aws) -> None:
    trip, photo = seed_photo(aws, image_bytes("JPEG", (800, 600))[:400])
    started = start(aws, trip, photo)
    with pytest.raises(UnreadableImage):
        handlers.process_image(started)


def test_running_the_workflow_twice_never_regresses_the_status(aws: Aws) -> None:
    trip, photo = seed_photo(aws, image_bytes("JPEG", (300, 200)))
    assert run_workflow(aws, trip, photo) == {"status": "ready"}
    before = item(aws, trip, photo)

    second = run_workflow(aws, trip, photo)

    assert second == {"gone": True}  # skipped at mark_processing
    assert status_of(aws, trip, photo) == "ready"
    assert item(aws, trip, photo) == before


def test_late_duplicate_ready_does_not_overwrite(aws: Aws) -> None:
    trip, photo = seed_photo(aws, image_bytes("JPEG", (300, 200)))
    started = start(aws, trip, photo)
    processed = handlers.process_image(started)
    assert handlers.mark_ready(processed)["status"] == "ready"
    stale: ProcessOutput = {**processed, "width": 1, "height": 1}

    assert handlers.mark_ready(stale) == {"status": "gone"}
    assert item(aws, trip, photo)["width"] == {"N": "300"}


def test_failed_photo_is_not_restarted(aws: Aws) -> None:
    trip, photo = seed_photo(aws, image_bytes("JPEG", (300, 200)), status="failed")

    assert run_workflow(aws, trip, photo) == {"gone": True}
    assert status_of(aws, trip, photo) == "failed"


def test_mark_failed_after_a_decode_error(aws: Aws) -> None:
    trip, photo = seed_photo(aws, b"not an image")
    started = start(aws, trip, photo)
    with pytest.raises(UnreadableImage):
        handlers.process_image(started)

    # Step Functions hands the Catch the failed state's input plus `error`.
    caught: CaughtError = {"Error": "UnreadableImage", "Cause": "x"}
    result = handlers.mark_failed(
        {"tripId": started["tripId"], "photoId": started["photoId"], "error": caught}
    )

    assert result == {"status": "failed"}
    saved = item(aws, trip, photo)
    assert saved["status"] == {"S": "failed"}
    assert saved["failureReason"] == {"S": "unreadable-image: UnreadableImage"}
    assert "expiresAt" not in saved


def test_mark_failed_from_the_first_step_still_awaiting_upload(aws: Aws) -> None:
    # A Catch on mark_processing itself only has `{bucket, key}`.
    trip, photo = seed_photo(aws, b"x")
    key = event_for(aws, trip, photo)["key"]

    result = handlers.mark_failed({"key": key, "error": {"Error": "Lambda.ServiceException"}})

    assert result == {"status": "failed"}
    saved = item(aws, trip, photo)
    assert saved["status"] == {"S": "failed"}
    assert saved["failureReason"] == {"S": "processing-error: Lambda.ServiceException"}


def test_mark_failed_never_touches_ready_or_a_missing_photo(aws: Aws) -> None:
    trip, photo = seed_photo(aws, image_bytes("JPEG", (300, 200)))
    run_workflow(aws, trip, photo)

    late = handlers.mark_failed({"tripId": trip, "photoId": photo, "error": {"Error": "Boom"}})
    assert late == {"status": "gone"}
    assert status_of(aws, trip, photo) == "ready"

    nobody = uuid.uuid4().hex
    assert handlers.mark_failed({"tripId": trip, "photoId": nobody})["status"] == "gone"
    assert handlers.mark_failed({"key": "media/x/y/thumb.webp"})["status"] == "gone"


def test_process_image_without_last_modified_falls_back_to_now(
    aws: Aws, monkeypatch: pytest.MonkeyPatch
) -> None:
    trip, photo = seed_photo(aws, image_bytes("JPEG", (100, 100)))
    started = start(aws, trip, photo)
    real = aws.s3

    class NoLastModified:
        def get_object(self, **kw: Any) -> dict[str, Any]:
            got = dict(real.get_object(**kw))
            got.pop("LastModified", None)
            return got

        def put_object(self, **kw: Any) -> Any:
            return real.put_object(**kw)

    monkeypatch.setattr(handlers, "_s3", lambda: NoLastModified())

    processed = handlers.process_image(started)

    taken = datetime.strptime(processed["takenAt"], "%Y-%m-%dT%H:%M:%SZ")
    assert abs((datetime.now(UTC).replace(tzinfo=None) - taken).total_seconds()) < 120


# --- ticket 11: real files from tests/fixtures -------------------------------------------------


def fixture(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def taken_at_of(aws: Aws, trip: str, photo: str) -> str:
    return str(item(aws, trip, photo)["takenAt"]["S"])


def test_date_taken_comes_from_exif_converted_with_its_offset(aws: Aws) -> None:
    # DateTimeOriginal 18:30:05 with OffsetTimeOriginal +02:00 is 16:30:05 UTC.
    trip, photo = seed_photo(aws, fixture("dated.jpg"))

    run_workflow(aws, trip, photo)

    assert taken_at_of(aws, trip, photo) == "2024-07-14T16:30:05Z"


def test_date_taken_without_an_offset_keeps_the_wall_clock(aws: Aws) -> None:
    trip, photo = seed_photo(aws, fixture("dated_no_offset.jpg"))

    run_workflow(aws, trip, photo)

    assert taken_at_of(aws, trip, photo) == "2024-07-14T18:30:05Z"


def test_garbage_or_missing_exif_date_falls_back_to_upload_time(aws: Aws) -> None:
    for name in ("garbage_date.jpg", "no_exif.jpg"):
        trip, photo = seed_photo(aws, fixture(name))
        uploaded = aws.s3.head_object(Bucket=aws.bucket, Key=f"originals/{trip}/{photo}")

        run_workflow(aws, trip, photo)

        expected = uploaded["LastModified"].strftime("%Y-%m-%dT%H:%M:%SZ")
        assert taken_at_of(aws, trip, photo) == expected, name


def exif_with(dto: str, offset: str | None = None) -> Image.Exif:
    """A parsed Exif holding DateTimeOriginal (`dto`) and OffsetTimeOriginal (`offset`)."""
    built = Image.Exif()
    ifd = {0x9003: dto}
    if offset is not None:
        ifd[0x9011] = offset
    built[0x8769] = ifd
    parsed = Image.Exif()
    parsed.load(built.tobytes())
    return parsed


@pytest.mark.parametrize(
    "raw",
    [
        "0000:00:00 00:00:00",
        "2024:13:45 99:00:00",
        "",
        "2024-07-14 18:30:05",
        "1970:01:01 00:00:00",
    ],
)
def test_implausible_exif_dates_are_rejected(raw: str) -> None:
    assert read_taken_at(exif_with(dto=raw)) is None


@pytest.mark.parametrize(
    ("raw", "offset"),
    [("0001:01:01 00:00:00", "+14:00"), ("9999:12:31 23:59:59", "-05:00")],
)
def test_extreme_dates_with_an_offset_fall_back_instead_of_overflowing(
    raw: str, offset: str
) -> None:
    assert read_taken_at(exif_with(dto=raw, offset=offset)) is None


def test_extreme_exif_date_does_not_fail_the_photo(aws: Aws) -> None:
    data = image_with_exif(exif_with(dto="9999:12:31 23:59:59", offset="-05:00"))
    trip, photo = seed_photo(aws, data)
    uploaded = aws.s3.head_object(Bucket=aws.bucket, Key=f"originals/{trip}/{photo}")

    run_workflow(aws, trip, photo)

    expected = uploaded["LastModified"].strftime("%Y-%m-%dT%H:%M:%SZ")
    assert status_of(aws, trip, photo) == "ready"
    assert taken_at_of(aws, trip, photo) == expected


def image_with_exif(exif: Image.Exif) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (64, 48), (10, 20, 30)).save(out, format="JPEG", exif=exif)
    return out.getvalue()


def test_offset_with_non_ascii_digits_is_ignored() -> None:
    assert _parse_offset("+\u0660\u0662:00") is None  # Arabic-Indic digits, int() would accept
    assert _parse_offset("+02:00") == timezone(timedelta(hours=2))


def test_future_exif_date_is_rejected_but_tomorrow_in_another_zone_is_fine() -> None:
    now = datetime(2026, 11, 10, 12, 0, tzinfo=UTC)
    far = exif_with(dto="2030:01:01 00:00:00")
    near = exif_with(dto="2026:11:10 23:00:00", offset="-12:00")  # 11:00 UTC next day
    assert read_taken_at(far, now) is None
    assert read_taken_at(near, now) == datetime(2026, 11, 11, 11, 0, tzinfo=UTC)


def test_bad_offset_is_ignored_not_fatal() -> None:
    exif = exif_with(dto="2024:07:14 18:30:05", offset="CEST")
    assert read_taken_at(exif) == datetime(2024, 7, 14, 18, 30, 5, tzinfo=UTC)


def test_rotated_fixture_is_upright(aws: Aws) -> None:
    trip, photo = seed_photo(aws, fixture("rotated.jpg"))  # 240x160 sensor, orientation 6

    run_workflow(aws, trip, photo)

    assert item(aws, trip, photo)["width"] == {"N": "160"}
    assert web_version(aws, trip, photo, "large.webp")[0].size == (160, 240)


def test_gps_fixture_yields_clean_versions_and_untouched_original(aws: Aws) -> None:
    original = fixture("gps.jpg")
    assert 0x8825 in Image.open(io.BytesIO(original)).getexif(), "fixture must carry GPS"
    trip, photo = seed_photo(aws, original)

    run_workflow(aws, trip, photo)

    for name in ("thumb.webp", "large.webp"):
        body = aws.s3.get_object(Bucket=aws.bucket, Key=f"media/{trip}/{photo}/{name}")[
            "Body"
        ].read()
        image = Image.open(io.BytesIO(body))
        assert not image.getexif() and "exif" not in image.info and "xmp" not in image.info
        assert b"EXIF" not in body and b"GPS" not in body
    kept = aws.s3.get_object(Bucket=aws.bucket, Key=f"originals/{trip}/{photo}")["Body"].read()
    assert kept == original
    assert taken_at_of(aws, trip, photo) == "2023-01-02T03:04:05Z"


def test_rotated_heic_is_upright_and_dimensions_swap(aws: Aws) -> None:
    # Stored 160x240 with an `irot` box (a phone's portrait shot), shown 240x160 landscape with
    # the red marker at the bottom-left.
    trip, photo = seed_photo(aws, fixture("rotated.heic"))

    run_workflow(aws, trip, photo)

    saved = item(aws, trip, photo)
    assert saved["width"] == {"N": "240"} and saved["height"] == {"N": "160"}
    large, _ = web_version(aws, trip, photo, "large.webp")
    assert large.size == (240, 160)
    red, blue = pixel(large, (10, 150)), pixel(large, (230, 10))
    assert red[0] > 180 and red[2] < 100, red
    assert blue[2] > 150 and blue[0] < 100, blue


@pytest.mark.parametrize("name", ["sample.png", "sample.webp", "sample.heic"])
def test_other_formats_are_processed(aws: Aws, name: str) -> None:
    trip, photo = seed_photo(aws, fixture(name))

    assert run_workflow(aws, trip, photo) == {"status": "ready"}

    saved = item(aws, trip, photo)
    assert saved["width"] == {"N": "240"} and saved["height"] == {"N": "160"}
    assert web_version(aws, trip, photo, "large.webp")[0].format == "WEBP"


def test_heif_date_taken_gps_stripped_and_content_type(aws: Aws) -> None:
    # What the browser upload leaves behind for a Samsung photo: Content-Type image/heic.
    photo = uuid.uuid4().hex
    original = fixture("sample.heic")
    seed_photo(aws, original)  # (another Photo, proves the Trip can hold several)
    aws.db.put_item(
        TableName=aws.table,
        Item={
            **_key(TRIP, photo),
            "id": {"S": photo},
            "status": {"S": PhotoStatus.AWAITING_UPLOAD},
            "filename": {"S": "IMG_1.HEIC"},
            "expiresAt": {"N": "1999999999"},
        },
    )
    aws.s3.put_object(
        Bucket=aws.bucket, Key=f"originals/{TRIP}/{photo}", Body=original, ContentType="image/heic"
    )

    run_workflow(aws, TRIP, photo)

    assert taken_at_of(aws, TRIP, photo) == "2022-12-25T15:00:00Z"  # 10:00 at -05:00
    for name in ("thumb.webp", "large.webp"):
        image, _ = web_version(aws, TRIP, photo, name)
        assert not image.getexif() and "exif" not in image.info
    kept = aws.s3.get_object(Bucket=aws.bucket, Key=f"originals/{TRIP}/{photo}")
    assert kept["Body"].read() == original and kept["ContentType"] == "image/heic"


@pytest.mark.parametrize("name", ["corrupt.heic", "corrupt.jpg"])
def test_corrupt_fixture_ends_failed_with_a_reason(aws: Aws, name: str) -> None:
    trip, photo = seed_photo(aws, fixture(name))
    started = start(aws, trip, photo)

    with pytest.raises(UnreadableImage) as raised:
        handlers.process_image(started)

    # What Step Functions does after the retries run out: the Catch gets the error name.
    handlers.mark_failed(
        {
            "tripId": trip,
            "photoId": photo,
            "error": {"Error": type(raised.value).__name__, "Cause": str(raised.value)},
        }
    )
    saved = item(aws, trip, photo)
    assert saved["status"] == {"S": "failed"}
    assert saved["failureReason"] == {"S": "unreadable-image: UnreadableImage"}
    assert aws.s3.list_objects_v2(Bucket=aws.bucket, Prefix="media/")["KeyCount"] == 0


def test_oversized_heif_is_refused_before_decoding(aws: Aws, tmp_path: Path) -> None:
    big = Image.new("L", (8000, 8000))  # 64 Mpx, over the 50 Mpx cap
    path = tmp_path / "big.heic"
    pillow_heif.from_pillow(big).save(path, quality=10)
    trip, photo = seed_photo(aws, path.read_bytes())
    started = start(aws, trip, photo)

    with pytest.raises(UnreadableImage):
        handlers.process_image(started)
