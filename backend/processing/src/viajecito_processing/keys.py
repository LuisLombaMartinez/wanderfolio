"""Bucket key layout, shared with the Go API (backend/internal/store/photos.go)."""

import re
from dataclasses import dataclass

_ORIGINAL = re.compile(r"originals/([0-9a-f]{32})/([0-9a-f]{32})")


@dataclass(frozen=True)
class PhotoRef:
    trip_id: str
    photo_id: str

    @property
    def pk(self) -> str:
        return f"TRIP#{self.trip_id}"

    @property
    def sk(self) -> str:
        return f"PHOTO#{self.photo_id}"

    @property
    def thumb_key(self) -> str:
        return f"media/{self.trip_id}/{self.photo_id}/thumb.webp"

    @property
    def large_key(self) -> str:
        return f"media/{self.trip_id}/{self.photo_id}/large.webp"


def parse_original_key(key: str) -> PhotoRef | None:
    """Return the Photo an `originals/<tripId>/<photoId>` key belongs to, or None."""
    match = _ORIGINAL.fullmatch(key)
    if match is None:
        return None
    return PhotoRef(trip_id=match.group(1), photo_id=match.group(2))
