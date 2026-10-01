"""How much of the machine one tenant may take through the public API.

**Counted per workspace, not per key**, and that is the whole decision. A
ceiling on the key would be a ceiling anybody can lift by pressing "Yangi
kalit" twice, and a limit you raise from the panel it is supposed to limit is
not a limit. The workspace is the unit that is billed, supported and reasoned
about, so it is the unit that has a budget.

The cost of that choice is real and worth stating: one noisy integration can
spend a workspace's whole allowance and its colleague's sync gets a 429. That
is the correct failure — it is one tenant's problem, visible to the people who
own both integrations, and it is the same trade
`SCRIPT_MAX_CONCURRENT_PER_WORKSPACE` makes for the sandbox. The alternative,
a per-key bucket, pushes the failure onto other tenants instead.

The rate is in `settings.base` under `api-key`.
"""

from __future__ import annotations

from rest_framework.throttling import SimpleRateThrottle

from .models import ApiKey


class ApiKeyThrottle(SimpleRateThrottle):
    scope = "api-key"

    def get_cache_key(self, request, view) -> str | None:
        key = getattr(request, "auth", None)
        if not isinstance(key, ApiKey):
            # Unreachable in practice: `HasApiKeyScope` runs first (DRF checks
            # permissions before throttles) and refuses anything else. Returning
            # None here means "do not throttle", which is the right answer for
            # a request that is about to be refused anyway — and the wrong one
            # to guess at, hence the explicit branch.
            return None
        return self.cache_format % {"scope": self.scope, "ident": key.workspace_id}


def rate_per_minute() -> int:
    """The configured ceiling as a plain number, for `GET /api/v1/me/` to state.

    Derived from the throttle rather than written out again next to it. A
    documented limit and an enforced limit that are two literals drift apart
    exactly once, quietly, and the caller who believed the documented one finds
    out through 429s it had already backed off from.
    """
    throttle = ApiKeyThrottle()
    if not throttle.num_requests or not throttle.duration:
        return 0
    return round(throttle.num_requests * 60 / throttle.duration)
