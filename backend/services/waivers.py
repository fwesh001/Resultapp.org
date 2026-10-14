"""
Superadmin waiver tokens — single-use, slot-bounded discounts.

A token is a superadmin-issued bearer code with two numbers attached:

    discount_percentage   1..100  how much off the list price
    slot_allowance        1..10000 how many slots that discount may cover

It applies to INITIAL REGISTRATION and to POST-REGISTRATION SLOT TOP-UPS, and
nothing else. Publishing credits are unaffected — a school that cannot afford
more seats is a different problem from one that cannot afford report cards.


THE ONE RULE THAT SHAPES THIS FILE
----------------------------------
A token is NOT consumed when it is validated. It is consumed only inside the
transaction that also grants the slots.

Validation happens in the browser, before checkout. Consumption happens on the
server, after checkout. If those were the same moment, an abandoned tab would
burn a real entitlement for nothing — and a school whose tab crashed at exactly
the wrong moment would be told to buy again.


WHY THERE IS A RESERVATION PHASE
--------------------------------
A single compare-and-swap at charge time is not enough. Two tabs, one token:

    tab A  validate -> ok      tab B  validate -> ok
    tab A  pay ₦20,000          tab B  pay ₦20,000
    tab A  burn -> wins         tab B  burn -> 409, has no entitlement

Tab B is already charged. That is a refund queue and an apology email.

So the lifecycle is three-state, and the reservation happens BEFORE checkout
opens:

    open --reserve(tx_ref)--> reserved --consume--> consumed
      |                           |
      +--void--> voided           +--release / sweeper--> open

`reserved` carries the `reservation_tx_ref` that will redeem it, so a
consume is only ever valid for the reservation that owns it. A sweeper returns
lapsed reservations to `open` so a closed tab cannot hold a token hostage for
more than RESERVATION_TTL_SECONDS.


WHY THE MATH LIVES HERE AND NOT IN TYPESCRIPT
----------------------------------------------
Every other amount in this system is computed in the Next.js tier and trusted
here — see `SlotTopUpRequest.amount_ngn` and `ProvisionRequest.amount_ngn`,
both of which are recorded verbatim without verification. That is survivable
when the only number moving is a price the customer chose.

It is not survivable once a discount is involved: a proxy that claimed a 100%
waiver on a 10,000-slot order would be believed. So `compute_waiver_split()` in
this file is the implementation of record, and `lib/waiverPricing.ts` is a
display-only mirror. `scripts/verify-waiver-math.mjs` fails the build if they
ever disagree.

Note that floor division is load-bearing, not a style choice. `waived_ngn` is
floored so that `charged_ngn = list_ngn - waived_ngn` can never go negative for
an odd percentage on a small order.


TOKEN STORAGE
-------------
The plaintext code is shown to the superadmin exactly once and never stored.
What is stored is a SHA-256 hash, a short prefix for lookup, and a fingerprint
for the audit table — the same shape as `schools.verify_token_hash`. A token is
a bearer credential with cash value; a readable `token_string` column would put
every one of them in every database backup.
"""

import hashlib
import hmac
import logging
import secrets
from typing import Any, Dict, Optional, Tuple

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

#: How long a reservation holds a token before the sweeper releases it. Short
#: on purpose: it only has to outlive an open checkout modal, and a shorter TTL
#: means a closed tab wastes less of the token's life.
RESERVATION_TTL_SECONDS = 900  # 15 minutes

#: Default token lifetime when the superadmin does not say.
DEFAULT_TOKEN_TTL_DAYS = 30

#: Entropy for the code itself. token_urlsafe(18) is 18 random bytes = 144 bits,
#: rendered as 24 unambiguous characters. Comfortably past the 128-bit floor.
TOKEN_BYTES = 18

#: Recognisable prefix, so a leaked code is attributable to this platform at a
#: glance and the superadmin never pastes the wrong thing into a field.
TOKEN_TAG = "RW"

#: Valid `applies_to` values. BOTH means registration or top-up, not both in
#: the same transaction.
APPLIES_TO_VALUES = ("REGISTRATION", "TOPUP", "BOTH")

#: Valid lifecycle states. See the module docstring for the graph.
STATUS_VALUES = ("open", "reserved", "consumed", "voided", "expired")

#: Global kill switch, mirrored from app_settings. When off, peek/reserve refuse
#: and checkout silently falls back to the full-price path.
WAIVER_ENABLED_KEY = "waiver_tokens_enabled"

