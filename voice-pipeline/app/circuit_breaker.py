"""
Circuit breakers for the three external providers bridge.py depends on:
Sarvam STT, Sarvam TTS, Gemini LLM.

Scope, deliberately limited: this implements failure detection and fast-fail
(stop hammering a dead provider, degrade immediately instead of waiting out
a timeout on every single turn) — NOT multi-provider failover. The master
plan calls for Sarvam->Google STT, Gemini->GPT-4o-mini, Bulbul->Azure
fallback providers, but none of those have credentials configured anywhere
in this system. Wiring "fallback" calls to providers with no API key would
be the exact same class of bug as the invented meera/pavithra/arvind voice
names — code that looks complete but silently does nothing. When those
providers are actually provisioned, swap them in at the marked TODOs.

States (standard circuit breaker pattern):
  CLOSED    - normal operation, calls go through
  OPEN      - too many consecutive failures, calls are skipped immediately
              (no network round trip) until cooldown elapses
  HALF_OPEN - cooldown elapsed, one trial call allowed through; success
              closes the circuit, failure re-opens it for another cooldown

Breakers are module-level (one per provider, shared across all calls) since
the point is protecting the pipeline as a whole from a dying upstream
provider, not tracking per-call state.
"""
import logging
import time
from enum import Enum

log = logging.getLogger("exotel-bridge")


class State(Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


class CircuitBreaker:
    def __init__(self, name: str, failure_threshold: int = 3, cooldown_seconds: int = 30):
        self.name = name
        self.failure_threshold = failure_threshold
        self.cooldown_seconds = cooldown_seconds
        self.state = State.CLOSED
        self.consecutive_failures = 0
        self.opened_at: float = 0.0

    def _maybe_recover(self):
        if self.state == State.OPEN and (time.time() - self.opened_at) >= self.cooldown_seconds:
            self.state = State.HALF_OPEN
            log.info("circuit_breaker[%s]: cooldown elapsed -> HALF_OPEN (one trial call allowed)",
                      self.name)

    def allow_request(self) -> bool:
        """Check before making the call. False means: skip the live call,
        degrade immediately."""
        self._maybe_recover()
        return self.state != State.OPEN

    def record_success(self):
        if self.state != State.CLOSED:
            log.info("circuit_breaker[%s]: recovered -> CLOSED", self.name)
        self.state = State.CLOSED
        self.consecutive_failures = 0
        self.opened_at = 0.0

    def record_failure(self):
        self.consecutive_failures += 1
        if self.state == State.HALF_OPEN:
            # Trial call failed — provider still down, back to OPEN.
            self.state = State.OPEN
            self.opened_at = time.time()
            log.warning("circuit_breaker[%s]: trial call failed, re-OPENING for %ds",
                        self.name, self.cooldown_seconds)
            return
        if self.state == State.CLOSED and self.consecutive_failures >= self.failure_threshold:
            self.state = State.OPEN
            self.opened_at = time.time()
            log.warning("circuit_breaker[%s]: %d consecutive failures -> OPENING for %ds",
                        self.name, self.consecutive_failures, self.cooldown_seconds)

    def status(self) -> dict:
        """For health/debug endpoints."""
        return {
            "name": self.name,
            "state": self.state.value,
            "consecutive_failures": self.consecutive_failures,
        }


# One breaker per external provider call. Thresholds are deliberately low —
# 3 consecutive failures is enough signal on a live call path where every
# failure means a caller heard nothing or got an error reply.
sarvam_stt_breaker = CircuitBreaker("sarvam_stt", failure_threshold=3, cooldown_seconds=30)
sarvam_tts_breaker = CircuitBreaker("sarvam_tts", failure_threshold=3, cooldown_seconds=30)
gemini_breaker      = CircuitBreaker("gemini_llm", failure_threshold=3, cooldown_seconds=30)


def all_status() -> list:
    return [b.status() for b in (sarvam_stt_breaker, sarvam_tts_breaker, gemini_breaker)]
