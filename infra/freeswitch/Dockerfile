# ─────────────────────────────────────────────────────────────
# Hey Nikki FreeSWITCH image — stock FreeSWITCH + mod_audio_stream.
#
# WHY THIS FILE EXISTS: the dialplan (conf/dialplan/heynikki.xml) calls
# the "audio_stream" application to pipe call audio to the voice-pipeline
# over WebSocket. That application comes from mod_audio_stream, a
# THIRD-PARTY module (https://github.com/amigniter/mod_audio_stream) —
# it is NOT part of stock FreeSWITCH and does not exist in the plain
# signalwire/freeswitch-stable image. Without this build, every real
# call fails at the audio_stream step with "no application audio_stream".
#
# ⚠️ NOT TEST-BUILT — this sandbox has no Docker daemon, so this Dockerfile
# has not been run. Before trusting it in production:
#   docker compose build freeswitch
#   docker compose up -d freeswitch
#   docker compose exec freeswitch fs_cli -x "module_exists mod_audio_stream"
# If that returns "false" or the build fails, the apt package names below
# may not match this exact base image's FreeSWITCH package version —
# check `apt list --installed | grep freeswitch` inside the container and
# adjust the -dev package name to match.
#
# LICENSING: pinned to mod_audio_stream v1.0.0 — the last fully
# open-source community release. Newer v1.0.3+ is a commercial product,
# free to use but capped at 10 concurrent streaming channels. Fine for
# early testing, but don't silently hit that ceiling in production —
# see https://github.com/amigniter/mod_audio_stream for current licensing
# before raising MOD_AUDIO_STREAM_VERSION below.
# ─────────────────────────────────────────────────────────────
FROM signalwire/freeswitch-stable:latest

ARG MOD_AUDIO_STREAM_VERSION=v1.0.0

USER root

# Build deps per the module's own README: libfreeswitch-dev (matching
# whatever FreeSWITCH package this base image already installed via its
# configured apt repo), libssl-dev, zlib1g-dev, libevent-dev,
# libspeexdsp-dev, plus cmake/git/build-essential to actually compile it.
RUN apt-get update && apt-get install -y --no-install-recommends \
        git cmake build-essential pkg-config \
        libfreeswitch-dev libssl-dev zlib1g-dev libevent-dev libspeexdsp-dev \
    && rm -rf /var/lib/apt/lists/*

RUN git clone --branch ${MOD_AUDIO_STREAM_VERSION} --depth 1 \
        https://github.com/amigniter/mod_audio_stream.git /usr/src/mod_audio_stream \
    && cd /usr/src/mod_audio_stream \
    && git submodule init && git submodule update \
    && mkdir build && cd build \
    && cmake -DCMAKE_BUILD_TYPE=Release .. \
    && make \
    && make install \
    && rm -rf /usr/src/mod_audio_stream

# modules.conf.xml (mounted from ../conf) already has
# <load module="mod_audio_stream"/> — nothing further to wire up here.