# --- Slot bounds -----------------------------------------------------------
#
# Mirrors MIN_REGISTRATION_STUDENTS in lib/pricing.ts, which the wizard, the
# Next proxy and the FastAPI Pydantic model each enforce independently. Kept in
# step by scripts/verify-auth-flow.mjs.
MIN_REGISTRATION_SLOTS = 10
#: Top-ups deliberately have NO registration floor — buying one extra seat
#: mid-term is a normal operation.
MIN_TOPUP_SLOTS = 1
MAX_SLOTS = 10000

# --- Pricing ---------------------------------------------------------------
#
# Mirrors getPricingTier() in lib/pricing.ts. Volume tiers are a commercial
# line, not a formality: they change what a waiver is worth by up to 25%, which
# is why the superadmin preview shows the NGN value before issuance.
TIER_1_MAX_STUDENTS = 499
TIER_1_PRICE_PER_SLOT = 100
TIER_2_MIN_STUDENTS = 500
TIER_2_MAX_STUDENTS = 999
TIER_2_PRICE_PER_SLOT = 90
TIER_3_MIN_STUDENTS = 1000
TIER_3_PRICE_PER_SLOT = 80


class WaiverValidationError(ValueError):
    """Caller-supplied waiver terms are outside the permitted envelope."""


# ---------------------------------------------------------------------------
# Pure math — no database, no psycopg2
#
# Kept import-light on purpose: scripts/verify-waiver-math.mjs imports this
# module directly to diff it against lib/waiverPricing.ts, and it must not need
# a database driver to do that.
# ---------------------------------------------------------------------------


def _as_int(value: Any, field: str) -> int:
    """Strict integer coercion. Booleans are rejected: True is not 1 here."""
    if isinstance(value, bool):
        raise WaiverValidationError(f"{field} must be an integer, not a boolean")
    try:
        # Reject 10.5 and "10.5" without also rejecting "10" or 10.0.
        coerced = int(value)
    except (TypeError, ValueError):
        raise WaiverValidationError(f"{field} must be an integer") from None
    if isinstance(value, float) and value != coerced:
        raise WaiverValidationError(f"{field} must be a whole number")
    return coerced


def tier_price_per_slot(student_count: int) -> int:
    """NGN per slot for the given count. Mirrors getPricingTier().

    The tier is selected by the count the customer is BUYING, including the
    part a waiver covers. That is the decision recorded in the design: a school
    that buys 1000 slots is a 1000-slot school commercially, and shaving the
    waived portion out of the tier would quietly charge them 20%-tier pricing
    on slots they are paying full price for.
    """
    n = _as_int(student_count, "student_count")
    if n <= 0:
        raise WaiverValidationError("student_count must be positive")
    if n >= TIER_3_MIN_STUDENTS:
        return TIER_3_PRICE_PER_SLOT
    if n >= TIER_2_MIN_STUDENTS:
        return TIER_2_PRICE_PER_SLOT
    if n <= TIER_1_MAX_STUDENTS:
        return TIER_1_PRICE_PER_SLOT
    # Unreachable given the boundaries above; kept so a future tier edit that
    # opens a gap fails loudly here instead of silently mispricing.
    raise WaiverValidationError(f"no pricing tier covers {n} slots")


