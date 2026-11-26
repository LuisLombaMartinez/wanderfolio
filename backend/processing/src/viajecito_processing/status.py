"""Photo status values. Mirrors PhotoStatus in backend/internal/model; keep the two in sync."""

from enum import StrEnum


class PhotoStatus(StrEnum):
    AWAITING_UPLOAD = "awaiting-upload"
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"


class Outcome(StrEnum):
    """What a closing step reports: the Photo's new status, or that it was gone/not ours."""

    READY = PhotoStatus.READY.value
    FAILED = PhotoStatus.FAILED.value
    GONE = "gone"
