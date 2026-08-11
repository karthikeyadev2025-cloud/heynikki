# ─────────────────────────────────────────────────────────────
# Hey Nikki FreeSWITCH image — built from source + mod_audio_stream.
#
# HISTORY: originally FROM signalwire/freeswitch-stable:latest, which
# turned out not to exist as a public image ("pull access denied").
# Investigated the alternatives:
#   - signalwire/freeswitch-public-base: does exist and is public, but
#     SignalWire's own repo shows their actual runtime image is built
#     FROM scratch + a private CI-generated tarball (docker/base_image/
#     Dockerfile in signalwire/freeswitch) — "public-base" is a build
#     dependency layer, not a ready-to-run FreeSWITCH.
#   - drachtio/drachtio-freeswitch-mrf: a real, working, actively used
#     image — but it streams call audio via mod_audio_fork, a DIFFERENT
#     module with a different dialplan API than mod_audio_stream. Using
#     it would mean rewriting dialplan/heynikki.xml on another untested
#     guess, not just swapping a FROM line.
#
# So: build FreeSWITCH from source instead. Learned the hard way across
# several iterations that bootstrap.sh only sets up the autotools chain
# (autoconf/automake/libtool) — it does NOT resolve FreeSWITCH's actual
# library dependencies, and as of FreeSWITCH v1.10.4, sofia-sip and
# spandsp were removed from the FreeSWITCH tree entirely and must be
# built from source separately (Debian's packaged spandsp is the old,
# incompatible 2.x branch). Slower first build (expect 30-50 min now,
# with libks/sofia-sip/spandsp added) but doesn't depend on any third
# party's pre-built image existing, being public, or matching versions.
#
# WHY mod_audio_stream AT ALL: the dialplan (conf/dialplan/heynikki.xml)
# calls the "audio_stream" application to pipe call audio to the
# voice-pipeline over WebSocket. That's mod_audio_stream, a THIRD-PARTY
# module (https://github.com/amigniter/mod_audio_stream) — not part of
# FreeSWITCH itself. Without it, every call fails at that dialplan step.
#
# ⚠️ STILL NOT TEST-BUILT — this sandbox has no Docker daemon. Before
# trusting it in production:
#   docker compose build freeswitch      (expect a long first build)
#   docker compose up -d freeswitch
#   docker compose exec freeswitch fs_cli -x "module_exists mod_audio_stream"
# If the FreeSWITCH compile itself fails, paste the error — a from-source
# build can hit missing-dependency errors bootstrap.sh's apt resolution
# didn't fully cover, and those are fixable once we see the actual message,
# not something guessable in advance.
#
# LICENSING: pinned to mod_audio_stream v1.0.0 — the last fully
# open-source community release. Newer v1.0.3+ is a commercial product,
# free to use but capped at 10 concurrent streaming channels. Fine for
# early testing — see https://github.com/amigniter/mod_audio_stream for
# current licensing before raising MOD_AUDIO_STREAM_VERSION below.
# ─────────────────────────────────────────────────────────────
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
ARG FREESWITCH_VERSION=v1.10.12
ARG MOD_AUDIO_STREAM_VERSION=v1.0.0