def compute_waiver_split(
    requested_slots: int,
    slot_allowance: int,
    discount_percentage: int,
) -> Dict[str, Any]:
    """Separate a slot purchase into its waived and charged portions.

    This is the authoritative billing rule for the whole feature. Both the
    registration and the top-up path call it; neither reimplements it.

        unit_price   tier of the REQUESTED count (see tier_price_per_slot)
        waived_slots    min(slot_allowance, requested_slots)
        charged_slots   requested_slots - waived_slots
        forfeited_slots slot_allowance - waived_slots   ("use it or lose it")
        waived_ngn      floor(waived_slots * unit_price * pct / 100)
        charged_ngn     list_ngn - waived_ngn
        bypass_gateway  charged_ngn == 0

    `bypass_gateway` is the 100% signal. Flutterwave rejects a zero-value
    transaction, so when it is True the caller must skip the gateway entirely
    rather than hand it ₦0.
    """
    requested = _as_int(requested_slots, "requested_slots")
    allowance = _as_int(slot_allowance, "slot_allowance")
    pct = _as_int(discount_percentage, "discount_percentage")

    if not (MIN_TOPUP_SLOTS <= requested <= MAX_SLOTS):
        raise WaiverValidationError(
            f"requested_slots must be {MIN_TOPUP_SLOTS}-{MAX_SLOTS}, got {requested}"
        )
    if not (1 <= allowance <= MAX_SLOTS):
        raise WaiverValidationError(f"slot_allowance must be 1-{MAX_SLOTS}, got {allowance}")
    if not (1 <= pct <= 100):
        raise WaiverValidationError(f"discount_percentage must be 1-100, got {pct}")

    unit_price = tier_price_per_slot(requested)
    list_ngn = requested * unit_price

    waived_slots = min(allowance, requested)
    charged_slots = requested - waived_slots
    forfeited_slots = allowance - waived_slots

    # Floor, not round. Rounding up would push charged_ngn below zero for an odd
    # percentage on a small order, and a negative charge is worse than a naira.
    waived_ngn = (waived_slots * unit_price * pct) // 100
    charged_ngn = list_ngn - waived_ngn

    # Defensive: the floor above guarantees this, but the one invariant the
    # 100% bypass rests on deserves an assertion rather than a comment.
    if charged_ngn < 0:  # pragma: no cover - unreachable by construction
        raise WaiverValidationError(
            f"negative charge computed: list {list_ngn} - waived {waived_ngn}"
        )

    return {
        "requested_slots": requested,
        "slot_allowance": allowance,
        "discount_percentage": pct,
        "waived_slots": waived_slots,
        "charged_slots": charged_slots,
        "forfeited_slots": forfeited_slots,
        "unit_price_ngn": unit_price,
        "list_ngn": list_ngn,
        "waived_ngn": waived_ngn,
        "charged_ngn": charged_ngn,
        "bypass_gateway": charged_ngn == 0,
    }


def allowance_bounds(applies_to: str) -> Tuple[int, int]:
    """Legal (min, max) slot_allowance for a token's intended scope.

    THE FLOOR COLLISION. A 5-slot token is perfectly valid for a top-up and
    unusable for a registration, because registration has a 10-slot floor that
    the user cannot opt out of. The superadmin form has to narrow the field or
    it will happily mint a code that fails validation at checkout — after the
    customer has entered their card details.
    """
    scope = (applies_to or "").strip().upper()
    if scope not in APPLIES_TO_VALUES:
        raise WaiverValidationError(
            f"applies_to must be one of {', '.join(APPLIES_TO_VALUES)}"
        )
    floor = MIN_REGISTRATION_SLOTS if scope in ("REGISTRATION", "BOTH") else MIN_TOPUP_SLOTS
    return floor, MAX_SLOTS


# ---------------------------------------------------------------------------
# Credential helpers
# ---------------------------------------------------------------------------


def generate_token_string() -> str:
    """Mint a fresh code. The ONLY place the plaintext ever exists."""
    return f"{TOKEN_TAG}-{secrets.token_urlsafe(TOKEN_BYTES)}"


def hash_token(token_string: str) -> str:
    """SHA-256 hex of a code. What the database stores."""
    return hashlib.sha256(token_string.strip().encode("utf-8")).hexdigest()


def token_prefix(token_string: str) -> str:
    """First 8 characters — the lookup key for validate-by-code."""
    return token_string.strip()[:8]


def token_fingerprint(token_string: str) -> str:
    """Last 6 characters — enough to recognise a code in the audit table,
    useless for redeeming it."""
    return token_string.strip()[-6:]


# ---------------------------------------------------------------------------
# Database helpers
#
# Everything below imports db_manager lazily, inside the function. The house
# pattern (db_manager, credits.py, admin.py all do this) exists because the
# routers and the service layer import each other; the top of this file is
# deliberately dependency-free so the math stays testable standalone.
# ---------------------------------------------------------------------------


def _table() -> str:
    from services.db_manager import WAIVER_TOKENS_TABLE

    return WAIVER_TOKENS_TABLE


def reservation_match_sql() -> str:
    """The single definition of "this caller owns this reservation".

    Shared by `consume_token`, the quote endpoint and the release path so those
    three can never disagree about ownership. Duplicating this predicate three
    times is how a burn ends up accepting a reference that a quote would refuse.

    Built lazily rather than as a module constant for the same reason
    `_table()` is a function: a top-level `from services.db_manager import ...`
    would drag psycopg2 into this module and break the standalone import that
    scripts/verify-waiver-math.mjs depends on.
    """
    return f"""
        SELECT id, discount_percentage, slot_allowance
        FROM {_table()}
        WHERE id = %s AND status = 'reserved' AND reservation_tx_ref = %s
    """


def waivers_enabled() -> bool:
    """Global kill switch. Defaults True so a missing seed never silently
    disables a feature the superadmin believes is live."""
    from services.db_manager import _get_setting_bool

    return _get_setting_bool(WAIVER_ENABLED_KEY, True)


