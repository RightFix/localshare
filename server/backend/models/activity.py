"""Activity models for LocalShare."""

from datetime import datetime

from pydantic import BaseModel, Field


class UploadRecord(BaseModel):
    """Record of an uploaded file."""

    filename: str = Field(description="Name of the uploaded file")
    size: int = Field(description="File size in bytes")
    from_device: str = Field(default="", description="Device that uploaded the file")
    at: datetime = Field(
        default_factory=datetime.now,
        description="When the upload occurred",
    )

    model_config = {"frozen": False}


class DownloadRecord(BaseModel):
    """Record of a downloaded file."""

    filename: str = Field(description="Name of the downloaded file")
    size: int = Field(description="File size in bytes")
    to_device: str = Field(default="", description="Device that downloaded the file")
    at: datetime = Field(
        default_factory=datetime.now,
        description="When the download occurred",
    )

    model_config = {"frozen": False}


class ActivityData(BaseModel):
    """Container for upload and download history."""

    uploads: list[UploadRecord] = Field(
        default_factory=list,
        description="Upload history",
    )
    downloads: list[DownloadRecord] = Field(
        default_factory=list,
        description="Download history",
    )

    def add_upload(self, filename: str, size: int, from_device: str = "") -> UploadRecord:
        """Record a new upload."""
        record = UploadRecord(filename=filename, size=size, from_device=from_device)
        self.uploads.insert(0, record)
        return record

    def add_download(self, filename: str, size: int, to_device: str = "") -> DownloadRecord:
        """Record a new download."""
        record = DownloadRecord(filename=filename, size=size, to_device=to_device)
        self.downloads.insert(0, record)
        return record

    def get_recent_uploads(self, limit: int = 10) -> list[UploadRecord]:
        """Get the most recent uploads."""
        return self.uploads[:limit]

    def get_recent_downloads(self, limit: int = 10) -> list[DownloadRecord]:
        """Get the most recent downloads."""
        return self.downloads[:limit]

    def clear(self) -> None:
        """Clear all activity records."""
        self.uploads.clear()
        self.downloads.clear()
