from dataclasses import dataclass

from fastapi import Query


@dataclass
class CommonListParams:
    """Shared pagination/sort params — doc 02/06 code-reuse. Every list
    endpoint depends on this instead of redeclaring page/page_size/sort.
    """

    page: int = 1
    page_size: int = 25
    sort: str | None = None

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size


def common_list_params(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    sort: str | None = Query(None, description="Column name, prefix '-' for descending"),
) -> CommonListParams:
    return CommonListParams(page=page, page_size=page_size, sort=sort)