RUN apt-get update && apt-get install -y --no-install-recommends \
        git wget ca-certificates gnupg2 lsb-release sudo \
        build-essential automake autoconf libtool libtool-bin pkg-config cmake \
        libpcre3-dev libsqlite3-dev libcurl4-openssl-dev \
        libedit-dev libspeex-dev libspeexdsp-dev uuid-dev unixodbc-dev \
        libopus-dev libsndfile1-dev libldns-dev libtiff-dev libjpeg62-turbo-dev \
        libavformat-dev libavcodec-dev libavutil-dev libswscale-dev libswresample-dev \
    && rm -rf /var/lib/apt/lists/*

# ── libks, sofia-sip, spandsp — built from source ──────────────────
# As of FreeSWITCH v1.10.4, sofia-sip and spandsp were REMOVED from the
# FreeSWITCH source tree and must be built separately (confirmed via
# SignalWire's own developer docs). Debian's packaged libspandsp-dev is
# the old 2.x ABI; FreeSWITCH needs 3.0+, which Debian doesn't ship —
# that's what caused "checking for spandsp >= 3.0... no usable spandsp"
# even with libspandsp-dev apt-installed. libks (SignalWire's own
# library) has the same problem: no usable Debian package.
RUN git clone --depth 1 https://github.com/signalwire/libks.git /usr/src/libks \
    && cd /usr/src/libks \
    && cmake . \
    && make -j"$(nproc)" \
    && make install \
    && ldconfig

RUN git clone --depth 1 https://github.com/freeswitch/sofia-sip.git /usr/src/sofia-sip \
    && cd /usr/src/sofia-sip \
    && ./bootstrap.sh \
    && ./configure \
    && make -j"$(nproc)" \
    && make install \
    && ldconfig

# Pinned to a known-good commit rather than HEAD — multiple independent
# FreeSWITCH-from-source guides report current spandsp master fails to
# compile (signalwire/freeswitch#2158) and revert to this commit as the
# documented workaround.
RUN git clone https://github.com/freeswitch/spandsp.git /usr/src/spandsp \
    && cd /usr/src/spandsp \
    && git reset --hard 67d2455efe02e7ff0d897f3fd5636fed4d54549e \
    && ./bootstrap.sh \
    && ./configure \
    && make -j"$(nproc)" \
    && make install \
    && ldconfig

RUN git clone --branch ${FREESWITCH_VERSION} --depth 1 \
        https://github.com/signalwire/freeswitch.git /usr/src/freeswitch
WORKDIR /usr/src/freeswitch
RUN ./bootstrap.sh

# --prefix=/usr matches the FHS layout most third-party FreeSWITCH
# module build scripts (including mod_audio_stream's) expect to find
# headers/libs at — avoids path-mismatch issues against a default
# /usr/local/freeswitch prefix. --sysconfdir=/etc/freeswitch matches
# docker-compose.yml's existing bind mount of ./freeswitch/conf there.
# PKG_CONFIG_PATH ensures the from-source libks/sofia-sip/spandsp
# (installed to /usr/local by their own default cmake/configure
# prefixes) are actually found ahead of any stale system paths.
RUN PKG_CONFIG_PATH=/usr/local/lib/pkgconfig:/usr/local/lib64/pkgconfig:$PKG_CONFIG_PATH \
    ./configure --prefix=/usr --sysconfdir=/etc/freeswitch --localstatedir=/var
RUN make -j"$(nproc)"
RUN make install

# Build mod_audio_stream against the FreeSWITCH just installed above.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libssl-dev zlib1g-dev libevent-dev libspeexdsp-dev \
    && rm -rf /var/lib/apt/lists/*

RUN git clone --branch ${MOD_AUDIO_STREAM_VERSION} --depth 1 \
        https://github.com/amigniter/mod_audio_stream.git /usr/src/mod_audio_stream \
    && cd /usr/src/mod_audio_stream \
    && git submodule init && git submodule update \
    && mkdir build && cd build \
    && cmake -DCMAKE_BUILD_TYPE=Release .. \
    && make \
    && make install

# Clean up build trees to keep the final image smaller (build deps like
# build-essential/cmake are left in — harmless, and useful if anyone
# needs to rebuild a module inside a running container later).
RUN rm -rf /usr/src/freeswitch /usr/src/mod_audio_stream

# modules.conf.xml (mounted at /etc/freeswitch from ../conf) already has
# <load module="mod_audio_stream"/> — nothing further to wire up here.

EXPOSE 5060/udp 5060/tcp 5080/udp 5080/tcp 8021/tcp 16384-32768/udp

# Foreground, no daemonization (-nc would background it, wrong for
# Docker where the entrypoint process needs to stay PID 1).
CMD ["/usr/bin/freeswitch", "-nonat"]
