"""List pagination.

`?limit=`/`?offset=` rather than page numbers: the interface's tables load more
rows onto the end of what they already have, which a page number cannot express
once a row has been inserted above.
"""

from __future__ import annotations

from rest_framework.pagination import LimitOffsetPagination


class DefaultPagination(LimitOffsetPagination):
    default_limit = 50
    max_limit = 500
