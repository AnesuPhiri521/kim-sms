from typing import Generic, TypeVar

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from app.core.list_params import CommonListParams
from app.db.base import Base

ModelT = TypeVar("ModelT", bound=Base)


class BaseRepository(Generic[ModelT]):
    """Generic list/get/create/update/soft-delete repository — doc 02
    code-reuse. A module's repository subclasses this and only adds what's
    genuinely different; pagination/filtering/soft-delete are never
    reimplemented per module.
    """

    model: type[ModelT]

    def __init__(self, db: Session) -> None:
        self.db = db

    def base_query(self) -> Select:
        """Override to add default filters (e.g. exclude inactive rows)."""
        return select(self.model)

    def apply_sort(self, query: Select, sort: str | None) -> Select:
        if not sort:
            return query
        descending = sort.startswith("-")
        column_name = sort[1:] if descending else sort
        column = getattr(self.model, column_name, None)
        if column is None:
            return query
        return query.order_by(column.desc() if descending else column.asc())

    def list(self, params: CommonListParams, query: Select | None = None) -> tuple[list[ModelT], int]:
        base = query if query is not None else self.base_query()
        total = self.db.scalar(select(func.count()).select_from(base.subquery())) or 0
        sorted_query = self.apply_sort(base, params.sort)
        rows = self.db.scalars(sorted_query.offset(params.offset).limit(params.page_size)).all()
        return list(rows), total

    def get(self, id: str) -> ModelT | None:
        return self.db.get(self.model, id)

    def create(self, obj: ModelT) -> ModelT:
        self.db.add(obj)
        self.db.flush()
        return obj

    def update(self, obj: ModelT, changes: dict) -> ModelT:
        for key, value in changes.items():
            setattr(obj, key, value)
        self.db.flush()
        return obj

    def soft_delete(self, obj: ModelT) -> ModelT:
        obj.is_active = False  # type: ignore[attr-defined]
        self.db.flush()
        return obj
