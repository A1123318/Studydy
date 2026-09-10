from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
import re
from typing import Any

from .ocr_page_evidence import MAX_PNG_BYTES, canonical_sha256


# Qualification ceiling, independent of the tokenizer's multimodal accounting.
MAX_VISUAL_PAGES = 3


def validate_visual_reference(
    reference: Any, *, material_id: str, evidence_pages: set[int]
) -> bool:
    """Validate metadata at the runtime/artifact boundary, without image data."""
    if (
        not isinstance(material_id, str)
        or re.fullmatch(r"material:sha256:[0-9a-f]{64}", material_id) is None
        or not isinstance(reference, dict)
        or set(reference) != {"material_id", "page", "page_ref", "render_sha256"}
        or reference["material_id"] != material_id
        or type(reference["page"]) is not int
        or reference["page"] not in evidence_pages
        or not isinstance(reference["render_sha256"], str)
        or re.fullmatch(r"[0-9a-f]{64}", reference["render_sha256"]) is None
    ):
        return False
    identity = {
        "source_sha256": material_id.removeprefix("material:sha256:"),
        "page_number": reference["page"],
    }
    return reference["page_ref"] == f"page:sha256:{canonical_sha256(identity)}"


@dataclass(frozen=True)
class VisualPage:
    """Ephemeral input: only reference metadata belongs in persisted artifacts."""

    reference: dict[str, Any]
    png_bytes: bytes = field(repr=False)

    def matches_render(self) -> bool:
        return (
            isinstance(self.png_bytes, bytes)
            and 0 < len(self.png_bytes) <= MAX_PNG_BYTES
            and self.png_bytes.startswith(b"\x89PNG\r\n\x1a\n")
            and hashlib.sha256(self.png_bytes).hexdigest()
            == self.reference.get("render_sha256")
        )
