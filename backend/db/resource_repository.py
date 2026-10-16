"""Repository: all MongoDB operations for resource_records.

No business logic here — only data access.
"""

from datetime import datetime
from typing import Optional

from bson import ObjectId
from pymongo.collection import Collection
from pymongo.errors import PyMongoError

from backend.db.mongo import RESOURCE_RECORDS, get_db
from backend.schemas.resource import ResourceRecordIn, ResourceRecordOut


def _collection() -> Collection:
    return get_db()[RESOURCE_RECORDS]


def _ensure_indexes() -> None:
    """Create indexes on first use; idempotent."""
    col = _collection()
    col.create_index("workload_id")
    col.create_index("timestamp")


def _doc_to_out(doc: dict) -> ResourceRecordOut:
    return ResourceRecordOut(
        id=str(doc["_id"]),
        workload_id=doc["workload_id"],
        timestamp=doc["timestamp"],
        cpu_utilization=doc["cpu_utilization"],
        memory_utilization=doc["memory_utilization"],
        duration_seconds=doc["duration_seconds"],
        latency_p99_ms=doc.get("latency_p99_ms"),
        created_at=doc["created_at"],
    )


def insert_record(record: ResourceRecordIn) -> ResourceRecordOut:
    """Insert one resource record and return the stored document."""
    try:
        _ensure_indexes()
        doc = record.model_dump()
        doc["created_at"] = datetime.utcnow()
        result = _collection().insert_one(doc)
    except PyMongoError as exc:
        raise RuntimeError("Database write failed.") from exc
    doc["_id"] = result.inserted_id
    return _doc_to_out(doc)


def insert_records(records: list[ResourceRecordIn]) -> list[ResourceRecordOut]:
    """Insert multiple resource records in a batch and return stored documents."""
    if not records:
        return []
    try:
        _ensure_indexes()
        now = datetime.utcnow()
        docs = []
        for r in records:
            d = r.model_dump()
            d["created_at"] = now
            docs.append(d)
        result = _collection().insert_many(docs)
    except PyMongoError as exc:
        raise RuntimeError("Database batch write failed.") from exc
    for doc, inserted_id in zip(docs, result.inserted_ids):
        doc["_id"] = inserted_id
    return [_doc_to_out(d) for d in docs]


def fetch_records(
    page: int,
    page_size: int,
    from_dt: Optional[datetime],
    to_dt: Optional[datetime],
) -> tuple[list[ResourceRecordOut], int]:
    """Return (records, total_count) for the given page and optional date range."""
    query: dict = {}
    if from_dt or to_dt:
        ts_filter: dict = {}
        if from_dt:
            ts_filter["$gte"] = from_dt
        if to_dt:
            ts_filter["$lte"] = to_dt
        query["timestamp"] = ts_filter

    try:
        col = _collection()
        total = col.count_documents(query)
        skip = (page - 1) * page_size
        cursor = col.find(query).sort("timestamp", -1).skip(skip).limit(page_size)
        records = [_doc_to_out(doc) for doc in cursor]
    except PyMongoError as exc:
        raise RuntimeError("Database read failed.") from exc

    return records, total
