from uuid import uuid4

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import CurrentUser, require_permission
from app.core.errors import AppError
from app.db.session import get_db
from app.models.academics_core import AcademicYear, SchoolClass, Section, Subject, Term
from app.schemas.academics_core import (
    AcademicYearCreate,
    AcademicYearRead,
    SchoolClassCreate,
    SchoolClassRead,
    SchoolClassUpdate,
    SectionCreate,
    SectionRead,
    SectionUpdate,
    SubjectCreate,
    SubjectRead,
    SubjectUpdate,
    TermCreate,
    TermRead,
    TermUpdate,
)
from app.services.audit_service import AuditService

router = APIRouter(prefix="/api/v1", tags=["academics-core"])

# A new academic year is pre-filled with this 3-term template as a
# convenience default matching standard Zimbabwean practice (doc 01
# "Regional context") — not an enforced rule. Admin can add, rename, or
# remove terms freely afterward (doc 05 §2).
DEFAULT_TERM_TEMPLATE = ["Term 1", "Term 2", "Term 3"]


# ---------------------------------------------------------------- years --

@router.post("/academic-years", response_model=AcademicYearRead, status_code=201)
def create_academic_year(
    payload: AcademicYearCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("academics_core:manage")),
) -> AcademicYear:
    year = AcademicYear(
        id=str(uuid4()),
        name=payload.name,
        start_date=payload.start_date,
        end_date=payload.end_date,
        created_by=current_user.id,
    )
    db.add(year)
    db.flush()

    for i, term_name in enumerate(DEFAULT_TERM_TEMPLATE, start=1):
        db.add(
            Term(
                id=str(uuid4()),
                academic_year_id=year.id,
                term_number=i,
                name=term_name,
                created_by=current_user.id,
            )
        )
    db.flush()

    AuditService(db).record(
        actor_user_id=current_user.id,
        action="create",
        entity_type="academic_years",
        entity_id=year.id,
        after={"name": year.name},
    )
    db.commit()
    db.refresh(year)
    return year


@router.get("/academic-years", response_model=list[AcademicYearRead])
def list_academic_years(
    db: Session = Depends(get_db),
    _current_user: CurrentUser = Depends(require_permission("academics_core:view")),
) -> list[AcademicYear]:
    return list(db.scalars(select(AcademicYear).order_by(AcademicYear.start_date.desc())).all())


@router.get("/academic-years/{year_id}", response_model=AcademicYearRead)
def get_academic_year(
    year_id: str,
    db: Session = Depends(get_db),
    _current_user: CurrentUser = Depends(require_permission("academics_core:view")),
) -> AcademicYear:
    year = db.get(AcademicYear, year_id)
    if year is None:
        raise AppError("NOT_FOUND", "Academic year not found.", status_code=404)
    return year


# ---------------------------------------------------------------- terms --

@router.post("/academic-years/{year_id}/terms", response_model=TermRead, status_code=201)
def add_term(
    year_id: str,
    payload: TermCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("academics_core:manage")),
) -> Term:
    year = db.get(AcademicYear, year_id)
    if year is None:
        raise AppError("NOT_FOUND", "Academic year not found.", status_code=404)

    term = Term(
        id=str(uuid4()),
        academic_year_id=year_id,
        term_number=payload.term_number,
        name=payload.name,
        start_date=payload.start_date,
        end_date=payload.end_date,
        created_by=current_user.id,
    )
    db.add(term)
    db.commit()
    db.refresh(term)
    return term


@router.patch("/terms/{term_id}", response_model=TermRead)
def update_term(
    term_id: str,
    payload: TermUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("academics_core:manage")),
) -> Term:
    term = db.get(Term, term_id)
    if term is None:
        raise AppError("NOT_FOUND", "Term not found.", status_code=404)
    changes = payload.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(term, key, value)
    db.commit()
    db.refresh(term)
    return term