def mint_token(
    discount_percentage: int,
    slot_allowance: int,
    applies_to: str = "BOTH",
    locked_to_tenant: Optional[str] = None,
    restores_suspension: bool = False,
    created_by: str = "superadmin",
    note: Optional[str] = None,
    ttl_days: int = DEFAULT_TOKEN_TTL_DAYS,
) -> Dict[str, Any]:
    """Create a token and return it. The plaintext is in the response ONCE.

    Raises WaiverValidationError for terms outside the envelope. It does NOT
    consult `locked_to_tenant` for existence — the foreign key does that, and
    reporting "tenant not found" here would leak which subdomains are real to
    anyone holding the shared API secret.
    """
    from services.db_manager import _connect_as_superuser, log_admin_action

    pct = _as_int(discount_percentage, "discount_percentage")
    allowance = _as_int(slot_allowance, "slot_allowance")
    scope = (applies_to or "BOTH").strip().upper()

    if not (1 <= pct <= 100):
        raise WaiverValidationError(f"discount_percentage must be 1-100, got {pct}")
    floor, ceiling = allowance_bounds(scope)
    if not (floor <= allowance <= ceiling):
        raise WaiverValidationError(
            f"slot_allowance must be {floor}-{ceiling} for a {scope} token, got {allowance}"
        )

    days = max(1, min(int(ttl_days or DEFAULT_TOKEN_TTL_DAYS), 365))

    tenant = (locked_to_tenant or "").strip().lower() or None
    if tenant:
        from main import SUBDOMAIN_RE

        if not SUBDOMAIN_RE.match(tenant):
            raise WaiverValidationError(f"Invalid subdomain '{tenant}'")

    plaintext = generate_token_string()
    digest = hash_token(plaintext)

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        cur.execute(
            f"""
            INSERT INTO {_table()}
                (token_hash, token_prefix, token_fingerprint,
                 discount_percentage, slot_allowance, applies_to,
                 locked_to_tenant, restores_suspension,
                 expires_at, created_by, note)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s,
                    NOW() + (%s || ' days')::interval, %s, %s)
            RETURNING id, expires_at, created_at;
            """,
            (
                digest,
                token_prefix(plaintext),
                token_fingerprint(plaintext),
                pct,
                allowance,
                scope,
                tenant,
                bool(restores_suspension),
                str(days),
                str(created_by or "superadmin")[:120],
                (note or None),
            ),
        )
        row = cur.fetchone()
        conn.commit()
        if row is None:
            raise WaiverValidationError("Token could not be created")
        token_id, expires_at, created_at = row

        log_admin_action(
            "waiver.token.create",
            subdomain=tenant,
            details={
                "token_id": token_id,
                "fingerprint": token_fingerprint(plaintext),
                "discount_percentage": pct,
                "slot_allowance": allowance,
                "applies_to": scope,
                "ttl_days": days,
                "notional_ngn": _notional_value(allowance, pct),
            },
            actor=str(created_by or "superadmin"),
        )
        logger.info(
            f"[waiver] minted token #{token_id} ({pct}% / {allowance} slots / {scope}) "
            f"by '{created_by}'"
        )
        return {
            "id": token_id,
            "token_string": plaintext,  # ONCE. Never stored, never recoverable.
            "token_prefix": token_prefix(plaintext),
            "token_fingerprint": token_fingerprint(plaintext),
            "discount_percentage": pct,
            "slot_allowance": allowance,
            "applies_to": scope,
            "locked_to_tenant": tenant,
            "restores_suspension": bool(restores_suspension),
            "expires_at": expires_at,
            "created_at": created_at,
            "created_by": created_by,
            "notional_ngn": _notional_value(allowance, pct),
        }
    except WaiverValidationError:
        raise
    except Exception as e:
        if conn:
            try:
                conn.rollback()
            except Exception:
                pass
        logger.exception(f"[waiver] mint failed: {e}")
        raise WaiverValidationError(f"Token could not be created: {e}")
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


def _notional_value(slot_allowance: int, discount_percentage: int) -> int:
    """What the token is worth in NGN, at the tier its allowance lands in.

    Shown in the superadmin form before issuance. A 50% token over 1000 slots
    is ₦40,000 of forgone revenue and one over 999 is ₦44,955, because the
    tier boundary sits between them. Issuance should be an informed act.
    """
    try:
        unit = tier_price_per_slot(slot_allowance)
    except WaiverValidationError:
        return 0
    return (slot_allowance * unit * _as_int(discount_percentage, "discount_percentage")) // 100


