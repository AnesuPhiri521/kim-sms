from collections.abc import Callable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.identity import SystemSetting

_CASTERS: dict[str, Callable[[str], object]] = {
    "string": str,
    "integer": int,
    "boolean": lambda v: v.lower() in ("true", "1", "yes"),
    "decimal": float,
}


class SettingsService:
    """Typed reads over `system_settings` (doc 05 §1) — the concrete home
    for every 'configurable' business rule in this plan. Every module
    reads its tunable values through here instead of hardcoding them.
    """

    def __init__(self, db: Session) -> None:
        self.db = db

    def get_raw(self, key: str) -> SystemSetting | None:
        return self.db.scalar(select(SystemSetting).where(SystemSetting.key == key))

    def get(self, key: str, default: str | bool | float | None = None):
        row = self.get_raw(key)
        if row is None:
            return default
        caster = _CASTERS.get(row.value_type, str)
        return caster(row.value)

    def set(self, key: str, value: str, updated_by: str | None = None) -> SystemSetting:
        row = self.get_raw(key)
        if row is None:
            raise KeyError(f"Unknown system_settings key: {key}")
        row.value = value
        row.updated_by = updated_by
        self.db.flush()
        return row
