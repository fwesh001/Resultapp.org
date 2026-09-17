"""
Phase 2 models — Dynamic Grading Engine (PostgreSQL JSONB)

- tenant_id = subdomain string (index) — parity with middleware.ts & services/db_manager
- academic_structure / behavioral_structure = JSONB (flexible 40/60 vs 30/70, nested dicts)
- scores / ratings = JSONB
- Unique (tenant_id, student_id, subject, term) prevents duplicate grading entries
"""

from datetime import datetime
from sqlalchemy import String, Integer, Float, DateTime, ForeignKey, Index, func, JSON
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base

# Use generic JSON with postgresql JSONB variant so SQLite tests still compile
# Prompt requires JSONB columns — in production (postgresql) this renders as JSONB
JSONB_COMPAT = JSON().with_variant(JSONB, "postgresql")


class GradingTemplate(Base):
    """
    Per-tenant grading rulebook.

    Example academic_structure (40/60 split, nested max scores):
    {
      "components": [
        {"name": "CA", "weight": 40, "items": [
          {"name": "Assignment 1", "max_score": 10},
          {"name": "Test 1", "max_score": 30}
        ]},
        {"name": "Exam", "weight": 60, "max_score": 60}
      ]
    }

    Alternative flattened (also supported by weighted helper):
    {
      "categories": {"CA": 40, "Exam": 60},
      "max_scores": {"Assignment 1": 10, "Test 1": 30, "Exam": 60}
    }

    behavioral_structure example:
    {
      "traits": ["Punctuality","Neatness","Honesty"],
      "scale": ["A","B","C","D","E"]
    }
    """

    __tablename__ = "grading_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    academic_structure: Mapped[dict] = mapped_column(JSONB_COMPAT, nullable=False)
    behavioral_structure: Mapped[dict | None] = mapped_column(JSONB_COMPAT, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # One template → many records
    academic_records: Mapped[list["StudentAcademicRecord"]] = relationship(
        back_populates="template", cascade="all, delete-orphan", passive_deletes=True
    )
    behavioral_records: Mapped[list["StudentBehavioralRecord"]] = relationship(
        back_populates="template", cascade="all, delete-orphan", passive_deletes=True
    )

    __table_args__ = (
        Index("ix_grading_templates_tenant_name", "tenant_id", "name", unique=True),
    )


class StudentAcademicRecord(Base):
    __tablename__ = "student_academic_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    student_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    subject: Mapped[str] = mapped_column(String(120), nullable=False)
    term: Mapped[str] = mapped_column(String(64), nullable=False)
    template_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("grading_templates.id", ondelete="CASCADE"), nullable=False, index=True
    )
    scores: Mapped[dict] = mapped_column(JSONB_COMPAT, nullable=False)
    total_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    template: Mapped["GradingTemplate"] = relationship(back_populates="academic_records")

    __table_args__ = (
        Index(
            "uq_academic_tenant_student_subject_term",
            "tenant_id",
            "student_id",
            "subject",
            "term",
            unique=True,
        ),
    )


class StudentBehavioralRecord(Base):
    __tablename__ = "student_behavioral_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    student_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    term: Mapped[str] = mapped_column(String(64), nullable=False)
    template_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("grading_templates.id", ondelete="CASCADE"), nullable=False, index=True
    )
    ratings: Mapped[dict] = mapped_column(JSONB_COMPAT, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    template: Mapped["GradingTemplate"] = relationship(back_populates="behavioral_records")

    __table_args__ = (
        Index(
            "uq_behavioral_tenant_student_term",
            "tenant_id",
            "student_id",
            "term",
            unique=True,
        ),
    )