def peek_token(token_string: str) -> Dict[str, Any]:
    """Read a token's terms WITHOUT consuming or reserving anything.

    Strictly non-mutating. This is what the checkout preview calls, and it must
    stay that way: a preview that reserved a token would burn a school's
    entitlement every time they retyped the code.

    Raises WaiverValidationError with a GENERIC message for every failure —
    unknown, expired, voided, wrong scope, wrong tenant, feature switched off.
    Distinguishing them would turn a public endpoint into an oracle for testing
    whether a guessed code ever existed.
    """
    from services.db_manager import _connect_as_superuser

    generic = WaiverValidationError("Invalid or expired waiver code")

    if not waivers_enabled():
        raise generic

    raw = (token_string or "").strip()
    if not raw:
        raise generic

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        # Lookup by hash, compared with hmac.compare_digest on the way out of
        # the driver. The index does the work; the constant-time compare is
        # defence in depth against a timing oracle on the unique index.
        cur.execute(
            f"""
            SELECT id, token_hash, discount_percentage, slot_allowance, applies_to,
                   locked_to_tenant, status, expires_at
            FROM {_table()}
            WHERE token_hash = %s
            """,
            (hash_token(raw),),
        )
        row = cur.fetchone()
        if row is None:
            raise generic
        # Strip before comparing. token_hash is CHAR(64), and PostgreSQL
        # blank-pads CHAR — a SHA-256 hex digest fills it exactly today, but if
        # the column is ever widened every single code would fail the compare
        # and every school would be told their valid token was invalid.
        if not hmac.compare_digest(str(row[1]).strip(), hash_token(raw)):
            raise generic

        (
            token_id,
            _digest,
            pct,
            allowance,
            applies_to,
            locked_to_tenant,
            status,
            expires_at,
        ) = row

        # A reservation is a live claim on the token, not a usable one. Say so
        # precisely: "in use" is a materially different message from "expired"
        # and telling them apart costs nothing to the attacker here, because a
        # guess that misses returns the same generic error either way.
        if status == "consumed":
            raise WaiverValidationError("This waiver code has already been used")
        if status == "voided":
            raise WaiverValidationError("This waiver code has been cancelled")
        if status == "reserved":
            raise WaiverValidationError("This waiver code is already in use")
        if status != "open":
            raise WaiverValidationError("This waiver code is no longer valid")
        if expires_at is None:
            raise generic

        return {
            "id": token_id,
            "discount_percentage": int(pct),
            "slot_allowance": int(allowance),
            "applies_to": str(applies_to or "BOTH").upper(),
            "locked_to_tenant": locked_to_tenant,
            "expires_at": expires_at,
            "notional_ngn": _notional_value(int(allowance), int(pct)),
        }
    except WaiverValidationError:
        raise
    except Exception as e:
        logger.warning(f"[waiver] peek failed: {e}")
        raise generic
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


