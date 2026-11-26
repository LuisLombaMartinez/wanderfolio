"""Pure image work: decode an original and produce the web versions. No AWS here."""

import io
import re
import warnings
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta, timezone

from PIL import Image, ImageCms, ImageOps, UnidentifiedImageError
from pillow_heif import register_heif_opener

# Teach Pillow to open HEIC/HEIF (Samsung, iPhone). Registered at import, before any Image.open.
register_heif_opener()

THUMB_EDGE = 400
LARGE_EDGE = 2048
WEBP_QUALITY = 82
MAX_PIXELS = 50_000_000

TAKEN_AT_FORMAT = "%Y-%m-%dT%H:%M:%SZ"

# Pillow only warns at 1x the limit and raises at 2x; we refuse both (see `_guard_size`).
Image.MAX_IMAGE_PIXELS = MAX_PIXELS

_ORIENTATION_TAG = 0x0112
_SWAPS_AXES = {5, 6, 7, 8}
_EXIF_IFD = 0x8769
_DATE_TIME_ORIGINAL = 0x9003
_OFFSET_TIME_ORIGINAL = 0x9011  # "+02:00": the camera's UTC offset when it took the photo
_EXIF_DATE_FORMAT = "%Y:%m:%d %H:%M:%S"
_EARLIEST_PLAUSIBLE_YEAR = 1990  # cameras with an unset clock say 1970/1980/2000-01-01


class UnreadableImage(Exception):  # noqa: N818  (Step Functions matches on this class name)
    """The original is not an image we can decode safely (corrupt, unsupported, too large)."""


@dataclass(frozen=True)
class WebVersions:
    width: int  # of the original, orientation applied
    height: int
    thumb: bytes
    large: bytes
    taken_at: datetime | None  # EXIF DateTimeOriginal in UTC; None when absent or implausible


def _fit(image: Image.Image, edge: int) -> Image.Image:
    """Fit a copy of `image` inside edge x edge, never upscaling."""
    copy = image.copy()
    copy.thumbnail((edge, edge), Image.Resampling.LANCZOS)
    return copy


def _encode(image: Image.Image) -> bytes:
    """Encode as WebP. Saved without `exif=`/`icc_profile=`, so no metadata (GPS) is carried."""
    out = io.BytesIO()
    image.save(out, format="WEBP", quality=WEBP_QUALITY)
    return out.getvalue()


def _to_srgb(image: Image.Image, icc_profile: bytes | None) -> Image.Image:
    """Bring the pixels into sRGB (RGB or RGBA) before the profile is dropped with the metadata."""
    if icc_profile is not None and image.mode in ("RGB", "RGBA", "CMYK"):
        try:
            source = ImageCms.ImageCmsProfile(io.BytesIO(icc_profile))
            target = ImageCms.createProfile("sRGB")
            out_mode = "RGBA" if image.mode == "RGBA" else "RGB"
            converted = ImageCms.profileToProfile(
                image, source, target, outputMode=out_mode, inPlace=False
            )
            if converted is not None:
                return converted
        except ImageCms.PyCMSError:
            pass  # a broken profile is not a broken photo: fall through to the plain conversion
    if image.mode in ("RGB", "RGBA"):
        return image
    has_alpha = image.mode in ("LA", "PA") or "transparency" in image.info
    return image.convert("RGBA" if has_alpha else "RGB")


def _parse_offset(raw: object) -> timezone | None:
    """`+02:00` / `-05:30` (EXIF OffsetTimeOriginal) as a fixed offset, else None."""
    if not isinstance(raw, str):
        return None
    text = raw.strip().strip("\x00")
    if not re.fullmatch(r"[+-]\d\d:\d\d", text, re.ASCII):  # int() would accept other scripts
        return None
    hours, minutes = int(text[1:3]), int(text[4:6])
    if hours > 14 or minutes > 59:
        return None
    delta = timedelta(hours=hours, minutes=minutes)
    return timezone(-delta if text[0] == "-" else delta)


def read_taken_at(exif: Image.Exif, now: datetime | None = None) -> datetime | None:
    """The moment the photo was taken, in UTC, from EXIF `DateTimeOriginal`.

    EXIF stores the camera's wall-clock time with no zone. When `OffsetTimeOriginal` is present
    (modern phones) the wall clock is converted to UTC with it. When it is absent we keep the wall
    clock as if it were UTC: no guessing a zone, and photos from one camera still sort correctly.
    Returns None for a missing, malformed, impossible, pre-1990 or future (> now + 1 day) value, so
    the caller falls back to the upload time.
    """
    try:
        ifd = exif.get_ifd(_EXIF_IFD)
    except (KeyError, ValueError, SyntaxError, OSError):
        return None
    raw = ifd.get(_DATE_TIME_ORIGINAL)
    if isinstance(raw, bytes):
        raw = raw.decode("ascii", errors="ignore")
    if not isinstance(raw, str):
        return None
    try:
        wall = datetime.strptime(raw.strip().strip("\x00"), _EXIF_DATE_FORMAT)
    except ValueError:
        return None
    zone = _parse_offset(ifd.get(_OFFSET_TIME_ORIGINAL)) or UTC
    try:
        taken = wall.replace(tzinfo=zone).astimezone(UTC)
    except OverflowError:  # year 1 or 9999 plus an offset leaves the representable range
        return None
    latest = (now or datetime.now(UTC)) + timedelta(days=1)
    if taken.year < _EARLIEST_PLAUSIBLE_YEAR or taken > latest:
        return None
    return taken


def _guard_size(image: Image.Image) -> None:
    width, height = image.size
    if width * height > MAX_PIXELS:
        raise UnreadableImage(f"image is {width}x{height}, over the {MAX_PIXELS} pixel limit")


def make_web_versions(original: bytes) -> WebVersions:
    """Decode `original` and build the large version, then the thumbnail from it.

    Raises `UnreadableImage` for anything that is not a readable, reasonably sized image.
    """
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            return _make_web_versions(original)
    except UnreadableImage:
        raise
    except (
        UnidentifiedImageError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
        OSError,
        ValueError,
        SyntaxError,
        EOFError,
        ImageCms.PyCMSError,
    ) as err:
        raise UnreadableImage(f"{type(err).__name__}: {err}") from err


def _make_web_versions(original: bytes) -> WebVersions:
    with Image.open(io.BytesIO(original)) as opened:
        _guard_size(opened)  # header only: nothing is decoded yet
        width, height = opened.size
        try:
            exif = opened.getexif()
            taken_at = read_taken_at(exif)
        except (KeyError, ValueError, TypeError, SyntaxError, OverflowError, OSError):
            exif, taken_at = Image.Exif(), None  # unreadable EXIF is not a broken photo
        if exif.get(_ORIENTATION_TAG) in _SWAPS_AXES:
            width, height = height, width
        icc_profile = opened.info.get("icc_profile")
        if opened.format == "JPEG":
            # Let libjpeg decode at a reduced scale (never below the large edge): far less memory.
            # Must stay AFTER the size, orientation and EXIF reads above: draft() changes
            # `opened.size` and mode, so reading them afterwards would report the reduced image.
            opened.draft(None, (LARGE_EDGE, LARGE_EDGE))
        oriented = ImageOps.exif_transpose(opened)  # applies the EXIF orientation
        oriented.load()
        image = _to_srgb(oriented, icc_profile)
        large = _fit(image, LARGE_EDGE)
        thumb = _fit(large, THUMB_EDGE)
        return WebVersions(
            width=width,
            height=height,
            thumb=_encode(thumb),
            large=_encode(large),
            taken_at=taken_at,
        )
