"""DynamoDB writes for a Photo. Executable spec: backend/internal/store/photos.go."""

from collections.abc import Sequence
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from botocore.exceptions import ClientError

from .images import TAKEN_AT_FORMAT
from .keys import PhotoRef
from .status import PhotoStatus

if TYPE_CHECKING:
    from mypy_boto3_dynamodb import DynamoDBClient
    from mypy_boto3_dynamodb.type_defs import AttributeValueTypeDef


def format_taken_at(moment: datetime) -> str:
    """UTC `YYYY-MM-DDTHH:MM:SSZ`; the API sorts these as strings, so never another format."""
    return moment.astimezone(UTC).strftime(TAKEN_AT_FORMAT)


def _key(ref: PhotoRef) -> dict[str, dict[str, str]]:
    return {"pk": {"S": ref.pk}, "sk": {"S": ref.sk}}


# Same transitions as the Go store (backend/internal/store/photos.go), so a Photo never moves
# backwards: a duplicate or late write fails its condition and is a quiet no-op.
FROM_AWAITING_OR_PROCESSING = (PhotoStatus.AWAITING_UPLOAD, PhotoStatus.PROCESSING)
FROM_PROCESSING = (PhotoStatus.PROCESSING,)


def _update(
    db: "DynamoDBClient",
    table: str,
    ref: PhotoRef,
    allowed_from: Sequence[PhotoStatus],
    expression: str,
    values: "dict[str, AttributeValueTypeDef]",
) -> bool:
    """Run an UpdateItem that only applies while the Photo's status is in `allowed_from`.
    False means it did not apply: the Photo is gone or has already moved past the state this
    write needs (it cannot tell the two apart, and need not)."""
    placeholders = {f":from{i}": {"S": str(state)} for i, state in enumerate(allowed_from)}
    condition = f"#s IN ({', '.join(placeholders)})"
    try:
        db.update_item(
            TableName=table,
            Key=_key(ref),
            ConditionExpression=condition,
            UpdateExpression=expression,
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={**placeholders, **values},
        )
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return False
        raise
    return True


def mark_processing(db: "DynamoDBClient", table: str, ref: PhotoRef) -> bool:
    return _update(
        db,
        table,
        ref,
        FROM_AWAITING_OR_PROCESSING,
        "SET #s = :processing, processingSince = :now REMOVE expiresAt, failureReason",
        {
            ":processing": {"S": PhotoStatus.PROCESSING},
            ":now": {"S": format_taken_at(datetime.now(UTC))},
        },
    )


def mark_ready(
    db: "DynamoDBClient",
    table: str,
    ref: PhotoRef,
    *,
    taken_at: str,
    width: int,
    height: int,
) -> bool:
    return _update(
        db,
        table,
        ref,
        FROM_PROCESSING,
        (
            "SET #s = :s, takenAt = :taken, width = :w, height = :h, "
            "thumbKey = :thumb, largeKey = :large REMOVE expiresAt, failureReason"
        ),
        {
            ":s": {"S": PhotoStatus.READY},
            ":taken": {"S": taken_at},
            ":w": {"N": str(width)},
            ":h": {"N": str(height)},
            ":thumb": {"S": ref.thumb_key},
            ":large": {"S": ref.large_key},
        },
    )


def mark_failed(db: "DynamoDBClient", table: str, ref: PhotoRef, reason: str) -> bool:
    """Reachable from awaiting-upload and processing, never from ready or failed."""
    return _update(
        db,
        table,
        ref,
        FROM_AWAITING_OR_PROCESSING,
        "SET #s = :s, failureReason = :r REMOVE expiresAt",
        {":s": {"S": PhotoStatus.FAILED}, ":r": {"S": reason}},
    )