def reserve_token(
    token_string: str,
    tx_ref: str,
    applies_to: str = "BOTH",
    tenant_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Claim a token for a specific checkout. open -> reserved.

    This is the compare-and-swap that makes a token safe to hand to a stranger
    over the phone. Under READ COMMITTED two concurrent reserves serialise on
    the row lock: the second re-evaluates the predicate after the first
    commits, finds status='reserved', matches zero rows, and gets
    WaiverValidationError. Exactly one caller proceeds to checkout.

    `tx_ref` is recorded and becomes the ONLY thing that can later consume the
    token. That is what makes the release path safe: a cancelled checkout
    cannot release somebody else's reservation, and a late callback cannot
    redeem one that was already returned to the pool.
    """
    # A REAL transaction, not the autocommit connection.
    #
    # This reads the row to check scope/tenant/status and then updates it, and
    # that pair has to be one atomic unit. On the autocommit connection
    # `_connect_as_superuser()` returns, `SELECT ... FOR UPDATE` releases its
    # row lock the instant the statement ends — so a second thread could
    # reserve the token in the gap, and this caller would then run its scope and
    # tenant checks against a row that is no longer the one it locked. The
    # UPDATE's own predicate would still refuse the write, so nothing unsafe
    # would ship, but the loser would get a generic "already in use" instead of
    # the precise reason, and the FOR UPDATE would be decoration.
    from services.db_manager import _connect_as_superuser_transactional

    generic = WaiverValidationError("Invalid or expired waiver code")
    if not waivers_enabled():
        raise generic

    raw = (token_string or "").strip()
    ref = (tx_ref or "").strip()
    if not raw:
        raise generic
    if not ref or len(ref) > 128:
        raise WaiverValidationError("A checkout reference is required to reserve a waiver")

    scope = (applies_to or "BOTH").strip().upper()
    if scope not in APPLIES_TO_VALUES:
        raise WaiverValidationError(f"applies_to must be one of {', '.join(APPLIES_TO_VALUES)}")

    tenant = (tenant_id or "").strip().lower() or None

    conn = None
    try:
        conn = _connect_as_superuser_transactional()
        cur = conn.cursor()

        # Read for the scope/tenant checks, which are not expressible in the
        # CAS predicate without turning the UPDATE into an opaque blob.
        cur.execute(
            f"""
            SELECT id, discount_percentage, slot_allowance, applies_to,
                   locked_to_tenant, status, expires_at
            FROM {_table()}
            WHERE token_hash = %s
            FOR UPDATE;
            """,
            (hash_token(raw),),
        )
        row = cur.fetchone()
        if row is None:
            raise generic
        token_id, pct, allowance, token_scope, locked_to_tenant, status, expires_at = row

        if status != "open":
            raise WaiverValidationError("This waiver code is already in use")
        if expires_at is None:
            raise generic

        if token_scope not in ("BOTH", scope):
            raise WaiverValidationError(
                f"This waiver code is only valid for {token_scope.lower()} purchases"
            )
        if locked_to_tenant and tenant and locked_to_tenant != tenant:
            raise WaiverValidationError("This waiver code was issued to a different school")

        # The CAS. Single statement, RETURNING makes the winner/non-winner
        # determination atomic with the write.
        cur.execute(
            f"""
            UPDATE {_table()}
            SET status = 'reserved',
                reservation_tx_ref = %s,
                reserved_at = NOW(),
                reservation_expires_at = NOW() + make_interval(secs => %s)
            WHERE id = %s
              AND status = 'open'
              AND expires_at > NOW()
            RETURNING id, reservation_expires_at;
            """,
            (ref, RESERVATION_TTL_SECONDS, token_id),
        )
        reserved = cur.fetchone()
        conn.commit()

        if reserved is None:
            # Lost the race, or the token expired inside our own transaction.
            raise WaiverValidationError("This waiver code is already in use")

        logger.info(f"[waiver] token #{token_id} reserved for {ref}")
        return {
            "id": token_id,
            "reservation_tx_ref": ref,
            "discount_percentage": int(pct),
            "slot_allowance": int(allowance),
            "applies_to": str(token_scope or "BOTH").upper(),
            "locked_to_tenant": locked_to_tenant,
            "reservation_expires_at": reserved[1],
            "notional_ngn": _notional_value(int(allowance), int(pct)),
        }
    except WaiverValidationError:
        if conn:
            try:
                conn.rollback()
            except Exception:
                pass
        raise
    except Exception as e:
        if conn:
            try:
                conn.rollback()
            except Exception:
                pass
        logger.warning(f"[waiver] reserve failed: {e}")
        raise generic
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


def peek_token_by_id(token_id: int, allow_reserved: bool = True) -> Dict[str, Any]:
    """Read a token's terms by PRIMARY KEY. Non-mutating.

    The provision path names the token by id rather than by code. That is
    deliberate: the browser already exchanged the code for an id at reserve
    time, and re-sending a live bearer credential through a second request only
    widens the window in which it can be captured from a log.

    `allow_reserved` defaults True because this is called AFTER checkout, when
    the token is legitimately 'reserved'. The reserved state is not treated as
    usable here — redemption still requires the matching reservation ref in
    consume_token — it just means "a checkout is in flight", which is the only
    state in which this may run.
    """
    from services.db_manager import _connect_as_superuser

    generic = WaiverValidationError("Invalid or expired waiver code")
    if not waivers_enabled():
        raise generic

    tid = _as_int(token_id, "token_id")
    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        cur.execute(
            f"""
            SELECT id, discount_percentage, slot_allowance, applies_to,
                   locked_to_tenant, status, expires_at
            FROM {_table()}
            WHERE id = %s
            """,
            (tid,),
        )
        row = cur.fetchone()
        if row is None:
            raise generic
        expires_at = row[6]
        if expires_at is None:
            raise generic

        status = str(row[5] or "")
        usable_states = ("open", "reserved") if allow_reserved else ("open",)
        if status not in usable_states:
            if status == "consumed":
                raise WaiverValidationError("This waiver code has already been used")
            if status == "voided":
                raise WaiverValidationError("This waiver code has been cancelled")
            raise WaiverValidationError("This waiver code is no longer valid")

        return {
            "id": row[0],
            "discount_percentage": int(row[1]),
            "slot_allowance": int(row[2]),
            "applies_to": str(row[3] or "BOTH").upper(),
            "locked_to_tenant": row[4],
            "status": status,
            "expires_at": row[6],
            "notional_ngn": _notional_value(int(row[2]), int(row[1])),
        }
    except WaiverValidationError:
        raise
    except Exception as e:
        logger.warning(f"[waiver] peek_by_id #{token_id} failed: {e}")
        raise generic
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


def release_token(token_id: int, tx_ref: str) -> bool:
    """Return a reservation to the pool. reserved -> open.

    Scoped to `tx_ref` on purpose. An unconditional release would let a caller
    free a reservation that a different checkout is about to redeem, turning a
    held token into two redeemable ones.
    """
    from services.db_manager import _connect_as_superuser

    tid = _as_int(token_id, "token_id")
    ref = (tx_ref or "").strip()
    if not ref:
        return False

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        cur.execute(
            f"""
            UPDATE {_table()}
            SET status = 'open',
                reservation_tx_ref = NULL,
                reserved_at = NULL,
                reservation_expires_at = NULL
            WHERE id = %s AND status = 'reserved' AND reservation_tx_ref = %s
            RETURNING id;
            """,
            (tid, ref),
        )
        row = cur.fetchone()
        conn.commit()
        released = row is not None
        if released:
            logger.info(f"[waiver] token #{tid} reservation released by {ref}")
        return released
    except Exception as e:
        if conn:
            try:
                conn.rollback()
            except Exception:
                pass
        logger.warning(f"[waiver] release failed for #{tid}: {e}")
        return False
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


def consume_token(
    cur,
    token_id: int,
    reservation_tx_ref: str,
    split: Dict[str, Any],
    tenant_id: str,
    transaction_ref: Optional[str] = None,
) -> Dict[str, Any]:
    """Burn a token. reserved -> consumed. **Caller supplies the cursor.**

    This takes an open cursor rather than opening its own connection because it
    MUST run inside the same transaction that grants the slots and writes the
    ledger rows. If it committed independently, a crash between the burn and
    the slot grant would leave a school with no seats and a dead token.

    Two independent guards have to pass:

    1. `status = 'reserved'` — a token nobody holds cannot be burned.
    2. `reservation_tx_ref = <this checkout>` — a reservation cannot be
       redeemed by a different checkout than the one that made it.

    Guard 2 is what closes the sweeper race: a reservation that lapses, returns
    to the pool and is picked up by another tab can never be redeemed by the
    original, still-open modal.

    Raises WaiverValidationError on zero rows. The caller is responsible for
    rolling back.
    """
    tid = _as_int(token_id, "token_id")
    ref = (reservation_tx_ref or "").strip()
    tenant = (tenant_id or "").strip().lower()
    if not ref:
        raise WaiverValidationError("A checkout reference is required to consume a waiver")
    if not tenant:
        raise WaiverValidationError("A tenant is required to consume a waiver")

    cur.execute(
        f"""
        UPDATE {_table()}
        SET status = 'consumed',
            used_by_tenant = %s,
            used_at = NOW(),
            transaction_ref = %s,
            slots_requested = %s,
            slots_waived = %s,
            slots_forfeited = %s,
            discount_ngn = %s,
            charged_slots = %s,
            charged_ngn = %s,
            reservation_tx_ref = NULL,
            reserved_at = NULL,
            reservation_expires_at = NULL
        WHERE id = %s
          AND status = 'reserved'
          AND reservation_tx_ref = %s
        RETURNING id, token_fingerprint, discount_percentage, slot_allowance, used_at;
        """,
        (
            tenant,
            (transaction_ref or None),
            int(split.get("requested_slots") or 0),
            int(split.get("waived_slots") or 0),
            int(split.get("forfeited_slots") or 0),
            int(split.get("waived_ngn") or 0),
            int(split.get("charged_slots") or 0),
            int(split.get("charged_ngn") or 0),
            tid,
            ref,
        ),
    )
    row = cur.fetchone()
    if row is None:
        raise WaiverValidationError(
            "This waiver code is no longer valid for this checkout"
        )
    logger.info(
        f"[waiver] token #{tid} consumed by '{tenant}' — "
        f"{split.get('waived_slots')} slots waived, "
        f"{split.get('forfeited_slots')} forfeited, "
        f"₦{split.get('waived_ngn')} off"
    )
    return {
        "id": row[0],
        "token_fingerprint": row[1],
        "discount_percentage": int(row[2]),
        "slot_allowance": int(row[3]),
        "used_at": row[4],
        "slots_waived": int(split.get("waived_slots") or 0),
        "slots_forfeited": int(split.get("forfeited_slots") or 0),
        "discount_ngn": int(split.get("waived_ngn") or 0),
        "charged_slots": int(split.get("charged_slots") or 0),
        "charged_ngn": int(split.get("charged_ngn") or 0),
    }


def void_token(token_id: int, created_by: str = "superadmin") -> bool:
    """Cancel an unspent token. open -> voided. Superadmin only.

    Only 'open' tokens can be voided. A token that is reserved is mid-checkout
    and will return to open on its own; one that is consumed is a historical
    record and rewriting it would be falsifying the audit trail.
    """
    from services.db_manager import _connect_as_superuser, log_admin_action

    tid = _as_int(token_id, "token_id")
    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        cur.execute(
            f"""
            UPDATE {_table()}
            SET status = 'voided'
            WHERE id = %s AND status = 'open'
            RETURNING id, locked_to_tenant, discount_percentage, slot_allowance;
            """,
            (tid,),
        )
        row = cur.fetchone()
        conn.commit()
        if row is None:
            return False
        log_admin_action(
            "waiver.token.void",
            subdomain=row[1],
            details={"token_id": tid, "discount_percentage": row[2], "slot_allowance": row[3]},
            actor=str(created_by or "superadmin"),
        )
        logger.info(f"[waiver] token #{tid} voided by '{created_by}'")
        return True
    except Exception as e:
        if conn:
            try:
                conn.rollback()
            except Exception:
                pass
        logger.warning(f"[waiver] void failed for #{tid}: {e}")
        return False
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


def reap_stale_reservations() -> Dict[str, int]:
    """Return lapsed reservations to the pool, then retire dead tokens.

    Runs on boot from init_schools_registry(), alongside the existing
    pending-registration reaper, because there is no scheduler in this service.

    ORDERING IS LOAD-BEARING. Reservations are released first so a token that
    both lapsed AND expired this cycle ends up 'expired' rather than being
    resurrected into 'open' with an expires_at already in the past — where it
    would sit looking redeemable and be refused only at the CAS, with a much
    worse error message.
    """
    from services.db_manager import _connect_as_superuser

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        cur.execute(
            f"""
            UPDATE {_table()}
            SET status = 'open',
                reservation_tx_ref = NULL,
                reserved_at = NULL,
                reservation_expires_at = NULL
            WHERE status = 'reserved'
              AND reservation_expires_at IS NOT NULL
              AND reservation_expires_at < NOW()
            RETURNING id;
            """
        )
        released = cur.rowcount or 0

        cur.execute(
            f"""
            UPDATE {_table()}
            SET status = 'expired'
            WHERE status = 'open'
              AND expires_at IS NOT NULL
              AND expires_at < NOW()
            RETURNING id;
            """
        )
        expired = cur.rowcount or 0
        conn.commit()

        if released or expired:
            logger.info(
                f"[waiver] reaped {released} stale reservation(s), {expired} expired token(s)"
            )
        return {"released": released, "expired": expired}
    except Exception as e:
        if conn:
            try:
                conn.rollback()
            except Exception:
                pass
        logger.warning(f"[waiver] reaper failed: {e}")
        return {"released": 0, "expired": 0}
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


def get_token(token_id: int) -> Optional[Dict[str, Any]]:
    """Full audit row by id. Never returns the hash."""
    from services.db_manager import _connect_as_superuser, _row_to_dict

    tid = _as_int(token_id, "token_id")
    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        cur.execute(
            f"""
            SELECT id, token_prefix, token_fingerprint, discount_percentage,
                   slot_allowance, applies_to, locked_to_tenant, restores_suspension,
                   status, is_used, expires_at, created_by, created_at, note,
                   slots_requested, slots_waived, slots_forfeited, discount_ngn,
                   charged_slots, charged_ngn, used_by_tenant, used_at,
                   transaction_ref, reservation_tx_ref, reservation_expires_at
            FROM {_table()}
            WHERE id = %s
            """,
            (tid,),
        )
        row = cur.fetchone()
        if row is None:
            return None
        return _row_to_dict(row, cur)
    except Exception as e:
        logger.warning(f"[waiver] get_token #{tid} failed: {e}")
        return None
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass