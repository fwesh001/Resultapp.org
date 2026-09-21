"""
Phase 2 Pydantic schemas — allow nested dictionaries for JSONB structures.
Nested dict example is supported via dict[str, Any].
"""

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field, ConfigDict


# ---------------------------------------------------------------------------
# GradingTemplate
# ---------------------------------------------------------------------------

class GradingTemplateCreate(BaseModel):
    tenant_id: str = Field(..., min_length=3, max_length=60, examples=["vhs"])
    name: str = Field(..., min_length=3, max_length=120, examples=["Junior Sec Standard"])
    # Nested dict: categories containing max scores, weights, etc.
    # e.g. {"components":[{"name":"CA","weight":40,"items":[{"name":"Assignment 1","max_score":10}]}]}
    academic_structure: dict[str, Any] = Field(
        ...,
        examples=[
            {
                "components": [
                    {
                        "name": "CA",
                        "weight": 40,
                        "items": [
                            {"name": "Assignment 1", "max_score": 10},
                            {"name": "Test 1", "max_score": 30},
                        ],
                    },
                    {"name": "Exam", "weight": 60, "max_score": 60},
                ]
            }
        ],
    )
    behavioral_structure: Optional[dict[str, Any]] = Field(
        default=None,
        examples=[{"traits": ["Punctuality", "Neatness"], "scale": ["A", "B", "C", "D", "E"]}],
    )
    # Class binding: empty list = applies to all classes.
    applies_to_classes: list[str] = Field(default_factory=list)
    is_active: bool = Field(default=True)


class GradingTemplateRead(GradingTemplateCreate):
    id: int
    created_at: datetime
    updated_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)


class GradingTemplateUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=3, max_length=120)
    academic_structure: Optional[dict[str, Any]] = None
    behavioral_structure: Optional[dict[str, Any]] = None
    applies_to_classes: Optional[list[str]] = None
    is_active: Optional[bool] = None


# ---------------------------------------------------------------------------
# StudentAcademicRecord
# ---------------------------------------------------------------------------

class StudentAcademicRecordCreate(BaseModel):
    tenant_id: str = Field(..., examples=["vhs"])
    student_id: str = Field(..., examples=["STU001"])
    subject: str = Field(..., examples=["Mathematics"])
    term: str = Field(..., examples=["Term 1"])
    template_id: int = Field(..., examples=[1])
    # Actual marks: {"Assignment 1": 8, "Exam": 52}
    scores: dict[str, Any] = Field(..., examples=[{"Assignment 1": 8, "Exam": 52}])


class StudentAcademicRecordRead(StudentAcademicRecordCreate):
    id: int
    total_score: Optional[float] = None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# StudentBehavioralRecord
# ---------------------------------------------------------------------------

class StudentBehavioralRecordCreate(BaseModel):
    tenant_id: str = Field(..., examples=["vhs"])
    student_id: str = Field(..., examples=["STU001"])
    term: str = Field(..., examples=["Term 1"])
    template_id: int = Field(..., examples=[1])
    # A-E letter grades per trait: {"Punctuality": "A", "Neatness": "B"}
    ratings: dict[str, str] = Field(..., examples=[{"Punctuality": "A", "Neatness": "B"}])


class StudentBehavioralRecordRead(StudentBehavioralRecordCreate):
    id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)
