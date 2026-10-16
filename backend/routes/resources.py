import io
import logging
from datetime import datetime, timezone
from typing import Optional

import pandas as pd
from fastapi import APIRouter, File, HTTPException, Query, UploadFile, status
from pydantic import ValidationError

from backend.db import resource_repository as repo
from backend.middleware import MAX_CSV_UPLOAD_BYTES
from backend.schemas.resource import (
    CsvUploadSummary,
    ResourceRecordIn,
    ResourceRecordOut,
    ResourceRecordPage,
)

router = APIRouter(tags=["Resources"])
logger = logging.getLogger(__name__)

MAX_CSV_ROWS = 10_000
MAX_CSV_ERROR_DETAILS = 100


@router.post(
    "/resources",
    response_model=ResourceRecordOut,
    status_code=status.HTTP_201_CREATED,
    summary="Submit a resource usage record.",
)
def create_record(payload: ResourceRecordIn) -> ResourceRecordOut:
    try:
        return repo.insert_record(payload)
    except RuntimeError as exc:
        logger.error("Resource write failed; storage unavailable (%s).", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Storage unavailable. Please try again later.",
        ) from None


@router.get(
    "/resources",
    response_model=ResourceRecordPage,
    summary="List resource usage records with pagination and optional date filters.",
)
def list_records(
    page: int = Query(default=1, ge=1, le=10_000, description="Page number (1-based, maximum 10,000)."),
    page_size: int = Query(default=20, ge=1, le=100, description="Records per page."),
    from_dt: Optional[datetime] = Query(default=None, description="Filter: earliest timestamp (ISO-8601)."),
    to_dt: Optional[datetime] = Query(default=None, description="Filter: latest timestamp (ISO-8601)."),
) -> ResourceRecordPage:
    if from_dt is not None and from_dt.tzinfo is None:
        from_dt = from_dt.replace(tzinfo=timezone.utc)
    if to_dt is not None and to_dt.tzinfo is None:
        to_dt = to_dt.replace(tzinfo=timezone.utc)
    if from_dt and to_dt and from_dt > to_dt:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="from_dt must not be later than to_dt.",
        )
    try:
        records, total = repo.fetch_records(page, page_size, from_dt, to_dt)
    except RuntimeError as exc:
        logger.error("Resource read failed; storage unavailable (%s).", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Storage unavailable. Please try again later.",
        ) from None
    return ResourceRecordPage(total=total, page=page, page_size=page_size, records=records)


@router.post(
    "/resources/upload-csv",
    response_model=CsvUploadSummary,
    status_code=status.HTTP_200_OK,
    summary="Upload a CSV file containing resource-usage records.",
    description=(
        "Parses, validates, and stores records in batch. Returns counts of inserted "
        "and rejected records along with row-specific validation error details. "
        "Files are limited to 5 MiB and 10,000 data rows; at most 100 row errors "
        "are listed in detail."
    ),
)
async def upload_csv(file: UploadFile = File(...)) -> CsvUploadSummary:
    if not file.filename or not file.filename.lower().endswith(".csv"):
        await file.close()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file must be a .csv file.",
        )

    try:
        content = await file.read(MAX_CSV_UPLOAD_BYTES + 1)
        if len(content) > MAX_CSV_UPLOAD_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                detail="CSV file exceeds the 5 MiB upload limit.",
            )
        df = pd.read_csv(io.BytesIO(content), nrows=MAX_CSV_ROWS + 1)
    except HTTPException:
        raise
    except (pd.errors.EmptyDataError, pd.errors.ParserError, UnicodeDecodeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to read CSV content. Check that it is a valid UTF-8 CSV file.",
        ) from None
    finally:
        await file.close()

    if len(df) > MAX_CSV_ROWS:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"CSV file exceeds the {MAX_CSV_ROWS} row limit.",
        )

    valid_records: list[ResourceRecordIn] = []
    errors: list[str] = []
    rejected_count = 0

    for idx, row in df.iterrows():
        row_num = idx + 2  # 1-indexed header + 1
        try:
            row_dict = row.dropna().to_dict()
            record = ResourceRecordIn(**row_dict)
            valid_records.append(record)
        except ValidationError as err:
            rejected_count += 1
            if len(errors) < MAX_CSV_ERROR_DETAILS:
                fields = sorted({str(issue["loc"][0]) for issue in err.errors() if issue["loc"]})
                errors.append(f"Row {row_num}: invalid value(s) for field(s): {', '.join(fields)}.")

    if valid_records:
        try:
            repo.insert_records(valid_records)
        except RuntimeError as exc:
            logger.error("CSV resource write failed; storage unavailable (%s).", type(exc).__name__)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Storage unavailable. Please try again later.",
            ) from None

    if rejected_count > len(errors):
        errors.append(
            f"{rejected_count - len(errors)} additional row error(s) omitted."
        )

    return CsvUploadSummary(
        inserted_count=len(valid_records),
        rejected_count=rejected_count,
        errors=errors,
    )