@router.delete("/terms/{term_id}", status_code=204)
def delete_term(
    term_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("academics_core:manage")),
) -> None:
    term = db.get(Term, term_id)
    if term is None:
        raise AppError("NOT_FOUND", "Term not found.", status_code=404)
    # NOTE: once Phase 2+ modules exist (fee_structures, assessments, ...)
    # this must reject deletion while any of them still reference this
    # term (doc 05 §2 business rule) — nothing to check against yet.
    db.delete(term)
    db.commit()


# -------------------------------------------------------------- classes --

@router.post("/classes", response_model=SchoolClassRead, status_code=201)
def create_class(
    payload: SchoolClassCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("academics_core:manage")),
) -> SchoolClass:
    school_class = SchoolClass(
        id=str(uuid4()), name=payload.name, level_order=payload.level_order, created_by=current_user.id
    )
    db.add(school_class)
    db.commit()
    db.refresh(school_class)
    return school_class


@router.get("/classes", response_model=list[SchoolClassRead])
def list_classes(
    db: Session = Depends(get_db),
    _current_user: CurrentUser = Depends(require_permission("academics_core:view")),
) -> list[SchoolClass]:
    return list(db.scalars(select(SchoolClass).order_by(SchoolClass.level_order)).all())


@router.patch("/classes/{class_id}", response_model=SchoolClassRead)
def update_class(
    class_id: str,
    payload: SchoolClassUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("academics_core:manage")),
) -> SchoolClass:
    school_class = db.get(SchoolClass, class_id)
    if school_class is None:
        raise AppError("NOT_FOUND", "Class not found.", status_code=404)
    changes = payload.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(school_class, key, value)
    db.commit()
    db.refresh(school_class)
    return school_class


# ------------------------------------------------------------- sections --

@router.post("/classes/{class_id}/sections", response_model=SectionRead, status_code=201)
def add_section(
    class_id: str,
    payload: SectionCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("academics_core:manage")),
) -> Section:
    school_class = db.get(SchoolClass, class_id)
    if school_class is None:
        raise AppError("NOT_FOUND", "Class not found.", status_code=404)

    section = Section(
        id=str(uuid4()),
        class_id=class_id,
        name=payload.name,
        capacity=payload.capacity,
        created_by=current_user.id,
    )
    db.add(section)
    db.commit()
    db.refresh(section)
    return section


@router.patch("/sections/{section_id}", response_model=SectionRead)
def update_section(
    section_id: str,
    payload: SectionUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("academics_core:manage")),
) -> Section:
    section = db.get(Section, section_id)
    if section is None:
        raise AppError("NOT_FOUND", "Section not found.", status_code=404)
    changes = payload.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(section, key, value)
    db.commit()
    db.refresh(section)
    return section


# -------------------------------------------------------------- subjects --

@router.post("/subjects", response_model=SubjectRead, status_code=201)
def create_subject(
    payload: SubjectCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("academics_core:manage")),
) -> Subject:
    subject = Subject(
        id=str(uuid4()),
        name=payload.name,
        code=payload.code,
        is_elective=payload.is_elective,
        created_by=current_user.id,
    )
    db.add(subject)
    db.commit()
    db.refresh(subject)
    return subject


@router.get("/subjects", response_model=list[SubjectRead])
def list_subjects(
    db: Session = Depends(get_db),
    _current_user: CurrentUser = Depends(require_permission("academics_core:view")),
) -> list[Subject]:
    return list(db.scalars(select(Subject).order_by(Subject.name)).all())


@router.patch("/subjects/{subject_id}", response_model=SubjectRead)
def update_subject(
    subject_id: str,
    payload: SubjectUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("academics_core:manage")),
) -> Subject:
    subject = db.get(Subject, subject_id)
    if subject is None:
        raise AppError("NOT_FOUND", "Subject not found.", status_code=404)
    changes = payload.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(subject, key, value)
    db.commit()
    db.refresh(subject)
    return subject
